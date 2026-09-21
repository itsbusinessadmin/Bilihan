# Bilihan — The Customer Page

This document covers **only the customer-facing storefront** (`index.html`). The admin
dashboard (`admin.html`) is documented in [`README.md`](README.md).

---

## 1. What this is

Bilihan is a small online food store for a single shop in the Philippines. The customer
page is the shopfront: a visitor lands on it, browses what is for sale, adds items to a
cart, fills in a short checkout form, and gets an order number. The shop owner sees that
order in Admin.

It is a **static website with a database behind it**. There is no server to run, no
framework, no build step — just HTML, CSS, and plain JavaScript files hosted on GitHub
Pages at `https://bilihan.shop`, talking directly to a Supabase (PostgreSQL) project from
the browser.

**Purpose:** let the shop take orders online without a POS system, a Shopify
subscription, or a developer on call. The owner changes products, prices, stock, photos
and copy from Admin; the customer page picks the changes up on the next load, and nobody
has to edit this repository to run the store day to day.

### What a customer can do

| | |
|---|---|
| Browse | Products by category, in a grid or list view, with live stock counts |
| Inspect | A product dialog with the full photo, description, price and a quantity picker |
| Cart | Add, change quantity, remove; the cart survives closing the tab |
| Check out | Name, optional mobile, pickup or delivery, preferred date, payment method, note |
| Pay | Cash on pickup/delivery, or scan the shop's QR code and upload the payment receipt |
| Confirm | An order number (`BIL-XXXXXX`) shown on screen and re-openable from **My Order** |
| Message | A chat button in the corner that reaches the shop owner's Admin inbox |
| Prefer | Light or dark theme, remembered per browser |

There is **no customer account and no login**. Everything a customer "has" — their cart,
their last order, their chat session — lives in that browser's `localStorage`.

---

## 2. The files that make up the customer page

| File | What it does |
|---|---|
| `index.html` | The whole page: header, hero, product grid, about, footer, plus empty shells for the cart drawer and the three dialogs |
| `app.js` | All storefront logic — loading data, rendering, cart, checkout, order confirmation |
| `styles.css` | Every style for the storefront, including light/dark theming |
| `support.js` | The chat widget; builds its own DOM and injects it, independent of `app.js` |
| `config.js` | Public configuration: Supabase URL + key, Apps Script endpoint, analytics choice |
| `supabase.js` | Creates the browser Supabase client, or degrades gracefully if it can't |
| `analytics.js` | Loads an analytics provider — **does nothing until configured** |
| `404.html` | Custom not-found page served by GitHub Pages |
| `site.webmanifest`, icons, `og-image.jpg`, `robots.txt`, `sitemap.xml` | Installable-app metadata, favicons, social preview, SEO |

`admin.html`, `admin.js`, `admin-app.css`, `fast-entry.js` and `google-apps-script/` are
**not** part of the customer page.

Scripts load in this order at the end of `<body>`, all `defer`red:

```
supabase-js (CDN) → config.js → supabase.js → analytics.js → app.js → support.js
```

---

## 3. How it works

### 3.1 Loading the page

1. **Before first paint**, two tiny inline scripts run in `<head>`: one redirects `http:`
   to `https:`, the other reads the saved theme from `localStorage` and sets
   `data-theme` on `<html>`. The second exists so dark-mode visitors never see a white
   flash while the deferred `app.js` is still parsing.
2. `supabase.js` creates `window.db`. If the CDN is blocked or the keys are missing it
   sets `window.db = null` and flags the page as unconfigured rather than throwing —
   a blank page is worse than a cached one.
3. `app.js` runs `bootstrap()`:
   - It paints the **cached copy** of the menu from `localStorage` immediately, so a
     returning customer sees products without waiting on the network. First-time
     visitors get skeleton placeholders instead.
   - It then fetches `categories`, `products` and `store_settings` in parallel,
     replaces the cache, and re-renders.
   - If that fetch fails, it falls back to the cache (or to built-in demo content) and
     shows a banner: *"Ordering is temporarily unavailable… "* with a **Try Again**
     button. Browsing still works; checkout is disabled.
4. `support.js` appends the chat button and starts a slow poll for unread replies.

A briefly stale product card cannot produce a wrong order, because checkout re-reads live
products and the database re-checks stock and price again at the moment of ordering
(§3.4).

### 3.2 What the page renders from the database

