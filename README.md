# Bilihan v3 — Supabase Edition

Bilihan v3 replaces Google Sheets / Apps Script with Supabase.

## What v3 uses
- GitHub Pages (or any static host) for `index.html` and `admin.html`
- Supabase Postgres for products, categories, settings, stock, orders, and cancellations
- Supabase Storage for product photos, QR code images, and storefront images
- Supabase Auth for the Admin login
- Row Level Security (RLS) so customers can read the storefront but cannot edit business data
- PostgreSQL RPC functions for atomic order placement and 3-hour cancellations

## Files
- `index.html` — customer store
- `admin.html` — admin dashboard
- `app.js` — customer logic
- `admin.js` — admin logic
- `styles.css` — UI
- `theme-storefront.css` — the alternate storefront design, off unless it is selected in Admin
- `bilihan-logo.png` — Bilihan logo
- `404.html` — custom not-found page (GitHub Pages serves this automatically)
- `analytics.js` — analytics loader (does nothing until configured)
- `support.js` — customer support chat widget
- `bilihan-mark.webp` — small logo used in the header and footer lockups
- `favicon.ico`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — site icons
- `og-image.jpg` — social sharing preview (1200×630)
- `site.webmanifest` — installable web app metadata
- `robots.txt`, `sitemap.xml` — search engine files
- `config.js` — one-time public configuration (Supabase URL + anon key, analytics)
- `supabase.js` — creates the browser client
- `supabase-setup.sql` — database tables, policies, storage buckets, and safe order functions

## Setup — step by step

### 1. Create a free Supabase project
Go to Supabase and create a project. Wait for it to finish provisioning.

### 2. Run the SQL setup
Open **SQL Editor -> New query** in Supabase. Paste the entire contents of `supabase-setup.sql` and click **Run**.

This creates:
- `categories`
- `products`
- `store_settings`
- `orders`
- `order_items`
- `admin_users`
- `product-images` Storage bucket
- `store-assets` Storage bucket
- secure `place_order` and `cancel_order` functions
- RLS policies

### 3. Create your Admin account
Open **Authentication -> Users -> Add user**. Create your email/password user.

Copy that user's UUID. Then return to **SQL Editor** and run:

```sql
insert into public.admin_users(user_id)
values ('PASTE-YOUR-AUTH-USER-UUID-HERE');
```

This is what gives that Auth account permission to edit Bilihan.

### 4. Get your Project URL and anon public key
Open **Project Settings -> API** (the exact Supabase dashboard labels can vary slightly).
Copy your Project URL and **anon / publishable public key**.

Open `config.js` and replace the two placeholders:

```js
window.BILIHAN_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY'
};
```

The browser anon/public key is intended for frontend use and is protected by RLS. **Never put your service_role key in this project.**

This is the only normal setup edit you need to make in GitHub. After that, day-to-day store changes happen through Admin.

### 5. Deploy to GitHub Pages
Upload all Bilihan v3 files to your repository. Keep them in the same folder.

GitHub -> repository **Settings -> Pages -> Deploy from a branch -> main / root**.

