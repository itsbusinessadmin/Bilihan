/* Seller page: read-only sales, opened from a shared link with no sign-in.

   Everything here comes from seller_sales(), which the link token authorises. A
   customer's name and what they chose is as far as that function goes: no phone,
   no email, no address, no order code, so this page cannot be turned into a
   customer list however hard somebody pokes at it.

   Only orders marked Paid count towards any total. Pending and Not Paid orders are
   still listed, because the seller needs to see who has not settled up, but the
   money is reported separately as still owed rather than folded into a figure the
   shop has not actually taken. */
(() => {
  const POLL_MS = 3000;          /* matches the admin dashboard, so the two agree */
  const $ = id => document.getElementById(id);
  const money = n => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = n => Number(n || 0).toLocaleString('en-PH');
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

  const token = new URLSearchParams(location.search).get('t') || '';
  let lastSignature = '';
  let busy = false;
  /* The seller whose window is open, so a refresh redraws it in place instead of
     leaving stale figures on screen or closing it under the reader. */
  let openSeller = null;
  let openSignature = '';

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

  /* Trusted when the database sends it, added up here when it does not, so the column
     always matches the two beside it rather than having to be taken on trust. */
  const overallOf = r => r.overall != null ? Number(r.overall) : Number(r.original_total || 0) + Number(r.interest_total || 0);
  const owedOf = r => Number(r.unpaid_total || 0);

  /* What is still owed, said in the same words everywhere it appears. The figure is a
     quantity of that item, not a number of orders, so it is worded as such. */
  function owedNote(r) {
    const owed = owedOf(r);
    if (!owed) return '';
    const qty = Number(r.unpaid_qty || 0);
    return `<p class="seller-owed-note">${num(qty)} still unpaid, worth ${money(owed)} &mdash; not counted above.</p>`;
  }

  /* Customer | Variants | Payment | Quantity for one item. The choices column only
     earns its place when something was actually chosen, or an item with no variants
     gets a column of dashes. */
  function buyersTable(buyers) {
    if (!buyers.length) return '<p class="seller-item-empty">Nobody has ordered this yet.</p>';
    const anyVariants = buyers.some(b => String(b.variants || '').trim());
    /* Unpaid rows are dimmed so the eye can tell at a glance which of these the
       totals above were built from. */
    const row = b => `<tr class="${b.is_paid === false ? 'buyers-row-unpaid' : ''}"><td class="buyers-name">${esc(b.name)}</td>${anyVariants ? `<td class="buyers-variants">${esc(b.variants) || '<span class="buyers-none">&mdash;</span>'}</td>` : ''}<td class="buyers-pay">${payChip(b.payment_status)}</td><td class="num">${num(b.qty)}</td></tr>`;
    return `<div class="buyers-table-wrap"><table class="buyers-table">
      <thead><tr><th scope="col">Customer</th>${anyVariants ? '<th scope="col">Variants</th>' : ''}<th scope="col">Payment</th><th scope="col" class="num">Quantity</th></tr></thead>
      <tbody>${buyers.map(row).join('')}</tbody>
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

  /* ---------- the list of sellers ---------- */

  function sellerCard(seller) {
    const items = seller.items || [];
    const owed = owedOf(seller);
    return `<button type="button" class="seller-card" data-seller="${esc(seller.name)}">
      <span class="seller-card-main">
        <span class="seller-card-name">${esc(seller.name)}</span>
        <span class="seller-card-sub">${num(seller.qty)} paid &middot; ${items.length} item${items.length === 1 ? '' : 's'}</span>
      </span>
      <span class="seller-card-figs">
        <span class="seller-card-overall">${money(overallOf(seller))}</span>
        ${owed ? `<span class="seller-card-owed">${money(owed)} unpaid</span>` : ''}
      </span>
      <span class="seller-card-go" aria-hidden="true">&rsaquo;</span>
    </button>`;
  }

  /* ---------- one seller's window ---------- */

  function dialogMarkup(title, body) {
    return `<div class="modal-body">
      <button type="button" class="icon-btn modal-close" id="sellerDialogClose" aria-label="Close"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button>
      <h2 class="seller-dialog-title">${esc(title)}</h2>
      ${body}
    </div>`;
  }

  function wireDialogClose() {
    const close = $('sellerDialogClose');
    if (close) close.onclick = () => $('sellerDialog').close();
  }

  function paintDialog(seller) {
    /* Same guard as the list: rebuilding this every few seconds would drop the focus
       ring and any selected text while nothing had actually changed. */
    const signature = JSON.stringify(seller);
    if (signature === openSignature) return;
    openSignature = signature;
    const items = seller.items || [];
    const body = items.length
      ? `<p class="seller-dialog-sub">${num(seller.qty)} paid &middot; ${money(overallOf(seller))} overall${owedOf(seller) ? ` &middot; <span class="seller-dialog-owed">${money(owedOf(seller))} unpaid</span>` : ''}</p>
         ${moneyTable(items, { label: 'All items', qty: seller.qty, original_total: seller.original_total, interest_total: seller.interest_total, overall: seller.overall })}
         ${items.map(it => `<div class="seller-item-buyers"><h3 class="seller-item-heading">Who ordered <span>${esc(it.name)}</span></h3>${buyersTable(it.buyers || [])}${owedNote(it)}</div>`).join('')}`
      : '<p class="seller-item-empty">Nothing sold yet.</p>';
    $('sellerDialog').innerHTML = dialogMarkup(seller.name, body);
    wireDialogClose();
  }

  function openSellerWindow(name) {
    const seller = (lastSellers || []).find(s => s.name === name);
    if (!seller) return;
    openSeller = name;
    openSignature = '';
    const dlg = $('sellerDialog');
    paintDialog(seller);
    if (!dlg.open) dlg.showModal();
    $('sellerDialogClose')?.focus();
  }

  /* ---------- painting ---------- */

  let lastSellers = null;

  function paintSellers(sellers) {
    $('sellerBody').innerHTML = sellers.length
      ? `<div class="seller-cards">${sellers.map(sellerCard).join('')}</div>`
      : '<p class="seller-empty seller-empty-block">No paid sales yet.</p>';
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
    $('sellerBody').innerHTML = '<p class="seller-notice">Sales are not grouped by seller yet. Run <code>supabase-setup.sql</code> on the store database and this page will give each seller their own card.</p>'
      + (items.length ? moneyTable(items, totals) : '<p class="seller-empty seller-empty-block">No sales yet.</p>');
  }

  function paint(data) {
    /* seller_sales sends the per-seller shape when the database knows about sellers.
       Anything else means an older database, and the flat list is the honest answer. */
    const sellers = Array.isArray(data.sellers) ? data.sellers : null;
    const items = data.items || [];
    /* Repaint only when something actually changed: this runs every few seconds and
       rebuilding the page each time would fight anyone reading it. */
    const signature = JSON.stringify(sellers || items) + data.overall + data.interest + data.unpaid;
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastSellers = sellers;
      if (sellers) paintSellers(sellers); else paintFlat(items);
      $('sellerQty').textContent = num(data.total_qty);
      $('sellerOriginal').textContent = money(data.original);
      $('sellerInterest').textContent = money(data.interest);
      /* Overall is cost plus markup on settled orders, the same figure the admin
         calls Total Sell. What is still owed is kept out of it and shown beside it. */
      $('sellerOverall').textContent = money(data.overall);
      const owed = Number(data.unpaid || 0);
      $('sellerOwed').textContent = money(owed);
      $('sellerOwedCard').classList.toggle('hidden', !owed);
      $('sellerTotals').classList.remove('hidden');
      /* An open window follows the figures behind it rather than sitting on numbers
         the list has already moved past. */
      if (openSeller) {
        const still = (sellers || []).find(s => s.name === openSeller);
        if (still) paintDialog(still); else $('sellerDialog').close();
      }
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
    /* Delegated, because the cards are rebuilt from scratch whenever the figures
       move and a handler bound to one would go with it. */
    $('sellerBody').addEventListener('click', e => {
      const card = e.target.closest('.seller-card');
      if (card) openSellerWindow(card.dataset.seller || '');
    });
    $('sellerDialog').addEventListener('close', () => { openSeller = null; openSignature = ''; });
    load();
    setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