Almost nothing on the page is hard-coded. `store_settings` (one row, edited in Admin)
drives:

- business name and logo (header, footer, page title)
- hero title, tagline, and a rotating set of hero images
- about text and about image
- contact links — phone (`tel:`), email (`mailto:`), Messenger, Instagram — shown in the
  footer and the mobile menu
- pickup location shown at checkout
- the QR payment image
- feature flags: `show_delivery_address`, `show_preferred_date`, `preferred_date_mode`,
  `order_available_from`, `show_stock`, `show_qr_payment`, `show_cash_payment`

Values still at their seeded defaults (`+63 900 000 0000`, `https://m.me/`,
`https://instagram.com/`, `Your pickup location here`) are treated as **not set** and
hidden, so the storefront never shows placeholder text to a customer.

Categories with no products in them are not shown. Hero rotation stops entirely for
visitors who have `prefers-reduced-motion` set.

**Animated GIFs work.** Every image Admin uploads — product photos, the logo, hero images,
the about image, the QR code — accepts any image type the browser offers, including GIF.
Admin downscales and re-encodes ordinary photos to WebP before upload, but deliberately
skips GIF and SVG, because a canvas re-encode captures only the first frame and would
silently flatten the animation. The GIF is stored and served exactly as picked, and the
storefront renders it in a plain `<img>`, so it animates.

Two things follow from that. A GIF gets **no compression at all**, so Admin rejects any
image over 5 MB rather than let one large animation fill the storage bucket and sit in
front of the storefront on a phone connection. And a GIF's own animation **cannot be
stopped by `prefers-reduced-motion`** — the hero *rotation* respects that setting, but the
frames inside a GIF keep moving regardless, so an animated hero image is worth using
sparingly.

### 3.3 The cart

The cart is an array in `localStorage` under `bilihan_cart_v3` holding
`{productId, qty, price, name, image}`. It is written on every change, so closing the tab
or losing connection does not lose it. Quantity is capped at the stock the page knows
about, with a toast when the cap is hit.

The cart is **not** authoritative. Prices and stock in it are a convenience for display;
both are re-read from the server at checkout.

### 3.4 Checkout and placing an order

The checkout dialog is built at open time, not written into the HTML, because its shape
depends on the shop's settings: delivery only appears if `show_delivery_address` is on,
the date field can be a calendar or a fixed date, and the payment dropdown lists only the
methods the shop has enabled. If exactly one option is available it is shown as text with
a hidden input instead of a one-item dropdown.

**Before the order is sent**, the browser checks:

- honeypot field (`website`) — invisible to humans, so any value means a bot
- minimum dwell time of 3 seconds between opening the form and submitting
- a 30-second cooldown since this browser's last order
- name present (2+ characters)
- mobile number, if given, matches `09XXXXXXXXX` or `+639XXXXXXXXX` — it is **optional**
- delivery address of at least 10 characters when fulfillment is Delivery
- preferred date present and not before the shop's available-from date
- the "I confirm my details are correct" checkbox
- a payment receipt uploaded, when the payment method is QR
- that the chosen fulfillment and payment methods are still enabled in settings

Failures are shown inline per field (with `aria-invalid`) plus a banner at the top of the
dialog. Then the page re-fetches live products and compares them to the cart; if anything
changed the dialog closes, the cart reopens, and the customer is asked to review.

Finally it calls the PostgreSQL function **`place_order`** through Supabase RPC. That
function is where the real work happens, inside one transaction:

1. validates name, fulfillment, address, date, payment method and items again
2. generates a unique order code `BIL-` + 6 characters
3. `SELECT … FOR UPDATE` locks every product row in the cart
4. re-checks availability and stock, and computes the total from the **database's**
   prices, not the browser's
5. inserts the order and its line items
6. deducts stock, marking a product unavailable when it hits zero
7. returns the finished order, including a private `cancel_token`

So two customers racing for the last item cannot both get it, and a tampered price in the
browser changes nothing.

After the RPC returns, everything else is bookkeeping the customer does not wait for: the
receipt upload and the Google Sheets sync are fired off without blocking, the cart is
cleared, and the confirmation dialog appears.

### 3.5 QR payment and receipts

When the shop has a QR code configured, choosing **QR Payment** shows the code with a
"Save QR Code" link and a required receipt upload. JPG, PNG, WEBP and PDF are accepted.