Customer store:
`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

Admin:
`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/admin.html`

### 6. Sign in to Admin
Open `admin.html` and use the email/password you created in Supabase Authentication.

You can then manage:
- Products
- Product stock
- Categories
- Product photos
- Business name
- Contact number
- Messenger / Instagram
- Pickup location
- QR image
- Hero copy/images
- About section
- Orders

Changes save to Supabase and are visible to customers without editing the GitHub source.

## Customer order behavior
When a customer places an order, the `place_order` PostgreSQL function locks the product rows, rechecks stock and authoritative prices, inserts the order, inserts its line items, and deducts inventory in the same database transaction.

This is much safer than relying on Local Storage or Google Sheets for simultaneous customers.

## Cancellation behavior
The customer receives a private cancellation token stored with their latest order in their browser. The public customer site cannot simply cancel arbitrary orders. `cancel_order` requires both the order code and the private token and checks that the cancellation was requested within 3 hours.

If the customer goes offline while cancelling, the site queues the request locally and retries after reconnecting. The original request timestamp is sent back to Supabase.

## Security notes
- Do not expose the Supabase `service_role` key.
- Admin writes require an authenticated user that exists in `admin_users`.
- Public users have read-only access to storefront data through RLS.
- Orders and stock changes happen through security-definer functions rather than unrestricted public table writes.
- For a serious production launch, also add CAPTCHA/rate limiting or an Edge Function in front of public order placement if abuse becomes a concern.

---

## Launch checklist

Applied to the storefront. The page layout is unchanged — the only visible additions are a
mobile menu button, an About link in the desktop nav, and clickable contact details in the footer.

| Item | Status |
|------|--------|
| Secrets off the frontend | Only the Supabase anon key (public by design, guarded by RLS) and the public Apps Script endpoint reach the browser; both documented in `config.js` |
| Force HTTPS | `upgrade-insecure-requests` plus an `http:` → `https:` redirect. **Also switch on GitHub → Settings → Pages → Enforce HTTPS** |
| Meta titles + descriptions | Unique title, description and canonical URL |
| Social preview image | `og-image.jpg` (1200×630) with Open Graph + Twitter card tags |
| Favicon | `favicon.ico`, PNG icons, Apple touch icon, `site.webmanifest` |
| Sitemap + robots.txt | `sitemap.xml` and `robots.txt` (admin disallowed); `admin.html` is `noindex` |
| Alt text on images | Every `<img>` has `alt`; decorative images use `alt=""` + `aria-hidden` |
| Compressed images | `bilihan-logo.png` 1.34 MB → 102 KB; header/footer use a 7 KB WebP mark |
| Page load speed | Preconnects, `loading="lazy"`, `fetchpriority` on the hero, explicit `width`/`height` against layout shift |
| Colour contrast | Every rendered text/background pair passes WCAG AA in light and dark |
| Mobile friendly | Verified 320 px → 1600 px |
| Custom 404 page | `404.html` |
| Broken links | All internal links, anchors and assets verified |
| Form validation | Inline per-field errors with `aria-invalid`, plus server-side re-checks of stock and price |
| Spam protection | Honeypot field, minimum form dwell time, 30-second order cooldown |
| Analytics | `analytics.js` — see below |
| One clear call to action | "Shop Now" in the hero, "Checkout" in the cart |
| No horizontal scroll | Verified at ten widths with overflow clipping disabled |
| Mobile menu | Hamburger menu with Home, Products, About, My Order and contact details |
| Footer links | Products and About, alongside the contact details |
| Copyright year | In the HTML and refreshed by JS |
| Clickable logo / number / email | Logo links home; phone uses `tel:`, email uses `mailto:` |
| No placeholder text | Seeded defaults such as `+63 900 000 0000` are treated as "not set" and hidden |
| Success + error messages | Toast on success; alert banner plus per-field messages on failure |

Deliberately **not** included, at your request: privacy policy page, terms & conditions page,
and cookie consent banner.

## Before you go live

1. **Run the two new columns** in Supabase → SQL Editor:
   ```sql
   alter table public.store_settings add column if not exists logo_url text;
   alter table public.store_settings add column if not exists email text;
   alter table public.store_settings add column if not exists storefront_skin text not null default 'original';
   alter table public.store_settings drop constraint if exists store_settings_storefront_skin_check;
   alter table public.store_settings add constraint store_settings_storefront_skin_check
     check (storefront_skin in ('original','storefront'));
   ```
2. **Fill in Store Settings** in Admin: business name, contact number, contact email, Messenger,
   Instagram, pickup location. Anything left at its seeded default is hidden from customers rather
   than shown as placeholder text.
3. **Turn on Enforce HTTPS** in GitHub → Settings → Pages.
4. **Submit the sitemap** at `https://bilihan.shop/sitemap.xml` in Google Search Console.
5. **If you change domain**, update the canonical/Open Graph URLs in `index.html`, `robots.txt`,
   `sitemap.xml`, and `SITE_URL` in `config.js`.

## Storefront theme

The storefront can wear one of two designs, chosen in **Admin → Appearance → Storefront theme**:

| Option | What it is |
| --- | --- |
| **Original** | The design the store ships with, in `styles.css`. |
| **Bilihan Storefront** | The imported Bilihan Storefront design, in `theme-storefront.css`. |

The choice is stored once in `store_settings.storefront_skin` and applies to every customer.
It is a separate thing from the light/dark toggle in the storefront header, which stays a
per-visitor choice and keeps working under either design.

