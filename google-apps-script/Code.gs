/* =========================================================================
   Bilihan — Orders Sheet + Drive receipts Apps Script (complete file)

   This is the whole script. Select everything in your Apps Script editor,
   delete it, and paste this in, then:

     Deploy > Manage deployments > pencil on the active deployment >
     Version: "New version" > Deploy

   The /exec URL does not change, so config.js needs no edit.

   WHAT IS NEW COMPARED WITH THE PREVIOUS VERSION
   ----------------------------------------------
   doGet() now answers ?action=receipt&order_code=... by redirecting to that
   order's receipt in Drive. The admin's "View payment receipt" button links
   there. With no parameters doGet() still returns the health check exactly as
   before. Everything else — order sync, uploads, deletes — is unchanged.

   ABOUT ACCESS
   ------------
   The receipt route only redirects; it never changes a file's sharing, so
   Drive decides who may look. Signed in as the account that owns the receipts
   folder you see the receipt; anyone else gets Google's "request access" page.

   Do not add file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, ...) anywhere
   in this file. Order codes are short and guessable, so that one line would
   expose every customer's receipt, and whatever payment details it shows, to
   anyone willing to try a few codes.
   ========================================================================= */

const RECEIPT_FOLDER_ID = '1TOCB7zls8S0kTETjuqg6BmCEku7OO21e';
const SHEET_NAME = 'Orders';

/* Closing note on the order confirmation email. Edit the text here; set it to an
   empty string to leave it off entirely. The shop's name comes from Store Settings,
   not from this file. */
const THANK_YOU_NOTE =
  'Every purchase helps fund employee events, engagement activities, and tokens of ' +
  'appreciation for our employees. By shopping with us, you\u2019re helping us create ' +
  'more opportunities to celebrate, connect, and make CES a more enjoyable workplace ' +
  'for everyone.';


/* =========================================================
   POST ROUTER
   ========================================================= */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No POST data received.');
    }

    const payload = JSON.parse(e.postData.contents);

    console.log('Received action:', payload.action || 'order_sync');
    console.log('Order code:', payload.order_code || 'NONE');

    /* Delete one order: Google Sheet row + Drive receipt. */
    if (payload.action === 'delete_order') {
      return deleteOrderEverywhere(payload);
    }

    /* Delete all orders: every Sheet row + every matching receipt. */
    if (payload.action === 'delete_all_orders') {
      return deleteAllOrdersEverywhere();
    }

    /* Receipt upload. */
    if (payload.action === 'upload_receipt') {
      const receipt = saveReceiptToDrive(payload);

      updateReceiptInSheet(
        payload.order_code,
        receipt.file_url,
        receipt.file_name
      );

      return jsonResponse({
        ok: true,
        action: 'receipt_uploaded',
        receipt: receipt
      });
    }

    /* Normal order sync. */
    if (!payload.order_code) {
      throw new Error('Missing order_code');
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(SHEET_NAME);

    if (!sheet) {
      throw new Error('Orders sheet not found');
    }

    const rowData = [
      payload.order_id || '',
      payload.order_code || '',
      payload.order_date || '',
      payload.customer_name || '',
      payload.phone || '',
      payload.fulfillment || '',
      payload.address || '',
      payload.preferred_date || '',
      payload.payment_method || '',
      payload.items || '',
      Number(payload.subtotal || 0),
      Number(payload.delivery_fee || 0),
      Number(payload.total || 0),
      payload.payment_status || 'Pending',
      payload.order_status || '',
      payload.cancellation_reason || '',
      new Date(),
      payload.email || ''
    ];

    const lastRow = sheet.getLastRow();
    let existingRow = 0;

    if (lastRow >= 2) {
      const orderCodes = sheet
        .getRange(2, 2, lastRow - 1, 1)
        .getValues()
        .flat();

      const index = orderCodes.findIndex(
        code => String(code).trim() === String(payload.order_code).trim()
      );

      if (index !== -1) {
        existingRow = index + 2;
      }
    }

    if (existingRow) {
      sheet
        .getRange(existingRow, 1, 1, rowData.length)
        .setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    /* Confirmation email, only the first time this order is seen. The admin page
       re-posts the same order whenever its status or payment changes, so keying off
       "was this a new row" is what stops the customer being mailed again every time
       you touch their order. */
    var emailed = false;
    if (!existingRow && payload.email) {
      emailed = sendOrderConfirmation(payload);
    }

    return jsonResponse({
      ok: true,
      action: existingRow ? 'updated' : 'inserted',
      order_code: payload.order_code,
      emailed: emailed
    });

  } catch (err) {
    console.error('doPost error:', err.stack || err.message);

    return jsonResponse({
      ok: false,
      error: err.message
    });
  }
}


