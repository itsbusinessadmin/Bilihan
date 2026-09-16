/**
 * Bilihan — "View receipt" endpoint for the admin Orders page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Customer receipts go straight to Google Drive: app.js posts them to this
 * Apps Script with `mode: 'no-cors'`, which forbids the browser from reading
 * the response. So even though doPost already returns the Drive file_url, the
 * storefront never gets to see it, and the Supabase `orders` table has no
 * column holding it either. Nothing in the web app knows where a receipt is.
 *
 * This adds a GET route that takes an order code, finds the receipt in Drive
 * and redirects the browser to it. The admin's "View payment receipt" button
 * links here.
 *
 * ── HOW TO INSTALL ────────────────────────────────────────────────────────
 *
 * Your project ALREADY defines doGet(), RECEIPT_FOLDER_ID and jsonResponse().
 * All .gs files in an Apps Script project share one global scope, so pasting a
 * second copy of any of them is a "has already been declared" error and the
 * project stops running. Therefore:
 *
 *   1. DELETE your current doGet() — the health check. Its behaviour is
 *      preserved in the doGet() below, so you lose nothing.
 *   2. Paste everything below into your project (a new file is fine).
 *   3. Do NOT copy your RECEIPT_FOLDER_ID or jsonResponse() again. This file
 *      deliberately declares neither, and reuses yours.
 *   4. Deploy > Manage deployments > pencil icon on the active deployment >
 *      Version: "New version" > Deploy. The /exec URL does not change, so
 *      config.js needs no edit.
 *   5. Check it: open the /exec URL in a browser. You should still see the
 *      health-check JSON. Then open a QR order in the Bilihan admin and click
 *      "View payment receipt".
 *
 * ── ABOUT ACCESS ──────────────────────────────────────────────────────────
 *
 * Anyone who knows the /exec URL and an order code can hit this route. That
 * cannot be helped: the same deployment must stay open to anonymous visitors
 * so customers can place orders at all.
 *
 * It is safe regardless, because this route only ever redirects to the Drive
 * file and never touches that file's sharing. Drive decides who may look:
 * signed in as the account that owns the receipts folder you see the receipt,
 * and everyone else lands on Google's "request access" page.
 *
 * That protection disappears the moment a receipt is shared by link. Do not
 * add a call such as
 *
 *     file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
 *
 * to this route or to saveReceiptToDrive(). Order codes are short and
 * guessable, so that single line would expose every customer's receipt — and
 * whatever payment details it shows — to anyone willing to try a few codes.
 */


/**
 * GET router.
 *
 * REPLACES the doGet() already in your project. With no parameters it returns
 * exactly the health check you had; with ?action=receipt it serves a receipt.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === 'receipt') {
    return serveReceiptRedirect(params.order_code);
  }

  // Unchanged health check.
  try {
    var folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
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


/**
 * Sends the browser to an order's receipt in Drive.
 */
function serveReceiptRedirect(orderCode) {
  orderCode = String(orderCode || '').trim();

  if (!orderCode) {
    return receiptMessage('Receipt', 'No order number was supplied.');
  }

  var file;
  try {
    file = findReceiptFileForOrder(orderCode);
  } catch (err) {
    return receiptMessage('Receipt unavailable', 'Could not open the receipts folder: ' + escapeReceiptHtml(err.message));
  }

  if (!file) {
    return receiptMessage(
      'No receipt for ' + escapeReceiptHtml(orderCode),
      'Nothing is stored for this order. Cash orders never have a receipt, and ' +
      'a QR order placed before receipt uploads were switched on will not have one either.'
    );
  }

  var url = file.getUrl();

  /*
    HtmlService renders inside an iframe on script.google.com, and Drive refuses
    to be framed, so navigating the iframe would show a blank box. Both the
    script and the fallback link therefore target the TOP window.
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


/**
 * Finds an order's receipt in the receipts folder.
 *
 * saveReceiptToDrive() names files `<safeOrderCode>.<ext>`, so this uses the
 * same sanitising and the same exact/prefix match that deleteReceiptForOrder()
 * uses. A loose "contains" match would let order code BIL-ACC pull up
 * BIL-ACCB75's receipt, which is someone else's payment details.
 */
function findReceiptFileForOrder(orderCode) {
  var safeOrderCode = String(orderCode)
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '_');

  if (!safeOrderCode) {
    return null;
  }

  var folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
  var files = folder.getFiles();
  var newest = null;

  while (files.hasNext()) {
    var file = files.next();
    var fileName = String(file.getName());

    if (fileName !== safeOrderCode && !fileName.startsWith(safeOrderCode + '.')) {
      continue;
    }

    // Newest wins, in case a receipt was ever uploaded more than once.
    if (!newest || file.getDateCreated() > newest.getDateCreated()) {
      newest = file;
    }
  }

  return newest;
}


/**
 * A small HTML page, used when there is nothing to redirect to.
 */
function receiptMessage(title, body) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><title>' + title + '</title>' +
    '<div style="font:15px -apple-system,system-ui,sans-serif;max-width:34rem;' +
    'padding:24px;line-height:1.55">' +
    '<h1 style="font-size:1.1rem;margin:0 0 8px">' + title + '</h1>' +
    '<p style="margin:0;color:#555">' + body + '</p></div>'
  );
}


/**
 * Named distinctly so it cannot collide with anything already in the project.
 */
function escapeReceiptHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * Run this from the Apps Script editor to check the lookup without deploying.
 * Change the order code to one you know has a receipt.
 */
function testFindReceipt() {
  var orderCode = 'BIL-ACCB75';
  var file = findReceiptFileForOrder(orderCode);

  if (!file) {
    console.log('No receipt found for', orderCode);
    return;
  }

  console.log('Found:', file.getName());
  console.log('URL:', file.getUrl());
}
