/* Bilihan v3 — one-time public configuration.

   Everything in this file is served to the browser, so it must only ever contain
   values that are safe to be public. The Supabase anon key is designed for browser
   apps and is protected by Row Level Security. Never put a service_role key, an
   API secret, a database password, or an admin credential in this file or in any
   other file in this repository. */
window.BILIHAN_CONFIG = {
  /* Canonical site origin, used for links shared outside the browser. */
  SITE_URL: 'https://bilihan.shop',

  /* Supabase project URL + anon/publishable key (public by design, guarded by RLS). */
  SUPABASE_URL: 'https://nrwiblxfqfovmnoofiii.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_jCK3L5lQUejcSYQ4yau8sw_xLqUXanu',

  /* Google Apps Script web app used for the order spreadsheet + receipt uploads.
     This endpoint is public because the browser calls it directly, so the Apps
     Script itself must validate every request. Leave empty to turn the sync off. */
  GOOGLE_SHEETS_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbwDiNU-R9HQDL79QlO6kObtnpS7XCxc2_xoHL3Dk1becwEEjPtAx43WZcUpNWDW3L35/exec',

  /* Privacy-first analytics. Disabled until you fill this in, and never loaded
     until the visitor accepts analytics in the cookie banner.

     Plausible:  { provider: 'plausible', domain: 'bilihan.shop' }
     Umami:      { provider: 'umami', src: 'https://your-umami/script.js', websiteId: 'uuid' }
     Google GA4: { provider: 'ga4', id: 'G-XXXXXXXXXX' }                                   */
  ANALYTICS: null
};
