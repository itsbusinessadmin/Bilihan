/* Bilihan — cookie / storage consent.

   Bilihan only writes strictly necessary browser storage by default (your cart,
   your theme, your latest order). Those are required for the store to work and
   are not covered by this banner. Anything optional — analytics — stays off
   until the visitor explicitly accepts it here. */
(() => {
  const KEY = 'bilihan_consent_v1';
  const VALID = ['accepted', 'rejected'];

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return VALID.includes(raw) ? raw : null;
    } catch { return null; }
  }
  function write(value) {
    try { localStorage.setItem(KEY, value); } catch { /* private mode — session only */ }
  }

  const listeners = [];
  const api = {
    /* 'accepted' | 'rejected' | null (not asked yet) */
    status: read(),
    analyticsAllowed() { return api.status === 'accepted'; },
    onChange(fn) { listeners.push(fn); if (api.status) fn(api.status); },
    set(value) {
      if (!VALID.includes(value)) return;
      api.status = value;
      write(value);
      listeners.forEach(fn => { try { fn(value); } catch (e) { console.warn(e); } });
    },
    reopen() { render(true); }
  };
  window.BilihanConsent = api;

  let banner = null;
  function render(force) {
    if (!force && api.status) return;
    if (banner) { banner.hidden = false; return; }
    banner = document.createElement('div');
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie and storage choices');
    banner.innerHTML = `
      <div class="consent-copy">
        <strong>We keep it simple.</strong>
        <p>Bilihan stores your cart, theme, and latest order in your own browser so the
        store works. We would also like to use privacy-friendly analytics to see which
        products people look for. You can say no and nothing changes for you.</p>
        <a href="privacy.html">Read our Privacy Policy</a>
      </div>
      <div class="consent-actions">
        <button type="button" class="secondary-btn" data-consent="rejected">Necessary only</button>
        <button type="button" class="primary-btn" data-consent="accepted">Accept analytics</button>
      </div>`;
    banner.querySelectorAll('[data-consent]').forEach(btn => {
      btn.addEventListener('click', () => { api.set(btn.dataset.consent); banner.hidden = true; });
    });
    document.body.appendChild(banner);
  }

  function boot() {
    render(false);
    document.querySelectorAll('[data-consent-reopen]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); api.reopen(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