Images are compressed **in the browser** before upload — resized to 1280px on the long
side, then JPEG-encoded stepping quality down (0.70 → 0.55 → 0.42) only while the result
is still over a ~180 KB budget, using `OffscreenCanvas` where available so the UI does not
jank. An original that is already smaller than the re-encoded version is kept as-is. PDFs
are passed through untouched, capped at 3 MB; images are rejected above 12 MB.

The receipt is **not** stored in Supabase. It is posted as base64 to a Google Apps Script
web app, which files it in Google Drive. The request uses `mode: 'no-cors'`, so the
browser never sees the response or the Drive URL, and nothing in the database points at
the file. Admin retrieves it later by asking the Apps Script to resolve the order code.

The same Apps Script endpoint also receives a copy of each order for the shop's
spreadsheet. Both calls are fire-and-forget: if the Apps Script is down, the order is
still safely in Supabase.

### 3.6 The order confirmation and "My Order"

The confirmation dialog shows the order code, timestamp, line items, total, and the
fulfillment/date/payment line. It offers **Copy Order Number**, **Message us**, and
**Continue Shopping**.

The order is saved to `localStorage` (`bilihan_latest_order_v3`), which makes a **My
Order** button appear in the header and mobile menu. It reopens the same dialog at any
time, from that browser.

**Cancellation is not self-service.** A customer who wants to change or cancel an order
messages the shop in the chat and the owner cancels from Admin. The `cancel_order`
function still exists in the database and still requires both the order code and the
private token stored in that customer's browser, so a cancellation a customer had already
queued offline before this change still goes through on their next visit.

### 3.7 The chat widget

`support.js` is self-contained: it builds its own button and panel and injects them, and
exposes `window.BilihanSupport.open()` so the confirmation dialog's "Message us" button
can call it.

- A customer who ordered from this browser is **recognised automatically** from the
  stored order.
- On another device they identify themselves once with an order number (case and spacing
  ignored) or the mobile number they ordered with. After that the browser holds a
  per-thread token and the order number is never needed again.
- Several orders from the same person land in **one** conversation — threads are keyed on
  phone number where given, name otherwise.
- The greeting ("Hi, Maria Santos — how can we help you today?") is drawn in the browser,
  not stored as a message, so it costs no database rows.
- Sent messages appear immediately and are then reconciled with the server copy; a
  failure removes the bubble and shows why.
- Polling is 4 seconds while the panel is open and 45 seconds for the unread badge while
  it is closed, and pauses entirely when the tab is hidden.
- Limits: 2000 characters per message, 20 messages per minute per thread.

The public site can never read the chat tables directly — `anon` has no grant on them.
Customers reach their conversation only through security-definer functions that require
the thread token.

**Known trade-off:** anyone who knows a customer's order number, or the mobile number
they ordered with, can open that customer's conversation. That is what makes "chat
without signing in" possible.

### 3.8 Offline and failure behaviour

| Failure | What the customer sees |
|---|---|
| Supabase unreachable | Cached menu, a banner with **Try Again**, checkout disabled |
| supabase-js CDN blocked | Same, with wording that says the ordering system could not be reached |
| Browser goes offline | Banner appears on the `offline` event; `online` triggers a full reload of data |
| Keys not configured | Demo content, checkout disabled |
| Product image 404 | Falls back to the Bilihan logo |
| QR image fails to load | An alert in place of the code, asking them to pick another payment method |
| Chat functions missing in the DB | *"Messaging is not set up on this store yet"* — not a bogus connection error |

---

## 4. What the browser stores

All of it is per-browser, readable by the customer, and holds no secrets.

| Key | Contents |
|---|---|
| `bilihan_cart_v3` | Cart items |
| `bilihan_cache_v3` | Last fetched categories, products and settings |
| `bilihan_theme_v3` | `light` or `dark` |
| `bilihan_product_view_v1` | `grid` or `list` |
| `bilihan_latest_order_v3` | The last order, including its private `cancel_token` |
| `bilihan_last_order_at_v1` | Timestamp used for the 30-second order cooldown |
| `bilihan_pending_cancel_v3` | A cancellation queued while offline (legacy; retried on next visit) |
| `bilihan_support_v1` | Chat thread id, token, customer name |
| `bilihan_support_msgs_v1` | Cached chat messages, so the panel paints instantly |

---

## 5. Security model

The customer page runs entirely in an untrusted browser, so it is built on the assumption
that anything it sends can be forged.

