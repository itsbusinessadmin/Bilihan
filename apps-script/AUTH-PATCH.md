# Google Apps Script auth setup (audit fix #4)

## Why

The Bilihan web app calls your Apps Script web app directly from the browser for:

- writing orders to the Google Sheet (`syncOrderToGoogleSheet`)
- uploading QR payment receipts (`upload_receipt`)
- deleting one order's Sheet row + Drive receipt (`delete_order`)
- deleting everything (`delete_all_orders`)
- viewing a receipt (`?action=receipt&order_code=...`)

The script's URL is public (it ships inside `config.js`, which every visitor
downloads). Without the token check, **anyone with the URL could POST fake
orders, delete Sheet rows, delete Drive receipts, or wipe everything** — no
login, no secret. The file `google-apps-script/Code.gs` in this repo already
contains the token check; you just need to switch it on.

## What changed on the site side

`config.js` has a new `GOOGLE_APPS_SCRIPT_TOKEN` setting. `app.js` and
`admin.js` send `token` with every POST to the script, and append `&token=...`
to the receipt-view URL — but only when the setting is non-empty.

## What you must do (about 10 minutes)

1. **Pick a secret.** A long random string, e.g. a UUID from
   https://www.uuidgenerator.net/. Example:
   `9f3b1c2a-7d4e-4f8a-b1c2-3d4e5f6a7b8c` (use your own — don't reuse this one).

2. **Put it in the Apps Script.** Open https://script.google.com → your Bilihan
   project → `Code.gs`. Select everything, delete it, and paste in
   `google-apps-script/Code.gs` from this repo. Then set the secret at the top:
   ```js
   const SCRIPT_TOKEN = 'paste-your-secret-here';
   ```

3. **Put the same secret in `config.js`:**
   ```js
   GOOGLE_APPS_SCRIPT_TOKEN: 'paste-your-secret-here',
   ```
   Commit + push (GitHub Pages redeploys automatically).

4. **Deploy the script:** Deploy → Manage deployments → pencil icon on the
   active deployment → Version: **New version** → Deploy. The `/exec` URL does
   not change.

## Order matters

The script **fails closed**: with `SCRIPT_TOKEN` empty it rejects every
request, and the site only sends a token when `GOOGLE_APPS_SCRIPT_TOKEN` is
set. So set the same secret in **both** places before deploying the new script
version — otherwise Sheet sync, receipt uploads, and receipt viewing stop
until both sides match.

## After the patch

- Only requests carrying your secret can write, delete, or view receipts.
- The secret is still visible to anyone who reads `config.js` (it has to be —
  the browser sends it). This stops drive-by abuse and forged requests from
  anyone who doesn't bother to look, which is the realistic threat for a public
  endpoint. It is not a substitute for a real login; treat the token like a
  password and rotate it if you ever share `config.js` somewhere careless.
