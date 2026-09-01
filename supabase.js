(() => {
  const cfg = window.BILIHAN_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.startsWith('PASTE_') && !cfg.SUPABASE_ANON_KEY.startsWith('PASTE_');
  window.BILIHAN_SUPABASE_CONFIGURED = !!configured;
  window.db = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
})();
