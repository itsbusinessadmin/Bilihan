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
- `bilihan-logo.png` — Bilihan logo
- `config.js` — one-time public Supabase URL + anon key
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
