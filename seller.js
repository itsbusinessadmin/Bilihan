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
    const signature = JSON.stringify(items) + data.overall + data.interest;
    if (signature !== lastSignature) {
      lastSignature = signature;
      $('sellerRows').innerHTML = items.length
        /* Overall per row is the two beside it added up, so the column adds to the
           Overall total above rather than having to be taken on trust. The data-label
           on each figure is what the phone layout shows in place of the table head,
           which is too wide to keep five columns on a small screen. */
        ? items.map(r => `<tr><td><span class="seller-item-name">${esc(r.name)}</span><button type="button" class="seller-who" data-item="${esc(r.name)}">Who ordered</button></td><td class="num" data-label="Qty">${Number(r.qty || 0)}</td><td class="num" data-label="Seller price">${money(r.original_total)}</td><td class="num" data-label="Interest">${money(r.interest_total)}</td><td class="num seller-row-total" data-label="Overall">${money(Number(r.original_total || 0) + Number(r.interest_total || 0))}</td></tr>`).join('')
        : '<tr><td colspan="5" class="seller-empty">No sales yet.</td></tr>';
      $('sellerQty').textContent = Number(data.total_qty || 0).toLocaleString('en-PH');
      $('sellerOriginal').textContent = money(data.original);
      $('sellerInterest').textContent = money(data.interest);
      /* Overall is cost plus markup, the same figure the admin calls Total Sell. */
      $('sellerOverall').textContent = money(data.overall);
      $('sellerTotals').classList.remove('hidden');
    }
    const when = new Date(data.as_of || Date.now());
    $('sellerAsOf').textContent = `Updated ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    $('sellerError').classList.add('hidden');
  }

  /* Who ordered one item. The same link token authorises it, and the function
     behind it returns names and quantities only: no phone, email or address. */
  let openItem = null;
  let openSignature = '';

  function buyersMarkup(title, body) {
    return `<div class="modal-body">
      <button type="button" class="icon-btn modal-close" id="buyersClose" aria-label="Close"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button>
      <h2 class="buyers-title">${esc(title)}</h2>
      ${body}
    </div>`;
  }

  function paintBuyers(data) {
    const buyers = data.buyers || [];
    /* Same guard as the table: rebuilding this every few seconds would drop the
       focus ring and any selected text while nothing had actually changed. */
    const signature = data.name + JSON.stringify(buyers);
    if (signature === openSignature) return;
    openSignature = signature;
    const body = buyers.length
      ? `<p class="muted buyers-sub">${Number(data.total_qty || 0).toLocaleString('en-PH')} sold to ${buyers.length} ${buyers.length === 1 ? 'customer' : 'customers'}</p>
         <div class="buyers-table-wrap"><table class="buyers-table">
           <thead><tr><th scope="col">Customer</th><th scope="col" class="num">Quantity</th></tr></thead>
           <tbody>${buyers.map(b => `<tr><td>${esc(b.name)}</td><td class="num">${Number(b.qty || 0).toLocaleString('en-PH')}</td></tr>`).join('')}</tbody>
         </table></div>`
      : '<p class="muted buyers-sub">Nobody has ordered this yet.</p>';
    $('buyersDialog').innerHTML = buyersMarkup(data.name || '', body);
    $('buyersClose').onclick = () => $('buyersDialog').close();
  }

  async function loadBuyers(name) {
    const { data, error } = await window.db.rpc('seller_item_buyers', { p_token: token, p_name: name });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'This link is no longer valid.');
    /* Only paint if this is still the item on screen: a slow reply for one item
       must not overwrite the list someone has already moved on to. */
    if (openItem === name) paintBuyers(data);
  }

  async function openBuyers(name) {
    openItem = name;
    openSignature = '';
    const dlg = $('buyersDialog');
    dlg.innerHTML = buyersMarkup(name, '<p class="muted buyers-sub">Loading…</p>');
    $('buyersClose').onclick = () => dlg.close();
    if (!dlg.open) dlg.showModal();
    try {
      await loadBuyers(name);
    } catch (err) {
      console.warn('Buyers lookup failed', err);
      if (openItem === name) {
        dlg.innerHTML = buyersMarkup(name, `<p class="muted buyers-sub">${esc(err.message || 'We could not load this just now.')}</p>`);
        $('buyersClose').onclick = () => dlg.close();
      }
    }
  }

  async function load() {
    if (busy || document.hidden) return;      /* a background tab spends quota for nothing */
    busy = true;
    try {
      const { data, error } = await window.db.rpc('seller_sales', { p_token: token });
      if (error) throw error;
      if (!data?.ok) { fail(data?.error || 'This link is no longer valid.'); return; }
      paint(data);
      /* An open list refreshes with the table, so it does not sit on figures the
         row behind it has already moved past. */
      if (openItem) loadBuyers(openItem).catch(err => console.warn('Buyers refresh failed', err));
    } catch (err) {
      console.warn('Sales refresh failed', err);
      /* A blip leaves the last figures on screen rather than blanking them. */
      if (!lastSignature) fail('We could not load the sales just now. This page will keep trying.');
    } finally { busy = false; }
  }

  function boot() {
    if (!window.BILIHAN_SUPABASE_CONFIGURED || !window.db) { fail('This page is not connected to the store yet.'); return; }
    if (!token) { fail('This link is missing its code. Ask the store for the full link.'); return; }
    /* Delegated, because the table is rebuilt from scratch whenever the figures
       move and a handler bound to a row would go with it. */
    $('sellerRows').addEventListener('click', e => {
      const btn = e.target.closest('.seller-who');
      if (btn) openBuyers(btn.dataset.item || '');
    });
    $('buyersDialog').addEventListener('close', () => { openItem = null; });
    load();
    setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