/* =========================================================
   GET ROUTER

   Health check, plus the receipt redirect the admin links to.
   ========================================================= */

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === 'receipt') {
    return serveReceiptRedirect(params.order_code);
  }

  /* Health check — unchanged. */
  try {
    const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);

    return jsonResponse({
      ok: true,
      service: 'Bilihan Orders Sheet',
      receipt_folder: folder.getName()
    });

  } catch (err) {
    return jsonResponse({
      ok: false,
      error: err.message
    });
  }
}


/* =========================================================
   RECEIPT REDIRECT
   ========================================================= */

function serveReceiptRedirect(orderCode) {
  orderCode = String(orderCode || '').trim();

  if (!orderCode) {
    return receiptMessage('Receipt', 'No order number was supplied.');
  }

  let file;
  try {
    file = findReceiptFileForOrder(orderCode);
  } catch (err) {
    return receiptMessage(
      'Receipt unavailable',
      'Could not open the receipts folder: ' + escapeReceiptHtml(err.message)
    );
  }

  if (!file) {
    return receiptMessage(
      'No receipt for ' + escapeReceiptHtml(orderCode),
      'Nothing is stored for this order. Cash orders never have a receipt, and ' +
      'a QR order placed before receipt uploads were switched on will not have one either.'
    );
  }

  const url = file.getUrl();

  /*
    HtmlService renders inside an iframe on script.google.com, and Drive
    refuses to be framed, so navigating the iframe would show a blank box.
    Both the script and the fallback link target the TOP window instead.
  */
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><title>Opening receipt…</title>' +
    '<p style="font:15px -apple-system,system-ui,sans-serif;padding:24px;line-height:1.55">' +
    'Opening the receipt for ' + escapeReceiptHtml(orderCode) + '… ' +
    '<a href="' + escapeReceiptHtml(url) + '" target="_top">Open it manually</a> ' +
    'if nothing happens.</p>' +
    '<script>window.top.location.href=' + JSON.stringify(url) + ';<\/script>'
  );
}


/*
  Finds an order's receipt.

  saveReceiptToDrive names files `<safeOrderCode>.<ext>`, so this uses the same
  sanitising and the same exact-or-prefix match as deleteReceiptForOrder. A
  loose "contains" match would let order code BIL-ACC pull up BIL-ACCB75's
  receipt, which is another customer's payment details.
*/
function findReceiptFileForOrder(orderCode) {
  const safeOrderCode = safeOrderCodeFor(orderCode);

  if (!safeOrderCode) {
    return null;
  }

  const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
  const files = folder.getFiles();

  let newest = null;

  while (files.hasNext()) {
    const file = files.next();

    if (!receiptNameMatches(file.getName(), safeOrderCode)) {
      continue;
    }

    /* Newest wins, in case a receipt was ever uploaded more than once. */
    if (!newest || file.getDateCreated() > newest.getDateCreated()) {
      newest = file;
    }
  }

  return newest;
}


/* The one place the receipt naming rule lives, so lookup and delete cannot drift. */
function safeOrderCodeFor(orderCode) {
  return String(orderCode || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '_');
}

function receiptNameMatches(fileName, safeOrderCode) {
  const name = String(fileName);
  return name === safeOrderCode || name.startsWith(safeOrderCode + '.');
}


