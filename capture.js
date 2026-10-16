/* Copy a report image locally. No screen permission or upload is involved. */
(() => {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const camera = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="4"/></svg>';
  const button = (target, name) => `<button type="button" class="capture-button" data-capture-target="${escape(target)}" data-capture-name="${escape(name)}" data-capture-ignore title="Copy ${escape(name)} as image" aria-label="Copy ${escape(name)} as image">${camera}</button>`;
  let busy = false;
  let noticeTimer;

  function notify(message) {
    document.getElementById('captureNotice')?.remove();
    clearTimeout(noticeTimer);
    const notice = document.createElement('div');
    notice.id = 'captureNotice';
    notice.className = 'capture-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = message;
    // A native dialog's top layer sits above even a fixed toast on the body.
    (document.querySelector('dialog[open]') || document.body).append(notice);
    noticeTimer = setTimeout(() => notice.remove(), 6000);
  }

  async function renderImage(target) {
    if (!window.htmlToImage) throw new Error('Image capture could not load. Refresh and try again.');
    const isTemplate = target instanceof HTMLTemplateElement;
    const clone = isTemplate ? target.content.firstElementChild.cloneNode(true) : target.cloneNode(true);
    clone.querySelectorAll('[data-capture-ignore], .admin-modal-close, .modal-close, template').forEach(el => el.remove());
    // Export every buyer/item row, including folders collapsed on screen.
    clone.querySelectorAll('.item-folder-body, .seller-items-row').forEach(el => { el.hidden = false; });
    clone.querySelectorAll('[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'true'));
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.removeAttribute('id');
    clone.classList.add('capture-content');
    const stage = document.createElement('div');
    stage.className = 'capture-sheet';
    stage.setAttribute('aria-hidden', 'true');
    stage.inert = true;
    stage.style.width = `${isTemplate ? Math.min(800, Math.max(360, innerWidth - 32)) : Math.max(360, Math.ceil(target.getBoundingClientRect().width))}px`;
    stage.append(clone);
    document.body.append(stage);
    try {
      // Expand scrolling tables before rasterizing, so no columns are clipped.
      const tableWidth = Math.max(0, ...Array.from(clone.querySelectorAll('table'), el => el.scrollWidth));
      if (tableWidth > stage.clientWidth - 48) stage.style.width = `${Math.min(1600, tableWidth + 64)}px`;
      await document.fonts.ready;
      const width = Math.ceil(stage.getBoundingClientRect().width);
      const height = Math.ceil(stage.scrollHeight);
      // Bound canvas memory for very long buyer lists; never silently crop rows.
      const pixelRatio = Math.min(2, 16384 / Math.max(width, height), Math.sqrt(16000000 / (width * height)));
      const blob = await htmlToImage.toBlob(stage, {
        width, height, pixelRatio, skipFonts: true,
        style: {position: 'static', margin: '0'},
        backgroundColor: getComputedStyle(stage).backgroundColor
      });
      if (!blob) throw new Error('Could not create the image. Please try again.');
      return blob;
    } finally {
      stage.remove();
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Bilihan-report'}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  document.addEventListener('click', async event => {
    const control = event.target.closest('[data-capture-target]');
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const target = document.querySelector(control.dataset.captureTarget);
    if (!target) { notify('This section changed. Please try again.'); return; }
    busy = true;
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
    const name = control.dataset.captureName || 'Bilihan report';
    // Start clipboard.write during the click itself. Passing the PNG promise
    // preserves the user gesture in Safari while the image is being rendered.
    const image = renderImage(target);
    try {
      if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({'image/png': image})]);
          notify('Image copied. Ready to paste.');
          return;
        } catch (_) {
          // Clipboard support/permissions vary; still provide the report as PNG.
        }
      }
      download(await image, name);
      notify('Image downloaded. Your browser did not allow copying it.');
    } catch (error) {
      notify(error.message || 'Could not copy the image. Please try again.');
    } finally {
      busy = false;
      control.disabled = false;
      control.removeAttribute('aria-busy');
    }
  });

  window.BilihanCapture = {button};
})();
