/* Bilihan — customer support chat.

   The customer is recognised automatically from the order stored in this browser.
   On a different device they identify themselves once with an order number or the
   mobile number they ordered with; from then on the browser holds a per-thread
   token and the order number is never needed again.

   Messages are cached in localStorage so reopening the chat paints instantly,
   then the cached copy is refreshed from the server behind it. */
(() => {
  const LS_KEY = 'bilihan_support_v1';
  const LS_MSGS = 'bilihan_support_msgs_v1';
  const LS_ORDER = 'bilihan_latest_order_v3';
  const POLL_OPEN = 4000;      /* while the panel is open        */
  const POLL_IDLE = 45000;     /* badge refresh while it is shut */

  const read = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));

  const state = {
    session: read(LS_KEY, null),      /* {threadId, token, name, orderCode} */
    messages: read(LS_MSGS, []),
    open: false, busy: false, unread: 0, timer: null, lastError: '',
    adminLastReadAt: null       /* when the store last had this conversation open */
  };

  const db = () => (window.BILIHAN_SUPABASE_CONFIGURED ? window.db : null);
  const latestOrder = () => read(LS_ORDER, null);

  /* ---------- shell ---------- */
  const root = document.createElement('div');
  root.className = 'support-root';
  root.innerHTML = `
    <button type="button" class="support-fab" id="supportFab" aria-expanded="false" aria-controls="supportPanel" aria-label="Message the store">
      <svg class="support-fab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.9 8.9 0 0 1-3.9-.9L3 20.5l1.7-4.9a8.1 8.1 0 0 1-1.2-4.1A8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3Z"
              fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
      </svg>
      <span class="support-badge hidden" id="supportBadge">0</span>
    </button>
    <section class="support-panel" id="supportPanel" role="dialog" aria-label="Message the store" hidden>
      <header class="support-head">
        <div><strong id="supportTitle">Message us</strong><span class="support-sub" id="supportSub">We reply as soon as we can.</span></div>
        <button type="button" class="icon-btn support-close" id="supportClose" aria-label="Close chat">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="support-body" id="supportBody"></div>
    </section>`;

  const $ = id => root.querySelector('#' + id);

  /* ---------- views ---------- */
  function renderIdentify(message) {
    $('supportBody').innerHTML = `
      <form class="support-identify" id="supportIdentify" novalidate>
        <p class="support-intro">To open your conversation, enter your order number or the mobile number you ordered with.</p>
        ${message ? `<div class="support-error" role="alert">${esc(message)}</div>` : ''}
        <label class="field">
          <span class="field-label">Order number</span>
          <input name="order" autocomplete="off" spellcheck="false" placeholder="e.g. BIL-A2BA14">
        </label>
        <p class="support-or"><span>or</span></p>
        <label class="field">
          <span class="field-label">Mobile number used on the order</span>
          <input name="phone" inputmode="tel" autocomplete="tel" placeholder="09XXXXXXXXX">
        </label>
        <button class="primary-btn" type="submit" id="supportIdentifyBtn">Open my chat</button>
      </form>`;
    root.querySelector('#supportIdentify').onsubmit = async e => {
      e.preventDefault();
      const f = e.currentTarget;
      const btn = root.querySelector('#supportIdentifyBtn');
      const order = f.order.value.trim();
      const phone = f.phone.value.trim();
      if (!order && !phone) { renderIdentify('Enter your order number or your mobile number.'); return; }
      btn.disabled = true; btn.textContent = 'Opening…';
      const ok = await identify(order, phone);
      if (!ok) { renderIdentify(state.lastError); return; }
      renderChat(); refresh(true);
    };
    root.querySelector('#supportIdentify input')?.focus();
  }

  function bubbleHtml(m) {
    const when = new Date(m.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<div class="support-msg support-msg-${m.sender === 'admin' ? 'admin' : 'me'}">
      <p>${esc(m.body)}</p><time>${esc(when)}</time></div>`;
  }

  function renderChat() {
    $('supportBody').innerHTML = `
      <div class="support-log" id="supportLog" aria-live="polite"></div>
      <form class="support-compose" id="supportCompose">
        <label class="sr-only" for="supportInput">Your message</label>
        <textarea id="supportInput" rows="1" maxlength="2000" placeholder="Type your message…"></textarea>
        <button class="primary-btn" type="submit" id="supportSend" aria-label="Send message">Send</button>
      </form>`;
    paintMessages();
    const form = root.querySelector('#supportCompose');
    const input = root.querySelector('#supportInput');
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    form.onsubmit = async e => { e.preventDefault(); await send(input.value); input.value = ''; grow(); input.focus(); };
    input.focus();
  }

  function greetingHtml() {
    const name = state.session?.name;
    const who = name && name !== 'Customer' ? `Hi, ${esc(name)}` : 'Hi there';
    return `<div class="support-msg support-msg-admin support-greeting"><p>${who} — how can we help you today?</p></div>`;
  }

  /* Messenger-style read receipt: "Seen" under our own last message, once the
     store's last-read stamp has caught up with it. Nothing is shown when the store
     replied last — their reply already says they read it. */
  function seenHtml() {
    const last = state.messages[state.messages.length - 1];
    const seenAt = state.adminLastReadAt ? new Date(state.adminLastReadAt) : null;
    /* A message still in flight has a local id and no server time, so it cannot
       have been read yet. */
    const sent = last && !String(last.id).startsWith('local-') ? new Date(last.created_at) : null;
    if (!last || last.sender !== 'customer' || !seenAt || !sent || seenAt < sent) return '';
    const when = seenAt.toLocaleString([], { hour: 'numeric', minute: '2-digit' });
    return `<div class="support-seen">Seen ${esc(when)}</div>`;
  }

  function paintMessages() {
    const log = root.querySelector('#supportLog');
    if (!log) return;
    /* The compose box is a sibling of the log, not inside it, so repainting here
       never costs anyone a half-typed message. */
    log.innerHTML = greetingHtml() + state.messages.map(bubbleHtml).join('') + seenHtml();
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- data ---------- */
  /* Every failure used to read "check your connection", which is wrong and
     undiagnosable when the real cause is that the chat functions have not been
     created in the database yet. Say which it is. */
  const SETUP_MSG = 'Messaging is not set up on this store yet. If you are the owner, run supabase-setup.sql in Supabase.';
  function describeError(err) {
    const code = err?.code || '';
    const text = `${err?.message || ''} ${err?.hint || ''} ${err?.details || ''}`.toLowerCase();
    if (code === 'PGRST202' || text.includes('could not find the function') || text.includes('does not exist')) return SETUP_MSG;
    if (code === '42501' || text.includes('permission denied')) return SETUP_MSG;
    if (code === 'PGRST301' || text.includes('jwt')) return 'Messaging is unavailable right now. Please try again shortly.';
    if (err instanceof TypeError || text.includes('failed to fetch') || text.includes('networkerror')) {
      return 'We could not reach the store. Check your connection and try again.';
    }
    return err?.message ? `We could not open your chat. (${err.message})` : 'We could not open your chat. Please try again.';
  }

  async function identify(orderCode, phone) {
    const client = db();
    if (!client) { state.lastError = 'Messaging is unavailable right now. Please try again shortly.'; return false; }
    try {
      const { data, error } = await client.rpc('support_identify', {
        p_order_code: orderCode || null, p_phone: phone || null
      });
      if (error) throw error;
      if (!data?.ok) { state.lastError = data?.error || 'We could not open your chat.'; return false; }
      state.session = {
        threadId: data.thread.id, token: data.thread.token,
        name: data.thread.customer_name, orderCode: orderCode || latestOrder()?.order_code || ''
      };
      write(LS_KEY, state.session);
      state.messages = []; write(LS_MSGS, state.messages);
      setTitle();
      return true;
    } catch (err) {
      console.error('Bilihan support: identify failed', err);
      state.lastError = describeError(err);
      return false;
    }
  }

  /* A new order from this browser may belong to a different thread (a different
     name or phone), so re-identify whenever the stored order number changes. */
  async function syncLatestOrder() {
    const order = latestOrder();
    if (!order?.order_code) return;
    if (state.session && state.session.orderCode === order.order_code) return;
    const had = !!state.session;
    const ok = await identify(order.order_code, '');
    if (ok && had) { state.messages = read(LS_MSGS, []); }
  }

  async function refresh(force) {
    const client = db();
    if (!client || !state.session || state.busy) return;
    state.busy = true;
    try {
      const { data, error } = await client.rpc('support_fetch', {
        p_thread_id: state.session.threadId, p_token: state.session.token
      });
      if (error) throw error;
      if (!data?.ok) { clearSession(); renderIdentify('Please identify yourself again to continue.'); return; }
      const next = data.messages || [];
      /* The receipt moves without the message count changing, so it counts as a
         change in its own right — otherwise "Seen" would not appear until the next
         message arrived. */
      const seenMoved = (data.admin_last_read_at || null) !== state.adminLastReadAt;
      state.adminLastReadAt = data.admin_last_read_at || null;
      const changed = force || next.length !== state.messages.length || seenMoved;
      state.messages = next; write(LS_MSGS, next);
      if (data.customer_name && state.session.name !== data.customer_name) {
        state.session.name = data.customer_name; write(LS_KEY, state.session); setTitle();
      }
      if (changed) paintMessages();
      setUnread(0);
    } catch (err) {
      console.warn('Bilihan support: refresh failed', err);
    } finally { state.busy = false; }
  }

  async function pollUnread() {
    const client = db();
    if (!client || !state.session || state.open) return;
    try {
      const { data } = await client.rpc('support_unread', {
        p_thread_id: state.session.threadId, p_token: state.session.token
      });
      if (data?.ok) {
        setUnread(data.unread || 0);
        state.adminLastReadAt = data.admin_last_read_at || null;
      }
    } catch { /* the badge is not worth surfacing an error for */ }
  }

  async function send(body) {
    const text = String(body || '').trim();
    if (!text || !state.session) return;
    const client = db();
    if (!client) return;
    /* Show it straight away, then reconcile with the server copy. */
    const optimistic = { id: 'local-' + Date.now(), sender: 'customer', body: text, created_at: new Date().toISOString() };
    state.messages = [...state.messages, optimistic];
    paintMessages();
    try {
      const { data, error } = await client.rpc('support_send', {
        p_thread_id: state.session.threadId, p_token: state.session.token, p_body: text
      });
      if (error) throw error;
      if (!data?.ok) {
        state.messages = state.messages.filter(m => m.id !== optimistic.id);
        paintMessages();
        const log = root.querySelector('#supportLog');
        if (log) log.insertAdjacentHTML('beforeend', `<div class="support-error" role="alert">${esc(data?.error || 'Message not sent.')}</div>`);
        return;
      }
      await refresh(true);
    } catch (err) {
      console.error('Bilihan support: send failed', err);
      state.messages = state.messages.filter(m => m.id !== optimistic.id);
      paintMessages();
      const log = root.querySelector('#supportLog');
      if (log) log.insertAdjacentHTML('beforeend', `<div class="support-error" role="alert">${esc(describeError(err))}</div>`);
    }
  }

  function clearSession() {
    state.session = null; state.messages = [];
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_MSGS); } catch {}
    setUnread(0);
  }

  /* ---------- chrome ---------- */
  function setUnread(n) {
    state.unread = n;
    const badge = $('supportBadge');
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', !n);
    $('supportFab').setAttribute('aria-label', n ? `Message the store, ${n} unread` : 'Message the store');
  }
  function setTitle() {
    const name = state.session?.name;
    $('supportTitle').textContent = 'Message us';
    $('supportSub').textContent = name && name !== 'Customer' ? `Chatting as ${name}` : 'We reply as soon as we can.';
  }

  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (document.hidden) return;
      if (state.open) refresh(false); else pollUnread();
    }, state.open ? POLL_OPEN : POLL_IDLE);
  }

  async function openPanel() {
    state.open = true;
    $('supportPanel').hidden = false;
    $('supportFab').setAttribute('aria-expanded', 'true');
    root.classList.add('support-open');
    if (!db()) {
      $('supportBody').innerHTML = '<p class="support-intro">Messaging is unavailable right now. Please try again shortly.</p>';
      return;
    }
    await syncLatestOrder();
    if (state.session) { renderChat(); refresh(true); }
    else {
      const order = latestOrder();
      if (order?.order_code && await identify(order.order_code, '')) { renderChat(); refresh(true); }
      else renderIdentify('');
    }
    schedule();
  }
  function closePanel() {
    state.open = false;
    $('supportPanel').hidden = true;
    $('supportFab').setAttribute('aria-expanded', 'false');
    root.classList.remove('support-open');
    $('supportFab').focus();
    schedule();
  }

  function boot() {
    document.body.appendChild(root);
    setTitle();
    $('supportFab').onclick = () => (state.open ? closePanel() : openPanel());
    $('supportClose').onclick = closePanel;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.open) closePanel(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.open) refresh(false); });
    if (state.session) pollUnread();
    schedule();
    window.BilihanSupport = { open: openPanel, close: closePanel };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
