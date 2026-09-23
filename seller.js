/* Seller page: read-only sales, opened from a shared link with no sign-in.

   Everything here comes from seller_sales(), which returns totals and nothing else.
   No order, customer or contact detail is reachable from this page even if someone
   pokes at it, because the function never returns any. */
(() => {
  const POLL_MS = 3000;          /* matches the admin dashboard, so the two agree */
  const $ = id => document.getElementById(id);
  const money = n => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const token = new URLSearchParams(location.search).get('t') || '';
  let lastSignature = '';
  let busy = false;

  function fail(message) {
    $('sellerError').textContent = message;
    $('sellerError').classList.remove('hidden');
    $('sellerAsOf').textContent = '';
  }

  function paint(data) {
    const items = data.items || [];
    /* Repaint only when something actually changed: this runs every few seconds and
       rebuilding the table each time would fight anyone reading it. */
    const signature = JSON.stringify(items) + data.overall;
    if (signature !== lastSignature) {
      lastSignature = signature;
      $('sellerRows').innerHTML = items.length
        ? items.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${Number(r.qty || 0)}</td><td class="num">${money(r.original_total)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="seller-empty">No sales yet.</td></tr>';
      $('sellerQty').textContent = Number(data.total_qty || 0).toLocaleString('en-PH');
      $('sellerOverall').textContent = money(data.overall);
      $('sellerTotals').classList.remove('hidden');
    }
    const when = new Date(data.as_of || Date.now());
    $('sellerAsOf').textContent = `Updated ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    $('sellerError').classList.add('hidden');
  }

  async function load() {
    if (busy || document.hidden) return;      /* a background tab spends quota for nothing */
    busy = true;
    try {
      const { data, error } = await window.db.rpc('seller_sales', { p_token: token });
      if (error) throw error;
      if (!data?.ok) { fail(data?.error || 'This link is no longer valid.'); return; }
      paint(data);
    } catch (err) {
      console.warn('Sales refresh failed', err);
      /* A blip leaves the last figures on screen rather than blanking them. */
      if (!lastSignature) fail('We could not load the sales just now. This page will keep trying.');
    } finally { busy = false; }
  }

  function boot() {
    if (!window.BILIHAN_SUPABASE_CONFIGURED || !window.db) { fail('This page is not connected to the store yet.'); return; }
    if (!token) { fail('This link is missing its code. Ask the store for the full link.'); return; }
    load();
    setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