- **Only public values reach the browser.** `config.js` carries the Supabase URL, the
  anon/publishable key (designed for browser use and guarded by Row Level Security), the
  public Apps Script endpoint, and the site URL. No service_role key, no secret, no admin
  credential is in this repository.
- **RLS gives the public read-only access** to `categories`, `products`, `store_settings`
  and the two public storage buckets. Customers cannot write to any table.
- **Orders go through `place_order`**, a security-definer function, not through a table
  insert. Prices, stock and totals are all recomputed server-side.
- **Client-side validation is a courtesy**, not a control; every rule that matters is
  re-checked in SQL.
- **Spam protection is deliberately light**: honeypot, dwell time, cooldown. These stop
  casual bots but run in the browser, so a determined attacker bypasses them. For a
  high-traffic launch, put a server-side control in front of `place_order` — Supabase
  rate limiting, Cloudflare Turnstile, or an Edge Function verifying a CAPTCHA token.
- **Every dynamic string is escaped** before being written into HTML (`esc()` in both
  `app.js` and `support.js`).
- **Receipts are never made public.** The Apps Script endpoint only redirects; Drive
  decides who may look. Order codes are short and guessable, so link-sharing must not be
  switched on for the receipts folder.

---

## 6. Performance, accessibility and SEO

**Performance.** Cache-first paint; preconnects to Supabase and the CDN; `fetchpriority`
on the hero image and `loading="lazy"` on everything below it; explicit `width`/`height`
on images against layout shift; one delegated click listener for the whole product grid;
hero dots rebuilt only when the image list itself changes; receipts compressed before
they cross a phone connection.

**Accessibility.** A skip link to the products; `aria-live` on the grid, toasts and the
connection banner; `aria-invalid` plus an inline message on every failed field; the cart
drawer marked `inert` while closed; focus moved into dialogs on open and returned on
close; Escape closes the chat; `prefers-reduced-motion` stops the hero rotation; every
image has `alt` text, decorative ones `alt=""` and `aria-hidden`; text and background
pairs meet WCAG AA in both themes.

**SEO and sharing.** Unique title, description and canonical URL; Open Graph and Twitter
card tags with a 1200×630 preview; `Store` JSON-LD with currency and payment methods;
`sitemap.xml` and `robots.txt`; a custom `404.html`. `admin.html` is `noindex` and
disallowed in `robots.txt`.

**Installable.** `site.webmanifest` plus the icon set make the storefront installable to
a phone home screen.

**Analytics are off by default.** With `ANALYTICS` configured in `config.js`, only page
views and two non-identifying events (`order_placed`, `order_cancelled`) are sent — never
a name, number, address, or order contents. Plausible and Umami are cookieless and need
no consent banner; GA4 sets cookies and would.

---

## 7. Changing the customer page

Most changes do **not** belong in this repository:

| To change | Go to |
|---|---|
| Products, prices, stock, photos, categories | Admin → Products |
| Business name, logo, contact details, pickup location | Admin → Store Settings |
| Hero title, tagline, images; about text and image | Admin → Store Settings |
| QR payment image | Admin → Store Settings |
| Whether delivery, preferred date, stock counts, QR or cash appear | Admin → Store Settings flags |
| Replying to customer chat | Admin → Messages |

Edit this repository only for layout, styling, behaviour, or the one-time values in
`config.js` (Supabase keys, Apps Script URL, analytics, site URL).

If the domain changes, update the canonical and Open Graph URLs in `index.html`, plus
`robots.txt`, `sitemap.xml`, and `SITE_URL` in `config.js`.

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Ordering is temporarily unavailable" | Supabase unreachable, or a free project paused after a week of inactivity |
| "Store database is not connected yet" | `SUPABASE_URL` / `SUPABASE_ANON_KEY` still placeholders in `config.js` |
| No products, only "No products here yet" | No products in Admin, or none in the selected category |
| Contact links missing from the footer | Those settings are still at their seeded defaults, so they are hidden by design |
| Checkout says no payment method is available | Both `show_qr_payment` and `show_cash_payment` are off, or QR is on with no QR image uploaded |
| "Messaging is not set up on this store yet" | `supabase-setup.sql` has not been re-run, so the chat functions do not exist |
| Receipt button in Admin opens an error | The Apps Script has not been redeployed with the receipt route (see `README.md`) |
| Order rejected with "no longer has enough stock" | Stock changed between page load and checkout — correct behaviour, the database won |