function receiptMessage(title, body) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
    '<div style="font:15px -apple-system,system-ui,sans-serif;max-width:34rem;' +
    'padding:24px;line-height:1.55">' +
    '<h1 style="font-size:1.1rem;margin:0 0 8px">' + title + '</h1>' +
    '<p style="margin:0;color:#555">' + body + '</p></div>'
  );
}


function escapeReceiptHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/* =========================================================
   DELETE ONE ORDER EVERYWHERE
   ========================================================= */

function deleteOrderEverywhere(payload) {
  if (!payload.order_code) {
    throw new Error('Missing order_code');
  }

  const orderCode = String(payload.order_code).trim();

  const sheetResult = deleteOrderRowFromSheet(orderCode);
  const driveResult = deleteReceiptForOrder(orderCode);

  return jsonResponse({
    ok: true,
    action: 'delete_order',
    order_code: orderCode,
    sheet_deleted: sheetResult.deleted,
    receipts_deleted: driveResult.deleted
  });
}


/* =========================================================
   DELETE ORDER ROW FROM GOOGLE SHEET
   ========================================================= */

function deleteOrderRowFromSheet(orderCode) {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Orders sheet not found');
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { deleted: false };
  }

  const orderCodes = sheet
    .getRange(2, 2, lastRow - 1, 1)
    .getValues()
    .flat();

  const index = orderCodes.findIndex(
    code => String(code).trim() === String(orderCode).trim()
  );

  if (index === -1) {
    console.log('Order not found in sheet:', orderCode);
    return { deleted: false };
  }

  const rowNumber = index + 2;

  sheet.deleteRow(rowNumber);

  console.log('Deleted Google Sheet row:', rowNumber, 'Order:', orderCode);

  return { deleted: true };
}


/* =========================================================
   DELETE RECEIPT FOR ONE ORDER
   ========================================================= */

function deleteReceiptForOrder(orderCode) {
  const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
  const safeOrderCode = safeOrderCodeFor(orderCode);

  const files = folder.getFiles();
  let deleted = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = String(file.getName());

    /*
      Examples: BIL-ABC123.jpg, BIL-ABC123.png, BIL-ABC123.pdf
      These match the order number while unrelated files stay untouched.
    */
    if (receiptNameMatches(fileName, safeOrderCode)) {
      file.setTrashed(true);
      deleted++;

      console.log('Receipt moved to trash:', fileName);
    }
  }

  return { deleted: deleted };
}


/* =========================================================
   DELETE ALL ORDERS EVERYWHERE
   ========================================================= */

function deleteAllOrdersEverywhere() {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Orders sheet not found');
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return jsonResponse({
      ok: true,
      action: 'delete_all_orders',
      orders_deleted: 0,
      receipts_deleted: 0
    });
  }

  /* Save all order numbers BEFORE deleting the rows. */
  const orderCodes = sheet
    .getRange(2, 2, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(code => String(code).trim())
    .filter(Boolean);

  let receiptsDeleted = 0;

  orderCodes.forEach(orderCode => {
    const result = deleteReceiptForOrder(orderCode);
    receiptsDeleted += result.deleted;
  });

  const numberOfOrders = lastRow - 1;

  /* Delete rows underneath the header. Row 1 remains untouched. */
  sheet.deleteRows(2, numberOfOrders);

  console.log('Deleted all order rows:', numberOfOrders);
  console.log('Deleted matching receipts:', receiptsDeleted);

  return jsonResponse({
    ok: true,
    action: 'delete_all_orders',
    orders_deleted: numberOfOrders,
    receipts_deleted: receiptsDeleted
  });
}


/* =========================================================
   SAVE RECEIPT TO GOOGLE DRIVE
   ========================================================= */

