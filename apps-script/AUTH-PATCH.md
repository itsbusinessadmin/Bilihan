# Google Apps Script auth patch (audit fix #4)

## Why

The Bilihan web app calls your Apps Script web app directly from the browser for:

- writing orders to the Google Sheet (`syncOrderToGoogleSheet`)
- uploading QR payment receipts (`upload_receipt`)
- deleting one order's Sheet row + Drive receipt (`delete_order`)
- deleting everything (`delete_all_orders`)
- viewing a receipt (`?action=receipt&order_code=...`)

The script's URL is public (it ships inside `config.js`, which every visitor
downloads). Before this patch, **anyone with the URL could POST fake orders,
delete Sheet rows, delete Drive receipts, or wipe everything** — no login, no
secret.

## What changed on the site side

`config.js` has a new `GOOGLE_APPS_SCRIPT_TOKEN` setting. `app.js` and
`admin.js` now send `token` with every POST to the script, and append
`&token=...` to the receipt-view URL — but only when the setting is non-empty.

## What you must do (about 10 minutes)

1. **Pick a secret.** A long random string, e.g. from
   https://www.uuidgenerator.net/ — any UUID works. Example:
   `9f3b1c2a-7d4e-4f8a-b1c2-3d4e5f6a7b8c` (use your own).

2. **Put it in `config.js`:**
   ```js
   GOOGLE_APPS_SCRIPT_TOKEN: 'paste-your-secret-here',
   ```
   Commit + push (GitHub Pages redeploys automatically).

3. **Patch the Apps Script.** Open
   https://script.google.com → your Bilihan project → `Code.gs`, and add this
   at the very top of both `doPost(e)` and `doGet(e)`:

   ```js
   // --- Bilihan auth patch: reject calls without the shared secret ---
   var BILIHAN_SCRIPT_TOKEN = 'paste-the-same-secret-here';

   function bilihanAuthorized(e) {
     var params = (e && e.parameter) || {};
     var body = {};
     try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
     catch (_) {}
     var token = params.token || body.token || '';
     return token === BILIHAN_SCRIPT_TOKEN;
   }
   ```

   Then, as the **first lines** inside `doPost(e)`:
   ```js
   function doPost(e) {
     if (!bilihanAuthorized(e)) {
       return ContentService.createTextOutput(
         JSON.stringify({ ok: false, error: 'Unauthorized' })
       ).setMimeType(ContentService.MimeType.JSON);
     }
     // ... your existing doPost code continues here
   ```

   And as the **first lines** inside `doGet(e)` (this guards `?action=receipt`):
   ```js
   function doGet(e) {
     if (!bilihanAuthorized(e)) {
       return ContentService.createTextOutput('Unauthorized')
         .setMimeType(ContentService.MimeType.TEXT);
     }
     // ... your existing doGet code continues here
   ```

4. **Deploy → New version** (Deploy → Manage deployments → New version), so the
   live `/exec` URL picks up the change.

## Order matters

- If you set the token in `config.js` but have **not** patched the script yet:
  the site sends `token`, the old script ignores the extra field, everything
  keeps working (still unauthenticated — patch soon).
- If you patch the script but have **not** set the token in `config.js` yet:
  the site sends no token and the script rejects every call — Sheet sync,
  receipt uploads, and receipt viewing stop until you set the token.

So: set the token in `config.js` first, deploy the site, then patch + redeploy
the script.

## After the patch

- Only requests carrying your secret can write, delete, or view receipts.
- The secret is still visible to anyone who reads `config.js` (it has to be —
  the browser sends it). This stops drive-by abuse and forged requests from
  anyone who doesn't bother to look, which is the realistic threat for a public
  endpoint. It is not a substitute for a real login; treat the token like a
  password and rotate it if you ever share `config.js` somewhere careless.
