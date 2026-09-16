/**
 * Bilihan — "View receipt" endpoint for the admin Orders page.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Customer receipts are uploaded straight to Google Drive by app.js, using
 * `fetch(..., { mode: 'no-cors' })`. That mode means the browser is never
 * allowed to read the response, so the Drive file's URL never comes back and
 * nothing in the app knows where the receipt ended up. This endpoint closes
 * that gap: given an order code, it finds the receipt and sends the browser
 * to it.
 *
 * HOW TO INSTALL
 * --------------
 * 1. Open your existing Bilihan Apps Script project (the one whose /exec URL
 *    is in config.js as GOOGLE_SHEETS_WEB_APP_URL).
 * 2. Paste the doGet function below into that project. If the project already
 *    has a doGet, merge the `action === 'receipt'` branch into it rather than
 *    adding a second one — a project may only define doGet once.
 * 3. Set RECEIPT_FOLDER_ID below to the Drive folder your upload_receipt
 *    action writes into. If your upload code already has that ID in a
 *    constant, reuse the same constant instead of duplicating it.
 * 4. Deploy > Manage deployments > edit the active deployment > Version:
 *    "New version" > Deploy. The /exec URL stays the same, so config.js does
 *    not change.
 * 5. In the Bilihan admin, open any QR Payment order and click "View receipt".
 *
 * ABOUT ACCESS
 * ------------
 * This endpoint is reachable by anyone who knows the /exec URL and an order
 * code, because the same deployment has to stay open for customers to place
 * orders. It is safe anyway, because it only ever redirects to the Drive file
 * and never changes that file's sharing. Drive itself decides who may look:
 * signed in as the account that owns the folder you see the receipt, and
 * anyone else lands on Google's "request access" page.
 *
 * So: do NOT add a sharing call such as
 *     file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, ...)
 * to this file or to your upload code. That would make every customer's
 * receipt, including whatever payment details it shows, readable by anyone
 * who can guess an order code. Order codes are short and guessable.
 */

/** The Drive folder that upload_receipt writes receipts into. */
var RECEIPT_FOLDER_ID = 'PASTE_YOUR_RECEIPT_FOLDER_ID_HERE';

function doGet(e) {
  var params = (e && e.parameter) || {};

  if (params.action === 'receipt') {
    return serveReceipt(params.order_code);
  }

  return htmlMessage('Bilihan', 'Nothing to see here.');
}

/**
 * Redirects to the Drive receipt for an order code.
 *
 * ContentService cannot issue a real 302, so this returns a tiny page that
 * navigates. The redirect is written with a JS assignment plus a <meta>
 * fallback so it still works if script is blocked.
 */
function serveReceipt(orderCode) {
  orderCode = String(orderCode || '').trim();
  if (!orderCode) {
    return htmlMessage('Receipt', 'No order number was supplied.');
  }

  var file = findReceiptFile(orderCode);
  if (!file) {
    return htmlMessage(
      'Receipt not found',
      'No payment receipt is stored for order ' + escapeHtml(orderCode) + '. ' +
      'Cash orders have no receipt, and a QR order placed before receipt ' +
      'uploads were switched on will not have one either.'
    );
  }

  var url = file.getUrl();
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="0;url=' + escapeHtml(url) + '">' +
    '<title>Opening receipt…</title>' +
    '<p style="font:15px -apple-system,system-ui,sans-serif;padding:24px">' +
    'Opening the receipt for ' + escapeHtml(orderCode) + '… ' +
    '<a href="' + escapeHtml(url) + '">Open it manually</a> if nothing happens.</p>' +
    '<script>location.replace(' + JSON.stringify(url) + ');<\/script>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Finds an order's receipt by name within the receipts folder.
 *
 * upload_receipt is expected to put the order code in the file name. The
 * search is widened to a contains-match so a name like
 * "BIL-ACCB75 - receipt.jpg" is still found, and the newest match wins if a
 * customer somehow uploaded more than once.
 */
function findReceiptFile(orderCode) {
  var folder;
  try {
    folder = DriveApp.getFolderById(RECEIPT_FOLDER_ID);
  } catch (err) {
    return null;
  }

  var newest = null;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().indexOf(orderCode) === -1) continue;
    if (!newest || file.getDateCreated() > newest.getDateCreated()) {
      newest = file;
    }
  }
  return newest;
}

function htmlMessage(title, body) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
    '<div style="font:15px -apple-system,system-ui,sans-serif;max-width:34rem;padding:24px;line-height:1.55">' +
    '<h1 style="font-size:1.1rem;margin:0 0 8px">' + escapeHtml(title) + '</h1>' +
    '<p style="margin:0;color:#555">' + body + '</p></div>'
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