How it is applied: `app.js` puts the chosen design on the page as `<html data-skin="…">`, and
every rule in `theme-storefront.css` is scoped under `html[data-skin="storefront"]`, so that
file has no effect at all while **Original** is selected. The chosen design is also mirrored
into `localStorage` so a returning visitor gets the right look on first paint instead of a flash
of the other one.

**Bilihan Storefront is not imported yet.** `theme-storefront.css` is still empty, so the option
is listed in Admin but cannot be selected — the shop can never be pointed at a design that is not
there. To finish it: fill in `theme-storefront.css`, then set `ready` to `true` for the
`storefront` entry in `SKIN_OPTIONS` near the top of `appearance()` in `admin.js`.

## Turning on analytics

Off until configured. Set `ANALYTICS` in `config.js` to one of:

```js
ANALYTICS: { provider: 'plausible', domain: 'bilihan.shop' }
ANALYTICS: { provider: 'umami', src: 'https://your-umami/script.js', websiteId: 'your-uuid' }
ANALYTICS: { provider: 'ga4', id: 'G-XXXXXXXXXX' }
```

Only page views and two non-identifying events (`order_placed`, `order_cancelled`) are sent — no
customer name, phone number, address, or order contents. Plausible and Umami are cookieless and
need no consent banner. GA4 sets cookies, so if you use it and expect EU/UK visitors you would
need a consent banner in front of it.

## Staying signed in to Admin

Admin remembers the browser you signed in from, so you do not re-enter your password on every
visit. The Supabase client stores the session in that browser and refreshes it in the background;
**Log Out** (Admin → Security) is what ends it.

A network failure never signs the device out. If Admin cannot reach the database on load it shows
a "Can't reach the database" screen with a **Try Again** button and keeps your session, rather than
dropping you back to the login form.

If you are still asked to sign in regularly, check **Supabase Dashboard → Authentication →
Sessions**. A "time-box user sessions" or inactivity-timeout value there ends sessions on a
schedule no matter what the site does.

Because the browser stays signed in, anyone who can use that browser profile can open Admin. Use
Log Out on shared or public computers.

## Customer support chat

A chat button sits in the corner of the storefront. A customer who ordered from
that browser is recognised automatically; on another device they identify
themselves once with an order number (case and spacing are ignored) or the mobile
number they ordered with. After that the browser holds a per-thread token and the
order number is never needed again.

Several orders from the same person land in **one** conversation. Threads are keyed
on the customer's phone number when they gave one and on their name otherwise, so
Admin sees one thread per customer rather than one per order.

Replies are in **Admin → Messages**, which carries an unread count in the sidebar.
The customer's button carries its own unread badge.

The chat opens with a greeting that uses the name on the order — "Hi, Maria Santos
— how can we help you today?". It is drawn in the browser rather than stored as a
message, so it costs no database rows and appears on every visit.

**Self-service cancellation has been removed.** The My Order dialog offers Copy
Order Number, Message us, and Continue Shopping; a customer who wants to change or
cancel now talks to you in the chat, and you cancel from Admin. The `cancel_order`
function is still in the database, and a cancellation a customer had already queued
offline before this change still goes through on their next visit.

**Run the schema again** (`supabase-setup.sql`) to create the chat tables and
functions — the new statements are all `if not exists` / `create or replace`, so
re-running the whole file is safe.

### How access is controlled

The public site can never read the chat tables. `anon` has no grant on them at all;
customers reach their conversation only through security-definer functions that
require the thread token issued at identification.

One trade-off to be aware of: **anyone who knows a customer's order number, or the
mobile number they ordered with, can open that customer's conversation.** That is
what makes "chat without signing in" possible, and it is the behaviour you asked
for. If a stronger check is worth the extra friction, requiring the order number
*and* the matching phone number together is a small change to `support_identify`.

Messages are limited to 20 per minute per thread and 2000 characters.

### Deleting conversations

**Admin → Messages → Select** ticks conversations for deletion, and **Delete All
Messages** clears the lot behind a typed confirmation. Both delete from the
database, not just the screen: `support_messages` has `on delete cascade`, so a
thread's messages go with it and the storage is genuinely reclaimed. Orders are
never touched by this.

