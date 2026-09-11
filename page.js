/* Bilihan — shared script for the standalone pages (privacy, terms, 404).

   Keeps the theme, brand name, copyright year, and contact details on those
   pages in sync with the live store settings, so nothing has to be hand-edited
   in two places. */
(() => {
  const THEME_KEY = 'bilihan_theme_v3';
  document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';

  const $ = id => document.getElementById(id);
  const yearEl = $('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const PLACEHOLDERS = ['+63 900 000 0000', 'https://m.me/', 'https://instagram.com/', 'Your pickup location here'];
  const real = value => {
    const v = String(value || '').trim();
    return v && !PLACEHOLDERS.includes(v) ? v : '';
  };
  const telHref = phone => 'tel:' + phone.replace(/[^\d+]/g, '');

  function renderContact(settings) {
    const name = real(settings.business_name) || 'Bilihan';
    document.querySelectorAll('[data-store-name]').forEach(el => { el.textContent = name; });
    if (settings.logo_url) document.querySelectorAll('img[data-store-logo]').forEach(img => { img.src = settings.logo_url; });

    const links = [];
    const phone = real(settings.phone);
    const email = real(settings.email);
    const messenger = real(settings.messenger_url);
    const instagram = real(settings.instagram_url);
    if (phone) links.push(`<a href="${telHref(phone)}">${phone}</a>`);
    if (email) links.push(`<a href="mailto:${email}">${email}</a>`);
    if (messenger) links.push(`<a href="${messenger}" target="_blank" rel="noopener noreferrer">Messenger</a>`);
    if (instagram) links.push(`<a href="${instagram}" target="_blank" rel="noopener noreferrer">Instagram</a>`);

    document.querySelectorAll('[data-store-contact]').forEach(el => {
      el.innerHTML = links.length
        ? links.join('')
        : '<a href="index.html#contact">Contact us through the store</a>';
    });
  }

  renderContact({});
  if (!window.BILIHAN_SUPABASE_CONFIGURED || !window.db) return;
  window.db.from('store_settings').select('*').eq('id', 1).single()
    .then(({ data, error }) => { if (!error && data) renderContact(data); })
    .catch(() => { /* the pages are fully readable without live settings */ });
})();