function saveReceiptToDrive(payload) {
  if (!payload || !payload.order_code || !payload.file_base64) {
    throw new Error('Missing receipt upload data');
  }

  const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);

  console.log('Receipt folder:', folder.getName());

  const mimeType = payload.mime_type || 'image/jpeg';

  let extension = getExtensionFromMimeType(mimeType);

  if (payload.file_name && payload.file_name.includes('.')) {
    const originalExtension = payload.file_name
      .split('.')
      .pop()
      .toLowerCase();

    if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(originalExtension)) {
      extension = originalExtension === 'jpeg' ? 'jpg' : originalExtension;
    }
  }

  const safeOrderCode = safeOrderCodeFor(payload.order_code);
  const finalName = `${safeOrderCode}.${extension}`;

  console.log('Saving receipt as:', finalName);

  let base64 = String(payload.file_base64);

  if (base64.includes(',')) {
    base64 = base64.split(',').pop();
  }

  const bytes = Utilities.base64Decode(base64);

  console.log('Decoded receipt bytes:', bytes.length);

  const blob = Utilities.newBlob(bytes, mimeType, finalName);

  /* Replace any old receipt for the same order. */
  deleteReceiptForOrder(payload.order_code);

  const file = folder.createFile(blob);

  console.log('Drive file created:', file.getId());

  return {
    file_id: file.getId(),
    file_name: file.getName(),
    file_url: file.getUrl()
  };
}


/* =========================================================
   UPDATE RECEIPT LINK IN GOOGLE SHEET
   ========================================================= */

function updateReceiptInSheet(orderCode, receiptUrl, receiptName) {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Orders sheet not found');
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const orderCodes = sheet
    .getRange(2, 2, lastRow - 1, 1)
    .getValues()
    .flat();

  const index = orderCodes.findIndex(
    code => String(code).trim() === String(orderCode).trim()
  );

  if (index === -1) {
    console.log('Order not found in sheet:', orderCode);
    return;
  }

  const row = index + 2;

  sheet
    .getRange(row, 18)
    .setFormula(`=HYPERLINK("${receiptUrl}","View Receipt")`);

  sheet
    .getRange(row, 19)
    .setValue(new Date());

  console.log('Receipt link added to row:', row);
}


/* =========================================================
   MIME TYPE -> FILE EXTENSION
   ========================================================= */

function getExtensionFromMimeType(mimeType) {
  const types = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf'
  };

  return types[mimeType] || 'jpg';
}


/* =========================================================
   JSON RESPONSE
   ========================================================= */

/* ---------------------------------------------------------------------------
   Order confirmation email.

   Sent with MailApp, which costs nothing: a consumer Gmail account can send about
   100 of these a day, a Workspace account about 1,500. The "from" address is
   whichever Google account owns this script.

   A failure here must never fail the order. The order is already saved in Supabase
   and written to the sheet by the time this runs, so a bounced or over-quota send
   is logged and swallowed rather than thrown.
   --------------------------------------------------------------------------- */
