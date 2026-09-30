/* Seller page: read-only sales, opened from a shared link with no sign-in.

   Everything here comes from seller_sales(), which the link token authorises. A
   customer's name and what they chose is as far as that function goes: no phone,
   no email, no address, no order code, so this page cannot be turned into a
   customer list however hard somebody pokes at it. */
(() => {
  const POLL_MS = 3000;          /* matches the admin dashboard, so the two agree */
  const $ = id => document.getElementById(id);
  const money = n => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = n => Number(n || 0).toLocaleString('en-PH');
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const token = new URLSearchParams(location.search).get('t') || '';
  let lastSignature = '';
  let busy = false;
  /* Which folders the reader has opened. Kept out here because the list is rebuilt
     whenever the figures move, and the open ones have to survive that. */
  const openSellers = new Set();
  let everPainted = false;

  function fail(message) {
    $('sellerError').textContent = message;
    $('sellerError').classList.remove('hidden');
    $('sellerAsOf').textContent = '';
  }

  /* The same three states the admin sets in Orders, in the same three colours, so
     the seller reads the chip the shop owner is looking at. */
  const PAY_STATES = { 'Paid': 'paid', 'Pending': 'pending', 'Not Paid': 'unpaid' };
  function payChip(status) {
    /* No status at all means the database has not been told about this column yet,
       not that the order is pending. Saying "Pending" there would be a confident
       wrong answer; a dash says plainly that nothing is known. */
    if (!PAY_STATES[status]) return '<span class="buyers-none" title="Payment status unavailable. Re-run supabase-setup.sql.">&mdash;</span>';
    return `<span class="pay-chip pay-${PAY_STATES[status]}">${esc(status)}</span>`;
  }

  /* Customer | Variants | Payment | Quantity for one item. The choices column only
     earns its place when something was actually chosen, or an item with no variants
     gets a column of dashes. */
  function buyersTable(buyers) {
    if (!buyers.length) return '<p class="seller-item-empty">Nobody has ordered this yet.</p>';
    const anyVariants = buyers.some(b => String(b.variants || '').trim());
    return `<div class="buyers-table-wrap"><table class="buyers-table">
      <thead><tr><th scope="col">Customer</th>${anyVariants ? '<th scope="col">Variants</th>' : ''}<th scope="col">Payment</th><th scope="col" class="num">Quantity</th></tr></thead>
      <tbody>${buyers.map(b => `<tr><td class="buyers-name">${esc(b.name)}</td>${anyVariants ? `<td class="buyers-variants">${esc(b.variants) || '<span class="buyers-none">&mdash;</span>'}</td>` : ''}<td class="buyers-pay">${payChip(b.payment_status)}</td><td class="num">${num(b.qty)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }

  /* Item | Qty | Seller price | Interest | Overall for every item of one seller.
     The data-label on each figure is what the phone layout shows in place of the
     table head, which is too wide to keep five columns on a small screen. */
  function moneyTable(items, totals) {
    return `<div class="seller-table-wrap"><table class="seller-table">
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Seller price</th><th scope="col" class="num">Interest</th><th scope="col" class="num">Overall</th></tr></thead>
      <tbody>${items.map(it => `<tr><td>${esc(it.name)}</td><td class="num" data-label="Qty">${num(it.qty)}</td><td class="num" data-label="Seller price">${money(it.original_total)}</td><td class="num" data-label="Interest">${money(it.interest_total)}</td><td class="num seller-row-total" data-label="Overall">${money(overallOf(it))}</td></tr>`).join('')}</tbody>
      ${totals ? `<tfoot><tr><td>${esc(totals.label)}</td><td class="num" data-label="Qty">${num(totals.qty)}</td><td class="num" data-label="Seller price">${money(totals.original_total)}</td><td class="num" data-label="Interest">${money(totals.interest_total)}</td><td class="num seller-row-total" data-label="Overall">${money(overallOf(totals))}</td></tr></tfoot>` : ''}
    </table></div>`;
  }

  /* Trusted when the database sends it, added up here when it does not, so the column
     always matches the two beside it rather than having to be taken on trust. */
  const overallOf = r => r.overall != null ? Number(r.overall) : Number(r.original_total || 0) + Number(r.interest_total || 0);

  /* A seller's folder: shut, it is one line. Open, it is everything they sold and who
     bought it. The name is the id, so reopening survives the next refresh. */
  function folderHtml(seller, index) {
    const items = seller.items || [];
    const id = `sellerFolder${index}`;
    const open = openSellers.has(seller.name);
    return `<section class="seller-folder${open ? ' is-open' : ''}">
      <h2 class="seller-folder-heading">
        <button type="button" class="seller-folder-head" aria-expanded="${open}" aria-controls="${id}" data-seller="${esc(seller.name)}">
          <span class="seller-folder-caret" aria-hidden="true">&rsaquo;</span>
          <span class="seller-folder-name">${esc(seller.name)}</span>
          <span class="seller-folder-figs">
            <span class="seller-folder-qty">${num(seller.qty)} sold &middot; ${items.length} item${items.length === 1 ? '' : 's'}</span>
            <span class="seller-folder-overall">${money(overallOf(seller))}</span>
          </span>
        </button>
      </h2>
      <div class="seller-folder-body" id="${id}"${open ? '' : ' hidden'}>
        ${moneyTable(items, { label: 'All items', qty: seller.qty, original_total: seller.original_total, interest_total: seller.interest_total, overall: seller.overall })}
        ${items.map(it => `<div class="seller-item-buyers"><h3 class="seller-item-heading">Who ordered <span>${esc(it.name)}</span></h3>${buyersTable(it.buyers || [])}</div>`).join('')}
      </div>
    </section>`;
  }

  function paintFolders(sellers) {
    /* Only one seller means there is nothing to choose between, so it starts open. */
    if (!everPainted && sellers.length === 1) openSellers.add(sellers[0].name);
    $('sellerBody').innerHTML = sellers.length
      ? `<div class="seller-folders">${sellers.map(folderHtml).join('')}</div>`
      : '<p class="seller-empty seller-empty-block">No sales yet.</p>';
  }

  /* What the page can still show when the database has not been updated to record who
     sells what. The figures are right; only the grouping by seller is missing, and
     saying so beats a blank page or a silent half-answer. */
  function paintFlat(items) {
    const totals = items.reduce((a, r) => ({
      label: a.label,
      qty: a.qty + Number(r.qty || 0),
      original_total: a.original_total + Number(r.original_total || 0),
      interest_total: a.interest_total + Number(r.interest_total || 0)
    }), { label: 'All items', qty: 0, original_total: 0, interest_total: 0 });
    $('sellerBody').innerHTML = `<p class="seller-notice">Sales are not grouped by seller yet. Run <code>supabase-setup.sql</code> on the store database and this page will fill in each seller's folder.</p>`
      + (items.length ? moneyTable(items, totals) : '<p class="seller-empty seller-empty-block">No sales yet.</p>');
  }

  function paint(data) {
    /* seller_sales sends the per-seller shape when the database knows about sellers.
       Anything else means an older database, and the flat list is the honest answer. */
    const sellers = Array.isArray(data.sellers) ? data.sellers : null;
    const items = data.items || [];
    /* Repaint only when something actually changed: this runs every few seconds and
       rebuilding the page each time would fight anyone reading it. */
    const signature = JSON.stringify(sellers || items) + data.overall + data.interest;
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (sellers) paintFolders(sellers); else paintFlat(items);
      everPainted = true;
      $('sellerQty').textContent = num(data.total_qty);
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
    /* Delegated, because the folders are rebuilt from scratch whenever the figures
       move and a handler bound to one would go with it. */
    $('sellerBody').addEventListener('click', e => {
      const head = e.target.closest('.seller-folder-head');
      if (!head) return;
      const name = head.dataset.seller || '';
      const panel = document.getElementById(head.getAttribute('aria-controls'));
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      head.closest('.seller-folder').classList.toggle('is-open', open);
      if (open) openSellers.add(name); else openSellers.delete(name);
    });
    load();
    setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