### If the chat says it cannot reach the store

That almost always means `supabase-setup.sql` has not been re-run, so the chat
functions do not exist yet. The chat now says so explicitly instead of blaming the
connection. Run the file in Supabase → SQL Editor and try again.

New messages appear within about 4 seconds while the chat is open (Supabase
Realtime would make it instant and can be layered on later without changing the
schema).

## Capacity and latency (Admin → Security)

The Security tab reports what is actually filling your free tier, so you can see
what to prune before you hit a limit.

- **Database and file storage bars**, with warning colours from 70% and red from 90%.
- **Per-table sizes and row counts**, so you can see whether orders, order items or
  chat messages are the thing growing.
- **Round-trip times** to the Supabase database, Supabase file storage, and your
  Apps Script endpoint — median of repeated calls, so it measures your connection
  as well as the service.

Sizes come from `pg_database_size` and the storage objects table through the
admin-only `admin_usage()` function, so they are real figures rather than
estimates. **Run `supabase-setup.sql` again** to install that function.

Plan limits live in `config.js` under `USAGE_LIMITS` — nothing can read your plan
from the browser, so check them against your own Supabase plan and edit if they
differ.

Three things genuinely cannot be measured from a browser, and the tab says so
rather than inventing numbers: **bandwidth/egress** (Supabase → Reports),
**Google Drive space** used by payment receipts, and **project pausing** (free
projects pause after a week of inactivity).

## Viewing payment receipts

QR Payment orders show a **View payment receipt** button in the admin order
detail. Receipts are not stored in Supabase — `app.js` uploads them straight to
Google Drive through the Apps Script, with `mode: 'no-cors'`, so the browser
never receives the Drive URL and nothing in the database points at the file.

The button therefore asks the Apps Script to resolve the order code and redirect.
`google-apps-script/Code.gs` is the complete script including that route: select
everything in the Apps Script editor, delete it, paste that file in, then
Deploy > Manage deployments > New version. The `/exec` URL does not change, so
`config.js` needs no edit. Until you do this the button still appears but the
new tab shows an Apps Script error.

Replace the whole file rather than pasting the new route in beside the old one.
Every `.gs` file in a project shares one global scope, so a second `doGet`,
`RECEIPT_FOLDER_ID` or `jsonResponse` is a "has already been declared" error
that stops the entire script — order sync and receipt uploads included.

`testFindReceipt()` in that file checks the Drive lookup from the editor,
without deploying.

The endpoint only redirects; it never changes a receipt's sharing. Drive decides
who may look, so signed in as the account that owns the receipts folder you see
the file, and anyone else gets Google's "request access" page. Do not add a
`setSharing(ANYONE_WITH_LINK)` call to the upload or the endpoint — order codes
are short and guessable, and that would make every customer's receipt public.

## Store images

Every image picker in Admin — product photo, store logo, hero images, about image, QR code
— takes any image type your browser offers, **animated GIFs included**. Ordinary photos are
downscaled to 1600px and re-encoded to WebP in the browser before upload, because a photo
straight off a phone is several megabytes and that exact file was then served to every
customer on every visit.

GIFs and SVGs skip that re-encode on purpose: drawing them to a canvas captures only the
first frame, which would silently flatten an animation into a still. So a GIF is uploaded
and served exactly as you picked it, and it animates on the storefront.

Because nothing shrinks them, **uploads are capped at 5 MB**. Anything larger is refused as
soon as you pick it, with a message naming the file's size — and for a GIF, saying why it
was not compressed. The same limit is enforced again in the upload helper, so a form that
somehow gets past the picker cannot store an oversized file either.

Worth knowing before you use an animated hero image: a GIF's animation cannot be paused by
a visitor's "reduce motion" setting. The hero *rotation* between images respects it; the
frames inside a GIF do not.

## Spam protection

The checkout form has three client-side deterrents: a honeypot field no human can see, a minimum
dwell time before the form will submit, and a 30-second cooldown between orders from the same
browser. These stop casual bots but run in the browser, so a determined attacker can bypass them.
For a high-traffic launch, add a server-side control in front of `place_order` — Supabase rate
limiting, Cloudflare Turnstile, or an Edge Function that verifies a CAPTCHA token.