function sendOrderConfirmation(payload) {
  try {
    var remaining = MailApp.getRemainingDailyQuota();
    if (remaining < 1) {
      console.warn('Email quota spent for today; order ' + payload.order_code + ' not mailed.');
      return false;
    }

    var name = String(payload.customer_name || 'there').trim();
    var code = String(payload.order_code || '').trim();
    var fulfillment = String(payload.fulfillment || '').trim();
    var isDelivery = fulfillment === 'Delivery';

    var rows = [
      ['Order number', code],
      ['Name', name],
      ['For', fulfillment],
      [isDelivery ? 'Deliver to' : 'Pickup', isDelivery ? String(payload.address || '') : String(payload.pickup_location || 'See the store for pickup details')],
      ['Date', String(payload.preferred_date || '')],
      ['Payment', String(payload.payment_method || '')],
      ['Items', String(payload.items || '')],
      ['Total', peso(payload.total)]
    ];

    var tableRows = rows.map(function (r) {
      return '<tr>' +
        '<td style="padding:7px 14px 7px 0;color:#676d65;vertical-align:top;white-space:nowrap">' + escapeReceiptHtml(r[0]) + '</td>' +
        '<td style="padding:7px 0;color:#181c19;font-weight:600">' + escapeReceiptHtml(r[1]) + '</td>' +
        '</tr>';
    }).join('');

    var store = String(payload.store_name || 'Bilihan');
    var subject = store + ' order ' + code + ' — we got it';

    var html =
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#181c19">' +
        '<h1 style="margin:0 0 6px;font-size:22px">Thanks, ' + escapeReceiptHtml(name) + '!</h1>' +
        '<p style="margin:0 0 20px;color:#676d65;line-height:1.6">We have your order and we are getting it ready. Keep this email — your order number is how we find it.</p>' +
        '<div style="padding:16px 18px;border:1px solid #e9e4d8;border-radius:14px;background:#faf8f3">' +
          '<table style="border-collapse:collapse;width:100%;font-size:14px">' + tableRows + '</table>' +
        '</div>' +
        '<p style="margin:20px 0 0;color:#676d65;font-size:13px;line-height:1.6">Need to change or cancel something? Just reply to this email and we will sort it out.</p>' +
        (THANK_YOU_NOTE
          ? '<p style="margin:20px 0 0;padding-top:18px;border-top:1px solid #e9e4d8;color:#676d65;font-size:13px;line-height:1.6">' + escapeReceiptHtml(THANK_YOU_NOTE) + '</p>'
          : '') +
        '<p style="margin:16px 0 0;color:#181c19;font-size:14px;font-weight:600">' + escapeReceiptHtml(store) + '</p>' +
      '</div>';

    var text =
      'Thanks, ' + name + '!\n\n' +
      'We have your order and we are getting it ready.\n\n' +
      rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') +
      '\n\nNeed to change or cancel something? Just reply to this email.' +
      (THANK_YOU_NOTE ? '\n\n' + THANK_YOU_NOTE : '') +
      '\n\n' + store;

    MailApp.sendEmail({
      to: String(payload.email).trim(),
      subject: subject,
      body: text,
      htmlBody: html,
      name: store
    });

    console.log('Confirmation emailed for ' + code + ' (' + (remaining - 1) + ' sends left today)');
    return true;
  } catch (err) {
    console.error('Confirmation email failed for ' + (payload.order_code || '?') + ': ' + (err.stack || err.message));
    return false;
  }
}

function peso(value) {
  var n = Number(value || 0);
  return '\u20B1' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =========================================================
   EDITOR TESTS — run these from the Apps Script editor
   ========================================================= */

/* Checks the receipt lookup without deploying. Use a code you know has one. */
function testFindReceipt() {
  const orderCode = 'BIL-ACCB75';
  const file = findReceiptFileForOrder(orderCode);

  if (!file) {
    console.log('No receipt found for', orderCode);
    return;
  }

  console.log('Found:', file.getName());
  console.log('URL:', file.getUrl());
}


function testReceiptFolder() {
  const folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);

  console.log('Folder name:', folder.getName());

  const testFile = folder.createFile(
    'BILIHAN_TEST.txt',
    'Bilihan Google Drive receipt upload test.'
  );

  console.log('Test file created:', testFile.getUrl());
}


/* Run this from the Apps Script editor to check the confirmation email end to end.
   It sends a sample order to the address that owns this script.

   The first run is also what triggers Google's permission prompt for sending mail.
   Adding MailApp introduced a scope the script did not have before, so a deployment
   authorised earlier will refuse to send until this is approved once. If no email
   arrives from a real order, run this first: it fails loudly, where a live send only
   writes to the Executions log. */
function testOrderEmail() {
  var me = Session.getActiveUser().getEmail();
  console.log('Sending a test confirmation to: ' + me);
  console.log('Sends left today: ' + MailApp.getRemainingDailyQuota());

  var sent = sendOrderConfirmation({
    order_code: 'BIL-TEST01',
    customer_name: 'Test Customer',
    email: me,
    fulfillment: 'Pickup',
    pickup_location: 'Test pickup location',
    preferred_date: new Date().toISOString().slice(0, 10),
    payment_method: 'Cash on Delivery / Pickup',
    items: 'Sample item x 1',
    total: 100,
    store_name: 'CE Fun Club Store'
  });

  if (sent) {
    console.log('Sent. Check the inbox for ' + me + ' (look in Spam too).');
  } else {
    console.error('Not sent. The reason is logged just above this line.');
  }
}

function testOrdersSheet() {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Orders sheet not found');
  }

  console.log('Sheet name:', sheet.getName());
  console.log('Last row:', sheet.getLastRow());
}
