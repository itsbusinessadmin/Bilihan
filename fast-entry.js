(() => {
  'use strict';

  const KEY = 'bilihan_fast_entry_preferences_v1';
  let pendingAddAnother = false;
  let lastModal = null;

  const readPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch (_) {
      return {};
    }
  };

  const writePrefs = next => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...next }));
    } catch (_) {}
  };

  const toast = message => {
    const old = document.querySelector('.fast-entry-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'fast-entry-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  };

  const moveImageUrlToMore = form => {
    const imageUrl = form.querySelector('input[name="image_url"]');
    if (!imageUrl) return;
    const imageUrlLabel = imageUrl.closest('label');
    if (!imageUrlLabel || imageUrlLabel.closest('.fast-entry-more')) return;

    const details = document.createElement('details');
    details.className = 'fast-entry-more';
    const summary = document.createElement('summary');
    summary.textContent = 'More image options';
    const content = document.createElement('div');
    content.className = 'fast-entry-more-content';
    imageUrlLabel.parentNode.insertBefore(details, imageUrlLabel);
    content.appendChild(imageUrlLabel);
    details.append(summary, content);
  };

  const makePhotoCard = form => {
    const fileInput = form.querySelector('input[name="image_file"]');
    if (!fileInput || fileInput.dataset.fastEntryReady === '1') return;
    fileInput.dataset.fastEntryReady = '1';

    const originalLabel = fileInput.closest('label');
    if (!originalLabel) return;

    const card = document.createElement('div');
    card.className = 'fast-entry-photo-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Choose or drop a product photo');

    const preview = document.createElement('img');
    preview.className = 'fast-entry-photo-preview';
    preview.src = 'bilihan-logo.png';
    preview.alt = 'Product photo preview';

    const copy = document.createElement('div');
    copy.className = 'fast-entry-photo-copy';
    copy.innerHTML = '<strong>Add product photo</strong><small>Tap to choose, or drag and drop an image here.</small><small class="file-name">No photo selected</small>';

    card.append(preview, copy);
    originalLabel.parentNode.insertBefore(card, originalLabel);
    fileInput.classList.add('fast-entry-hidden-file');
    card.appendChild(fileInput);
    originalLabel.remove();

    const showFile = file => {
      if (!file || !file.type || !file.type.startsWith('image/')) return;
      const oldUrl = preview.dataset.objectUrl;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      const url = URL.createObjectURL(file);
      preview.dataset.objectUrl = url;
      preview.src = url;
      const name = card.querySelector('.file-name');
      if (name) name.textContent = file.name;
    };

    fileInput.addEventListener('change', () => showFile(fileInput.files && fileInput.files[0]));
    card.addEventListener('click', e => {
      if (e.target !== fileInput) fileInput.click();
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragleave', () => card.classList.remove('is-dragging'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('is-dragging');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        showFile(file);
      } catch (_) {
        toast('Use the file picker for this browser.');
      }
    });
  };

  const addSaveAnother = form => {
    const actions = form.querySelector('.admin-modal-actions');
    const save = form.querySelector('#saveAddProduct');
    const cancel = form.querySelector('#cancelAddProduct');
    if (!actions || !save || document.getElementById('saveAndAddAnother')) return;

    actions.classList.add('fast-entry-actions');

    const note = document.createElement('span');
    note.className = 'fast-entry-note';
    note.textContent = 'Cmd/Ctrl + Enter saves quickly';

    const another = document.createElement('button');
    another.type = 'button';
    another.id = 'saveAndAddAnother';
    another.textContent = 'Save & Add Another';
    another.addEventListener('click', () => {
      pendingAddAnother = true;
      form.requestSubmit(save);
    });

    actions.insertBefore(note, cancel || actions.firstChild);
    actions.insertBefore(another, save);
  };

  const applyPrefs = form => {
    const prefs = readPrefs();
    const category = form.querySelector('[name="category_id"]');
    const stock = form.querySelector('[name="stock"]');
    const interest = form.querySelector('[name="interest"]');
    const available = form.querySelector('[name="is_available"]');

    if (category && prefs.category_id && [...category.options].some(o => o.value === prefs.category_id)) {
      category.value = prefs.category_id;
    }
    if (stock && prefs.stock !== undefined && stock.value === '') stock.value = prefs.stock;
    if (interest && prefs.interest !== undefined) {
      interest.value = prefs.interest;
      interest.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (available && typeof prefs.is_available === 'boolean') available.checked = prefs.is_available;
  };

  const rememberPrefs = form => {
    const category = form.querySelector('[name="category_id"]');
    const stock = form.querySelector('[name="stock"]');
    const interest = form.querySelector('[name="interest"]');
    const available = form.querySelector('[name="is_available"]');
    writePrefs({
      category_id: category ? category.value : undefined,
      stock: stock ? stock.value : undefined,
      interest: interest ? interest.value : undefined,
      is_available: available ? available.checked : undefined
    });
  };

  const enhanceModal = modal => {
    if (!modal || modal === lastModal || modal.dataset.fastEntryReady === '1') return;
    const form = modal.querySelector('#addProductForm');
    if (!form) return;

    lastModal = modal;
    modal.dataset.fastEntryReady = '1';
    form.classList.add('fast-entry-form');

    applyPrefs(form);
    makePhotoCard(form);
    moveImageUrlToMore(form);
    addSaveAnother(form);

    const name = form.querySelector('[name="name"]');
    if (name) setTimeout(() => name.focus(), 30);

    form.addEventListener('submit', () => rememberPrefs(form), true);
    form.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        pendingAddAnother = false;
        const save = form.querySelector('#saveAddProduct');
        form.requestSubmit(save || undefined);
      }
    });
  };

  const enhanceProductsPage = () => {
    const page = document.querySelector('.products-page');
    if (!page || page.querySelector('.fast-entry-toolbar')) return;
    const header = page.querySelector('.products-page-header');
    if (!header) return;

    const bar = document.createElement('div');
    bar.className = 'fast-entry-toolbar';
    bar.innerHTML = '<div><strong>Fast Entry Mode</strong><br><small>Your last category, stock and interest are remembered automatically.</small></div><span class="fast-entry-shortcut">Cmd/Ctrl + Enter = Save</span>';
    header.insertAdjacentElement('afterend', bar);
  };

  const observer = new MutationObserver(() => {
    enhanceProductsPage();

    const modal = document.getElementById('addProductModal');
    if (modal) enhanceModal(modal);

    if (pendingAddAnother && !document.getElementById('addProductModal')) {
      const open = document.getElementById('openAddProduct');
      if (open) {
        pendingAddAnother = false;
        setTimeout(() => {
          open.click();
          toast('Product saved. Ready for the next one.');
        }, 80);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceProductsPage();
})();
