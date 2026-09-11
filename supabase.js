/* Creates the browser Supabase client.

   The supabase-js library is loaded from a CDN, so it can be missing (blocked
   network, CDN outage, captive portal). When that happens we must degrade to the
   cached/offline storefront instead of throwing and leaving a blank page. */
(() => {
  const cfg = window.BILIHAN_CONFIG || {};
  const libReady = typeof window.supabase?.createClient === 'function';
  const hasKeys = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_ANON_KEY
    && !String(cfg.SUPABASE_URL).startsWith('PASTE_') && !String(cfg.SUPABASE_ANON_KEY).startsWith('PASTE_');

  window.BILIHAN_SUPABASE_LIB_MISSING = !libReady;
  window.BILIHAN_SUPABASE_CONFIGURED = libReady && hasKeys;
  window.db = null;

  if (!libReady) { console.error('Bilihan: supabase-js failed to load. Running in offline/cached mode.'); return; }
  if (!hasKeys) { console.warn('Bilihan: Supabase URL/key not configured in config.js.'); return; }

  try {
    window.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch (err) {
    console.error('Bilihan: could not create the Supabase client.', err);
    window.BILIHAN_SUPABASE_CONFIGURED = false;
  }
})();
