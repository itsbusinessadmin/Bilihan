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
  /* ---------- what this page is holding ---------- */
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
  let openItems = null;
  /* Who bought what is fetched per seller, only while their window is open. Nesting
     it in the list's own poll made that reply three hundred times larger than the
     list needed, every few seconds, nearly all of it never looked at. The cheap poll
     then says when this is worth asking for again: if a seller's totals have not
     moved, neither has anything inside their window. */
  let openPrint = '';
  let buyersBusy = false;
  /* Which item folders are open inside the seller's window, by item name. The window
     is redrawn whenever that seller's figures move, and a folder the reader opened
     must still be open afterwards. Emptied when the window closes. */
  const openItemFolders = new Set();
  /* A seller with a single item has nothing to choose between, so that one folder
     starts open -- once, when the window first fills, not on every refresh. */
  let autoOpenSingle = false;
  /* The sellers the list is currently drawing, so a window can be opened from one. */
  let lastSellers = null;

  /* ---------- pieces every table and window is built from ---------- */
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

  function paintDialog(seller, items) {
    /* Same guard as the list: rebuilding this every few seconds would drop the focus
       ring and any selected text while nothing had actually changed. */
    const signature = JSON.stringify(seller) + JSON.stringify(items);
    if (signature === openSignature) return;
    openSignature = signature;
    const head = `<p class="seller-dialog-sub">${num(seller.qty)} paid &middot; ${money(overallOf(seller))} overall${owedOf(seller) ? ` &middot; <span class="seller-dialog-owed">${money(owedOf(seller))} unpaid</span>` : ''}</p>`;
    let body;
    if (!(seller.items || []).length) body = '<p class="seller-item-empty">Nothing sold yet.</p>';
    else if (!items) {
      /* The totals are already here, so show them rather than an empty window while
         the buyers are still on their way. */
      body = head
        + moneyTable(seller.items, { label: 'All items', qty: seller.qty, original_total: seller.original_total, interest_total: seller.interest_total, overall: seller.overall })
        + '<p class="seller-item-empty">Loading who ordered&hellip;</p>';
    } else {
      if (autoOpenSingle) { autoOpenSingle = false; if (items.length === 1) openItemFolders.add(items[0].name) }
      body = head
        + moneyTable(items, { label: 'All items', qty: seller.qty, original_total: seller.original_total, interest_total: seller.interest_total, overall: seller.overall })
        + `<h3 class="seller-item-heading seller-folders-title">Who ordered</h3>`
        + `<div class="item-folders">${items.map(itemFolder).join('')}</div>`;
    }
    /* Keep the reader's place: rebuilding the window would otherwise jump it back to
       the top every time a figure moved underneath them. */
    const dlg = $('sellerDialog'), y = dlg.scrollTop;
    dlg.innerHTML = dialogMarkup(seller.name, body);
    dlg.scrollTop = y;
    wireDialogClose();
  }

  /* One item's buyers, folded away behind its name until tapped, so a seller with a
     dozen items opens onto a short list rather than a dozen tables at once. */
  function itemFolder(it, i) {
    const id = `itemFolder${i}`;
    const open = openItemFolders.has(it.name);
    const paid = Number(it.qty || 0), unpaid = Number(it.unpaid_qty || 0);
    const people = new Set((it.buyers || []).map(b => String(b.name || '').toLowerCase())).size;
    return `<section class="item-folder${open ? ' is-open' : ''}">
      <h4 class="item-folder-heading">
        <button type="button" class="item-folder-head" aria-expanded="${open}" aria-controls="${id}" data-item="${esc(it.name)}">
          <span class="item-folder-caret" aria-hidden="true"></span>
          <span class="item-folder-main">
            <span class="item-folder-name">${esc(it.name)}</span>
            <span class="item-folder-sub">${[paid || !unpaid ? `${num(paid)} paid` : '', unpaid ? `${num(unpaid)} unpaid` : '', `${people} ${people === 1 ? 'customer' : 'customers'}`].filter(Boolean).join(' &middot; ')}</span>
          </span>
        </button>
      </h4>
      <div class="item-folder-body" id="${id}"${open ? '' : ' hidden'}>${buyersTable(it.buyers || [])}${owedNote(it)}</div>
    </section>`;
  }

  async function loadBuyers(name) {
    if (buyersBusy) return;
    buyersBusy = true;
    try {
      const { data, error } = await window.db.rpc('seller_buyers', { p_token: token, p_seller: name });
      if (error) throw error;
      if (!data?.ok) throw new Error(data.error || 'This link is no longer valid.');
      /* Only paint if this is still the window on screen: a slow reply for one seller
         must not overwrite the one the reader has already moved on to. */
      if (openSeller !== name) return;
      openItems = data.items || [];
      const seller = (lastSellers || []).find(s => s.name === name);
      if (seller) paintDialog(seller, openItems);
    } catch (err) {
      console.warn('Buyers lookup failed', err);
      if (openSeller === name && !openItems) {
        $('sellerDialog').innerHTML = dialogMarkup(name, `<p class="seller-item-empty">${esc(err.message || 'We could not load who ordered just now.')}</p>`);
        wireDialogClose();
      }
    } finally { buyersBusy = false }
  }

  /* A seller's own figures, as the cheap poll last reported them. When this is
     unchanged, nothing inside their window can have moved either. */
  const sellerPrint = s => JSON.stringify(s);

  function openSellerWindow(name) {
    const seller = (lastSellers || []).find(s => s.name === name);
    if (!seller) return;
    openSeller = name;
    openSignature = '';
    openItems = null;
    openItemFolders.clear();
    autoOpenSingle = true;
    openPrint = sellerPrint(seller);
    const dlg = $('sellerDialog');
    paintDialog(seller, null);
    if (!dlg.open) dlg.showModal();
    $('sellerDialogClose')?.focus();
    loadBuyers(name);
  }

  /* ---------- drawing the page ---------- */

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
        if (!still) $('sellerDialog').close();
        else {
          const print = sellerPrint(still);
          /* Only worth asking who ordered again if this seller's own figures moved. */
          if (print !== openPrint) { openPrint = print; openItems = null; loadBuyers(openSeller) }
          paintDialog(still, openItems);
        }
      }
    }
    const when = new Date(data.as_of || Date.now());
    $('sellerAsOf').textContent = `Updated ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    $('sellerError').classList.add('hidden');
  }

  /* ---------- the poll ---------- */
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

  /* ---------- start ---------- */
  function boot() {
    if (!window.BILIHAN_SUPABASE_CONFIGURED || !window.db) { fail('This page is not connected to the store yet.'); return; }
    if (!token) { fail('This link is missing its code. Ask the store for the full link.'); return; }
    /* Delegated, because the cards are rebuilt from scratch whenever the figures
       move and a handler bound to one would go with it. */
    $('sellerBody').addEventListener('click', e => {
      const card = e.target.closest('.seller-card');
      if (card) openSellerWindow(card.dataset.seller || '');
    });
    $('sellerDialog').addEventListener('close', () => { openSeller = null; openSignature = ''; openItems = null; openPrint = ''; openItemFolders.clear(); });
    /* Opening or shutting an item folder is done in place rather than by redrawing the
       window, so nothing else in it moves. Delegated, because the window's contents are
       rebuilt whenever the figures change. */
    $('sellerDialog').addEventListener('click', e => {
      const head = e.target.closest('.item-folder-head');
      if (!head) return;
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      const body = document.getElementById(head.getAttribute('aria-controls'));
      if (body) body.hidden = !open;
      head.closest('.item-folder')?.classList.toggle('is-open', open);
      const name = head.dataset.item || '';
      if (open) openItemFolders.add(name); else openItemFolders.delete(name);
    });
    load();
    setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
