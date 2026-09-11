/* Bilihan — analytics loader.

   Loads nothing at all unless BILIHAN_CONFIG.ANALYTICS is configured AND the
   visitor accepted analytics in the cookie banner. Page views only; no order
   details, customer names, phone numbers, or addresses are ever sent. */
(() => {
  const cfg = (window.BILIHAN_CONFIG || {}).ANALYTICS;
  const api = { ready: false, track() {} };
  window.BilihanAnalytics = api;
  if (!cfg || !cfg.provider) return;

  function addScript(src, attrs = {}) {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
    return s;
  }

  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    if (cfg.provider === 'plausible' && cfg.domain) {
      addScript('https://plausible.io/js/script.js', { 'data-domain': cfg.domain });
      api.track = (name, props) => window.plausible && window.plausible(name, { props });
    } else if (cfg.provider === 'umami' && cfg.src && cfg.websiteId) {
      addScript(cfg.src, { 'data-website-id': cfg.websiteId });
      api.track = (name, props) => window.umami && window.umami.track(name, props);
    } else if (cfg.provider === 'ga4' && cfg.id) {
      addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.id)}`);
      window.dataLayer = window.dataLayer || [];
      const gtag = (...args) => window.dataLayer.push(args);
      gtag('js', new Date());
      gtag('config', cfg.id, { anonymize_ip: true });
      api.track = (name, props) => gtag('event', name, props || {});
    } else {
      console.warn('Bilihan analytics: incomplete configuration, skipping.');
      return;
    }
    api.ready = true;
  }

  const consent = window.BilihanConsent;
  if (!consent) return;
  consent.onChange(status => { if (status === 'accepted') load(); });
})();
