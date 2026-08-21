const A = {
  section: 'dashboard',
  session: null,
  orderFilter: 'all',
  data: {
    products: [],
    categories: [],
    orders: [],
    settings: null
  }
};

const app = document.getElementById('app');

const money = n =>
  `₱${Number(n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const esc = s =>
  String(s ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', '⌂'],
  ['products', 'Products', '▦'],
  ['categories', 'Categories', '◫'],
  ['orders', 'Orders', '≡'],
  ['settings', 'Store Settings', '⚙'],
  ['appearance', 'Appearance', '✦'],
  ['security', 'Security', '◉']
];

function configured() {
  return !!window.BILIHAN_SUPABASE_CONFIGURED;
}

async function isAdmin() {
  if (!A.session) return false;

  const { data, error } = await db.rpc('is_admin');

  return !error && data === true;
}

async function init() {
  if (!configured()) {
    renderSetup();
    return;
  }

  const {
    data: { session }
  } = await db.auth.getSession();

  A.session = session;

  if (!session) {
    renderLogin();
    return;
  }

  if (!(await isAdmin())) {
    await db.auth.signOut();
    A.session = null;

    renderLogin(
      'This account is not listed as a Bilihan admin.'
    );

    return;
  }

  await loadAll();
  renderShell();
}

function renderSetup() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">

        <img
          src="bilihan-logo.png"
          class="login-logo"
          alt="Bilihan"
        >

        <span class="eyebrow">
          Bilihan v3
        </span>

        <h2>
          Connect Supabase
        </h2>

        <p>
          Edit <strong>config.js</strong> once and paste your
          Supabase Project URL and anon public key,
          then reload this page.
        </p>

        <p class="muted">
          Never paste a service_role key into the website.
        </p>

      </div>
    </div>
  `;
}

function renderLogin(msg = '') {
  app.innerHTML = `
    <div class="login-wrap">

      <form
        id="loginForm"
        class="login-card admin-form"
      >

        <img
          src="bilihan-logo.png"
          class="login-logo"
          alt="Bilihan"
        >

        <span class="eyebrow">
          Bilihan Admin
        </span>

        <h2>
          Welcome back
        </h2>

        <p class="muted login-subtitle">
          Manage your store from one place.
        </p>

        ${
          msg
            ? `<div class="status-banner">${esc(msg)}</div>`
            : ''
        }

        <label>
          Email
          <input
            name="email"
            type="email"
            autocomplete="email"
            required
          >
        </label>

        <label>
          Password
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            required
          >
        </label>

        <button class="primary-btn full-btn">
          Sign In
        </button>

      </form>

    </div>
  `;

  document.getElementById('loginForm').onsubmit =
    async e => {
      e.preventDefault();

      const form = e.currentTarget;
      const button = form.querySelector('button');

      button.disabled = true;
      button.textContent = 'Signing in...';

      const d =
        Object.fromEntries(
          new FormData(form)
        );

      const { data, error } =
        await db.auth.signInWithPassword(d);

      if (error) {
        renderLogin(error.message);
        return;
      }

      A.session = data.session;

      if (!(await isAdmin())) {
        await db.auth.signOut();

        A.session = null;

        renderLogin(
          'This account is not listed as a Bilihan admin.'
        );

        return;
      }

      await loadAll();

      renderShell();
    };
}

async function loadAll() {
  const [p, c, o, s] =
    await Promise.all([
      db
        .from('products')
        .select('*')
        .order('sort_order'),

      db
        .from('categories')
        .select('*')
        .order('sort_order'),

      db
        .from('orders')
        .select('*,order_items(*)')
        .order('created_at', {
          ascending: false
        }),

      db
        .from('store_settings')
        .select('*')
        .eq('id', 1)
        .single()
    ]);

  for (const r of [p, c, o, s]) {
    if (r.error) throw r.error;
  }

  A.data = {
    products: p.data,
    categories: c.data,
    orders: o.data,
    settings: s.data
  };
}

function renderNavButtons(items) {
  return items.map(
    ([id, name, icon]) => `
      <button
        type="button"
        data-s="${id}"
        class="${A.section === id ? 'active' : ''}"
      >
        <span class="nav-icon">
          ${icon}
        </span>

        <span class="nav-label">
          ${name}
        </span>
      </button>
    `
  ).join('');
}

function renderShell() {
  const currentPage =
    NAV_ITEMS.find(
      item => item[0] === A.section
    )?.[1] || 'Dashboard';

  app.innerHTML = `
    <div class="admin-app">

      <aside
        class="sidebar"
        id="sidebar"
      >

        <div class="admin-brand">

          <img
            src="bilihan-logo.png"
            alt="Bilihan"
          >

          <div>
            <strong>
              Bilihan
            </strong>

            <small>
              ADMIN
            </small>
          </div>

          <button
            class="icon-btn sidebar-close"
            id="sidebarClose"
            aria-label="Close menu"
          >
            ×
          </button>

        </div>

        <nav class="side-nav">
          ${renderNavButtons(NAV_ITEMS)}
        </nav>

        <div class="sidebar-footer">

          <small>
            Signed in as
          </small>

          <span>
            ${esc(A.session?.user?.email || '')}
          </span>

        </div>

      </aside>

      <div
        id="sidebarBackdrop"
        class="sidebar-backdrop"
      ></div>

      <section class="app-stage">

        <header class="app-topbar">

          <div class="topbar-left">

            <button
              class="icon-btn menu-btn"
              id="menuBtn"
              aria-label="Open menu"
            >
              ☰
            </button>

            <div>

              <small class="topbar-kicker">
                Bilihan Admin
              </small>

              <strong>
                ${esc(currentPage)}
              </strong>

            </div>

          </div>

          <div class="topbar-actions">

            <button
              class="icon-btn"
              id="refreshBtn"
              aria-label="Refresh"
            >
              ↻
            </button>

            <img
              class="topbar-avatar"
              src="bilihan-logo.png"
              alt="Bilihan"
            >

          </div>

        </header>

        <main
          id="adminMain"
          class="admin-main"
        ></main>

        <nav class="mobile-bottom-nav">

          ${renderNavButtons([
            NAV_ITEMS[0],
            NAV_ITEMS[1],
            NAV_ITEMS[2],
            NAV_ITEMS[3],
            NAV_ITEMS[4]
          ])}

        </nav>

      </section>

    </div>
  `;

  const sidebar =
    document.getElementById('sidebar');

  const backdrop =
    document.getElementById('sidebarBackdrop');

  const closeMenu = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
    document.body.classList.remove('menu-open');
  };

  document.getElementById('menuBtn').onclick =
    () => {
      sidebar.classList.add('open');
      backdrop.classList.add('show');
      document.body.classList.add('menu-open');
    };

  document.getElementById('sidebarClose').onclick =
    closeMenu;

  backdrop.onclick =
    closeMenu;

  document
    .querySelectorAll('[data-s]')
    .forEach(button => {
      button.onclick = () => {
        A.section = button.dataset.s;

        closeMenu();

        renderShell();
      };
    });

  document.getElementById('refreshBtn').onclick =
    async () => {
      await loadAll();
      renderShell();
    };

  const m =
    document.getElementById('adminMain');

  ({
    dashboard,
    products,
    categories,
    orders,
    settings,
    appearance,
    security
  }[A.section] || dashboard)(m);
}

function pageHeader(
  eyebrow,
  title,
  subtitle = ''
) {
  return `
    <div class="page-heading">

      <span class="eyebrow">
        ${esc(eyebrow)}
      </span>

      <h1>
        ${esc(title)}
      </h1>

      ${
        subtitle
          ? `<p>${esc(subtitle)}</p>`
          : ''
      }

    </div>
  `;
}

/* ===========================
   DASHBOARD
=========================== */

function dashboard(m) {
  const ps =
    A.data.products;

  const os =
    A.data.orders;

  const available =
    ps.filter(
      p =>
        p.is_available &&
        p.stock > 0
    ).length;

  const soldOut =
    ps.filter(
      p =>
        !p.is_available ||
        p.stock <= 0
    ).length;

  const totalSales =
    os.reduce(
      (sum, o) =>
        sum + Number(o.total || 0),
      0
    );

  const paidSales =
    os
      .filter(
        o =>
          (
            o.payment_status ||
            'Pending'
          ) === 'Paid'
      )
      .reduce(
        (sum, o) =>
          sum + Number(o.total || 0),
        0
      );

  m.innerHTML = `

    ${pageHeader(
      'Overview',
      'Dashboard',
      'A quick view of your Bilihan store.'
    )}

    <div class="metric-grid">

      <article class="metric app-card">

        <small>
          Total Products
        </small>

        <h2>
          ${ps.length}
        </h2>

        <span>
          Catalog items
        </span>

      </article>

      <article class="metric app-card">

        <small>
          Available
        </small>

        <h2>
          ${available}
        </h2>

        <span>
          Ready to order
        </span>

      </article>

      <article class="metric app-card">

        <small>
          Sold Out
        </small>

        <h2>
          ${soldOut}
        </h2>

        <span>
          Needs attention
        </span>

      </article>

      <article class="metric app-card">

        <small>
          Total Orders
        </small>

        <h2>
          ${os.length}
        </h2>

        <span>
          Recorded orders
        </span>

      </article>

    </div>

    <div class="dashboard-grid">

      <section class="app-card panel">

        <small>
          Total Sales
        </small>

        <h2>
          ${money(totalSales)}
        </h2>

        <p class="muted">
          ${money(paidSales)} already paid.
        </p>

      </section>

      <section class="app-card panel">

        <small>
          Store Status
        </small>

        <h2>
          Connected
        </h2>

        <p class="muted">
          Products, orders, images, stock,
          categories and store settings are
          connected to Supabase.
        </p>

      </section>

    </div>
  `;
}

/* ===========================
   IMAGE UPLOAD
=========================== */

async function uploadImage(
  file,
  bucket = 'product-images'
) {
  if (!file) return null;

  const ext =
    (
      file.name
        .split('.')
        .pop() || 'jpg'
    ).toLowerCase();

  const path =
    `${crypto.randomUUID()}.${ext}`;

  const { error } =
    await db.storage
      .from(bucket)
      .upload(
        path,
        file,
        {
          upsert: false
        }
      );

  if (error) {
    throw error;
  }

  return db.storage
    .from(bucket)
    .getPublicUrl(path)
    .data.publicUrl;
}

/* ===========================
   PRODUCTS
=========================== */

function productRow(p) {
  const category =
    A.data.categories.find(
      c => c.id === p.category_id
    )?.name || '';

  return `
    <tr>

      <td>

        <img
          class="thumb"
          src="${esc(
            p.image_url ||
            'bilihan-logo.png'
          )}"
          alt=""
        >

      </td>

      <td>

        <strong>
          ${esc(p.name)}
        </strong>

        <br>

        <small>
          ${esc(category)}
        </small>

      </td>

      <td>
        ${money(p.price)}
      </td>

      <td>
        ${p.stock}
      </td>

      <td>

        <div class="row-actions">

          <button
            onclick="openEditProduct('${p.id}')"
          >
            Edit
          </button>

          <button
            onclick="moveProduct('${p.id}',-1)"
          >
            ↑
          </button>

          <button
            onclick="moveProduct('${p.id}',1)"
          >
            ↓
          </button>

          <button
            class="danger-text"
            onclick="deleteProduct('${p.id}')"
          >
            Delete
          </button>

        </div>

      </td>

    </tr>
  `;
}

function productCard(p) {
  const category =
    A.data.categories.find(
      c => c.id === p.category_id
    )?.name || '';

  return `
    <article
      class="product-admin-card app-card"
    >

      <img
        src="${esc(
          p.image_url ||
          'bilihan-logo.png'
        )}"
        alt=""
      >

      <div class="product-admin-info">

        <div class="product-admin-top">

          <div>

            <strong>
              ${esc(p.name)}
            </strong>

            <small>
              ${esc(category)}
            </small>

          </div>

          <strong>
            ${money(p.price)}
          </strong>

        </div>

        <div class="product-meta">

          <span>
            Stock: ${p.stock}
          </span>

          <span
            class="pill ${
              p.is_available &&
              p.stock > 0
                ? 'success'
                : 'danger'
            }"
          >
            ${
              p.is_available &&
              p.stock > 0
                ? 'Available'
                : 'Sold out'
            }
          </span>

        </div>

        <div class="card-actions">

          <button
            onclick="openEditProduct('${p.id}')"
          >
            Edit
          </button>

          <button
            onclick="moveProduct('${p.id}',-1)"
          >
            ↑
          </button>

          <button
            onclick="moveProduct('${p.id}',1)"
          >
            ↓
          </button>

          <button
            class="danger-text"
            onclick="deleteProduct('${p.id}')"
          >
            Delete
          </button>

        </div>

      </div>

    </article>
  `;
}

function products(m) {
  m.innerHTML = `

    ${pageHeader(
      'Catalog',
      'Products',
      'Add products, manage stock and update your catalog.'
    )}

    <div class="content-split">

      <section>

        <div
          class="desktop-table app-card table-wrap"
        >

          <table class="table">

            <thead>

              <tr>
                <th></th>
                <th>Product</th>
                <th>Price</th>
                <th>Stock</th>
                <th></th>
              </tr>

            </thead>

            <tbody>
              ${
                A.data.products
                  .map(productRow)
                  .join('')
              }
            </tbody>

          </table>

        </div>

        <div class="mobile-card-list">

          ${
            A.data.products.length
              ? A.data.products
                  .map(productCard)
                  .join('')
              : `
                <div class="app-card empty-state">
                  No products yet.
                </div>
              `
          }

        </div>

      </section>

      <section class="sticky-editor">

        <form
          id="productForm"
          class="app-card panel admin-form"
        >

          <div>

            <span class="eyebrow">
              No-code editor
            </span>

            <h3>
              Add Product
            </h3>

          </div>

          <label>

            Product name

            <input
              name="name"
              placeholder="Product name"
              required
            >

          </label>

          <label>

            Description

            <textarea
              name="description"
              placeholder="Description"
              required
            ></textarea>

          </label>

          <label>

            Category

            <select
              name="category_id"
              required
            >

              ${
                A.data.categories
                  .map(
                    c => `
                      <option value="${c.id}">
                        ${esc(c.name)}
                      </option>
                    `
                  )
                  .join('')
              }

            </select>

          </label>

          <div class="form-row">

            <label>

              Price

              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                required
              >

            </label>

            <label>

              Stock

              <input
                name="stock"
                type="number"
                min="0"
                placeholder="0"
                required
              >

            </label>

          </div>

          <label>

            Product photo

            <input
              name="image_file"
              type="file"
              accept="image/*"
            >

          </label>

          <label>

            Or image URL

            <input
              name="image_url"
              placeholder="https://..."
            >

          </label>

          <label class="switch-row">

            <span>

              <strong>
                Available
              </strong>

              <small>
                Show product on customer page
              </small>

            </span>

            <input
              type="checkbox"
              name="is_available"
              checked
            >

          </label>

          <button
            class="primary-btn full-btn"
          >
            Save Product
          </button>

        </form>

      </section>

    </div>
  `;

  document.getElementById('productForm').onsubmit =
    async e => {
      e.preventDefault();

      const form =
        e.currentTarget;

      const button =
        form.querySelector('.primary-btn');

      button.disabled = true;
      button.textContent =
        'Saving...';

      const fd =
        new FormData(form);

      const file =
        fd.get('image_file');

      let image =
        String(
          fd.get('image_url') || ''
        ).trim();

      try {
        if (
          file &&
          file.size
        ) {
          image =
            await uploadImage(file);
        }

        const stock =
          +fd.get('stock');

        const row = {
          name:
            fd.get('name'),

          description:
            fd.get('description'),

          category_id:
            fd.get('category_id'),

          price:
            +fd.get('price'),

          stock,

          is_available:
            fd.get('is_available') === 'on' &&
            stock > 0,

          image_url:
            image || null,

          sort_order:
            A.data.products.length + 1
        };

        const { error } =
          await db
            .from('products')
            .insert(row);

        if (error) {
          throw error;
        }

        await loadAll();

        renderShell();

      } catch (err) {
        alert(err.message);

        button.disabled = false;
        button.textContent =
          'Save Product';
      }
    };
}

/* ===========================
   EDIT PRODUCT MODAL
=========================== */

window.openEditProduct =
  id => {
    const p =
      A.data.products.find(
        x => x.id === id
      );

    if (!p) return;

    document.body.insertAdjacentHTML(
      'beforeend',
      `
        <div
          class="app-modal-backdrop"
          id="editProductModal"
        >

          <div class="app-modal">

            <div class="app-modal-header">

              <div>
                <span class="eyebrow">
                  Product
                </span>

                <h2>
                  Edit Product
                </h2>
              </div>

              <button
                class="icon-btn"
                id="closeEditProduct"
              >
                ×
              </button>

            </div>

            <form
              id="editProductForm"
              class="admin-form"
            >

              <label>
                Product name

                <input
                  name="name"
                  value="${esc(p.name)}"
                  required
                >
              </label>

              <label>
                Description

                <textarea
                  name="description"
                  required
                >${esc(p.description)}</textarea>
              </label>

              <label>
                Category

                <select
                  name="category_id"
                  required
                >

                  ${
                    A.data.categories
                      .map(
                        c => `
                          <option
                            value="${c.id}"
                            ${
                              c.id === p.category_id
                                ? 'selected'
                                : ''
                            }
                          >
                            ${esc(c.name)}
                          </option>
                        `
                      )
                      .join('')
                  }

                </select>

              </label>

              <div class="form-row">

                <label>
                  Price

                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value="${p.price}"
                    required
                  >
                </label>

                <label>
                  Stock

                  <input
                    name="stock"
                    type="number"
                    min="0"
                    value="${p.stock}"
                    required
                  >
                </label>

              </div>

              <label class="switch-row">

                <span>

                  <strong>
                    Available
                  </strong>

                  <small>
                    Show this product
                  </small>

                </span>

                <input
                  type="checkbox"
                  name="is_available"
                  ${
                    p.is_available
                      ? 'checked'
                      : ''
                  }
                >

              </label>

              <button
                class="primary-btn full-btn"
              >
                Save Changes
              </button>

            </form>

          </div>

        </div>
      `
    );

    const modal =
      document.getElementById(
        'editProductModal'
      );

    const close =
      () => modal.remove();

    document.getElementById(
      'closeEditProduct'
    ).onclick =
      close;

    modal.onclick =
      e => {
        if (
          e.target === modal
        ) {
          close();
        }
      };

    document.getElementById(
      'editProductForm'
    ).onsubmit =
      async e => {
        e.preventDefault();

        const fd =
          new FormData(
            e.currentTarget
          );

        const stock =
          +fd.get('stock');

        const row = {
          name:
            fd.get('name'),

          description:
            fd.get('description'),

          category_id:
            fd.get('category_id'),

          price:
            +fd.get('price'),

          stock,

          is_available:
            fd.get('is_available') === 'on' &&
            stock > 0
        };

        const { error } =
          await db
            .from('products')
            .update(row)
            .eq('id', id);

        if (error) {
          return alert(
            error.message
          );
        }

        close();

        await loadAll();

        renderShell();
      };
  };

window.deleteProduct =
  async id => {
    if (
      !confirm(
        'Delete this product?'
      )
    ) {
      return;
    }

    const { error } =
      await db
        .from('products')
        .delete()
        .eq('id', id);

    if (error) {
      return alert(
        error.message
      );
    }

    await loadAll();

    renderShell();
  };

window.moveProduct =
  async (
    id,
    direction
  ) => {
    const sorted =
      [...A.data.products]
        .sort(
          (a, b) =>
            a.sort_order -
            b.sort_order
        );

    const i =
      sorted.findIndex(
        p => p.id === id
      );

    const j =
      i + direction;

    if (
      j < 0 ||
      j >= sorted.length
    ) {
      return;
    }

    const a =
      sorted[i];

    const b =
      sorted[j];

    const { error: e1 } =
      await db
        .from('products')
        .update({
          sort_order:
            b.sort_order
        })
        .eq('id', a.id);

    const { error: e2 } =
      await db
        .from('products')
        .update({
          sort_order:
            a.sort_order
        })
        .eq('id', b.id);

    if (e1 || e2) {
      return alert(
        (e1 || e2).message
      );
    }

    await loadAll();

    renderShell();
  };

/* ===========================
   CATEGORIES
=========================== */

function categories(m) {
  m.innerHTML = `

    ${pageHeader(
      'Menu Structure',
      'Categories',
      'Organize the product categories shown in your store.'
    )}

    <div class="content-split">

      <section class="app-card panel">

        ${
          A.data.categories.length
            ? A.data.categories
                .map(
                  c => `
                    <div class="summary-row category-row">

                      <strong>
                        ${esc(c.name)}
                      </strong>

                      <div class="row-actions">

                        <button
                          onclick="renameCategory('${c.id}')"
                        >
                          Rename
                        </button>

                        <button
                          onclick="moveCategory('${c.id}',-1)"
                        >
                          ↑
                        </button>

                        <button
                          onclick="moveCategory('${c.id}',1)"
                        >
                          ↓
                        </button>

                        <button
                          class="danger-text"
                          onclick="deleteCategory('${c.id}')"
                        >
                          Delete
                        </button>

                      </div>

                    </div>
                  `
                )
                .join('')
            : `
              <div class="empty-state">
                No categories yet.
              </div>
            `
        }

      </section>

      <form
        id="catForm"
        class="app-card panel admin-form"
      >

        <div>
          <span class="eyebrow">
            New
          </span>

          <h3>
            Add Category
          </h3>
        </div>

        <label>

          Category name

          <input
            name="name"
            placeholder="New category name"
            required
          >

        </label>

        <button class="primary-btn full-btn">
          Add Category
        </button>

      </form>

    </div>
  `;

  document.getElementById('catForm').onsubmit =
    async e => {
      e.preventDefault();

      const name =
        new FormData(
          e.currentTarget
        ).get('name');

      const { error } =
        await db
          .from('categories')
          .insert({
            name,
            sort_order:
              A.data.categories.length + 1
          });

      if (error) {
        return alert(
          error.message
        );
      }

      await loadAll();

      renderShell();
    };
}

window.renameCategory =
  async id => {
    const c =
      A.data.categories.find(
        x => x.id === id
      );

    const name =
      prompt(
        'Category name',
        c.name
      );

    if (!name) {
      return;
    }

    const { error } =
      await db
        .from('categories')
        .update({
          name
        })
        .eq('id', id);

    if (error) {
      return alert(
        error.message
      );
    }

    await loadAll();

    renderShell();
  };

window.deleteCategory =
  async id => {
    if (
      A.data.products.some(
        p =>
          p.category_id === id
      )
    ) {
      return alert(
        'Move or delete products in this category first.'
      );
    }

    if (
      !confirm(
        'Delete category?'
      )
    ) {
      return;
    }

    const { error } =
      await db
        .from('categories')
        .delete()
        .eq('id', id);

    if (error) {
      return alert(
        error.message
      );
    }

    await loadAll();

    renderShell();
  };

window.moveCategory =
  async (
    id,
    direction
  ) => {
    const sorted =
      [...A.data.categories]
        .sort(
          (a, b) =>
            a.sort_order -
            b.sort_order
        );

    const i =
      sorted.findIndex(
        c => c.id === id
      );

    const j =
      i + direction;

    if (
      j < 0 ||
      j >= sorted.length
    ) {
      return;
    }

    const a =
      sorted[i];

    const b =
      sorted[j];

    await db
      .from('categories')
      .update({
        sort_order:
          b.sort_order
      })
      .eq('id', a.id);

    await db
      .from('categories')
      .update({
        sort_order:
          a.sort_order
      })
      .eq('id', b.id);

    await loadAll();

    renderShell();
  };

/* ===========================
   ORDERS
=========================== */

const PAY_COLORS = {
  Paid: {
    bg: '#dcfce7',
    text: '#166534',
    border: '#86efac'
  },

  Pending: {
    bg: '#fef9c3',
    text: '#854d0e',
    border: '#fde047'
  },

  'Not Paid': {
    bg: '#fee2e2',
    text: '#991b1b',
    border: '#fca5a5'
  }
};

function paySelectHtml(o) {
  const status =
    o.payment_status ||
    'Pending';

  return `
    <select
      class="payment-select payment-${status
        .toLowerCase()
        .replace(/\s+/g, '-')}"
      onchange="updatePaymentStatus('${o.id}',this.value)"
    >

      ${
        Object.keys(
          PAY_COLORS
        )
          .map(
            key => `
              <option
                value="${key}"
                ${
                  key === status
                    ? 'selected'
                    : ''
                }
              >
                ${key}
              </option>
            `
          )
          .join('')
      }

    </select>
  `;
}

function orderCard(o) {
  return `
    <article
      class="order-card app-card"
    >

      <div class="order-card-head">

        <div>

          <small>
            Order
          </small>

          <strong>
            #${esc(o.order_code)}
          </strong>

        </div>

        ${paySelectHtml(o)}

      </div>

      <div class="order-customer">

        <strong>
          ${esc(o.customer_name)}
        </strong>

        <span>
          ${esc(o.phone || 'No phone')}
        </span>

      </div>

      <div class="order-info-grid">

        <div>

          <small>
            Total
          </small>

          <strong>
            ${money(o.total)}
          </strong>

        </div>

        <div>

          <small>
            Fulfillment
          </small>

          <strong>
            ${esc(o.fulfillment)}
          </strong>

        </div>

        <div>

          <small>
            Payment
          </small>

          <strong>
            ${esc(o.payment_method)}
          </strong>

        </div>

        <div>

          <small>
            Status
          </small>

          <strong>
            ${esc(o.status)}
          </strong>

        </div>

      </div>

      <details>

        <summary>
          View Order Details
        </summary>

        <div class="details-stack">

          <p>
            <strong>Date:</strong>
            ${new Date(
              o.created_at
            ).toLocaleString()}
          </p>

          <p>
            <strong>Address:</strong>
            ${esc(o.address || '—')}
          </p>

          <p>
            <strong>Preferred Date:</strong>
            ${esc(o.preferred_date || '—')}
          </p>

          <p>
            <strong>Items:</strong>
            ${
              (
                o.order_items ||
                []
              )
                .map(
                  i =>
                    `${esc(i.product_name)} × ${i.qty}`
                )
                .join(', ') ||
              '—'
            }
          </p>

          <p>
            <strong>Cancellation Reason:</strong>
            ${esc(
              o.cancellation_reason ||
              '—'
            )}
          </p>

        </div>

      </details>

      <button
        class="danger-outline full-btn"
        onclick="deleteOrder('${o.id}')"
      >
        Delete Order
      </button>

    </article>
  `;
}

function orders(m) {
  const totals =
    A.data.orders.reduce(
      (acc, o) => {
        const status =
          o.payment_status ||
          'Pending';

        acc.sell +=
          +o.total;

        if (
          status === 'Paid'
        ) {
          acc.paid +=
            +o.total;
        } else {
          acc.unpaid +=
            +o.total;
        }

        return acc;
      },
      {
        sell: 0,
        paid: 0,
        unpaid: 0
      }
    );

  m.innerHTML = `

    ${pageHeader(
      'Customer Orders',
      'Orders',
      'Search, filter and manage customer orders.'
    )}

    <div class="metric-grid order-metrics">

      <article class="metric app-card">

        <small>
          Total Sell
        </small>

        <h2>
          ${money(totals.sell)}
        </h2>

      </article>

      <article class="metric app-card">

        <small>
          Total Paid
        </small>

        <h2>
          ${money(totals.paid)}
        </h2>

      </article>

      <article class="metric app-card">

        <small>
          Total Unpaid
        </small>

        <h2>
          ${money(totals.unpaid)}
        </h2>

      </article>

    </div>

    <section
      class="app-card panel order-tools"
    >

      <input
        id="orderSearch"
        class="search-input"
        placeholder="Search name, phone or order number"
      >

      <div
        id="payFilters"
        class="filter-pills"
      >

        ${
          [
            'all',
            'Paid',
            'Pending',
            'Not Paid'
          ]
            .map(
              f => `
                <button
                  data-f="${f}"
                  class="${
                    A.orderFilter === f
                      ? 'active'
                      : ''
                  }"
                >
                  ${
                    f === 'all'
                      ? 'All'
                      : f
                  }
                </button>
              `
            )
            .join('')
        }

      </div>

    </section>

    <div id="orderList"></div>
  `;

  document
    .querySelectorAll(
      '#payFilters button'
    )
    .forEach(
      button => {
        button.onclick =
          () => {
            A.orderFilter =
              button.dataset.f;

            orders(m);
          };
      }
    );

  const draw =
    () => {
      const search =
        document
          .getElementById(
            'orderSearch'
          )
          .value
          .toLowerCase();

      const rows =
        A.data.orders.filter(
          o => {
            const matchesSearch =
              `${
                o.order_code
              } ${
                o.customer_name
              } ${
                o.phone || ''
              }`
                .toLowerCase()
                .includes(search);

            const matchesFilter =
              A.orderFilter ===
                'all' ||
              (
                o.payment_status ||
                'Pending'
              ) ===
                A.orderFilter;

            return (
              matchesSearch &&
              matchesFilter
            );
          }
        );

      document.getElementById(
        'orderList'
      ).innerHTML =
        rows.length
          ? `

            <div class="desktop-table app-card table-wrap">

              <table class="table">

                <thead>

                  <tr>
                    <th>Order #</th>
                    <th>Payment</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Fulfillment</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>

                </thead>

                <tbody>

                  ${
                    rows
                      .map(
                        o => `
                          <tr>

                            <td>
                              <strong>
                                #${esc(o.order_code)}
                              </strong>
                            </td>

                            <td>
                              ${paySelectHtml(o)}
                            </td>

                            <td>
                              ${new Date(
                                o.created_at
                              ).toLocaleString()}
                            </td>

                            <td>
                              ${esc(o.customer_name)}
                            </td>

                            <td>
                              ${esc(o.phone || '—')}
                            </td>

                            <td>
                              ${esc(o.fulfillment)}
                            </td>

                            <td>
                              ${money(o.total)}
                            </td>

                            <td>
                              ${esc(o.status)}
                            </td>

                            <td>

                              <button
                                class="danger-text"
                                onclick="deleteOrder('${o.id}')"
                              >
                                Delete
                              </button>

                            </td>

                          </tr>
                        `
                      )
                      .join('')
                  }

                </tbody>

              </table>

            </div>

            <div class="mobile-card-list order-card-list">

              ${
                rows
                  .map(orderCard)
                  .join('')
              }

            </div>
          `
          : `
            <div class="app-card empty-state">
              No orders match this filter.
            </div>
          `;
    };

  document.getElementById(
    'orderSearch'
  ).oninput =
    draw;

  draw();
}

window.updatePaymentStatus =
  async (
    id,
    status
  ) => {
    const { error } =
      await db
        .from('orders')
        .update({
          payment_status:
            status
        })
        .eq('id', id);

    if (error) {
      return alert(
        error.message
      );
    }

    const order =
      A.data.orders.find(
        x => x.id === id
      );

    if (order) {
      order.payment_status =
        status;
    }

    orders(
      document.getElementById(
        'adminMain'
      )
    );
  };

window.deleteOrder =
  async id => {
    if (
      !confirm(
        'Delete this order permanently?'
      )
    ) {
      return;
    }

    const { error } =
      await db
        .from('orders')
        .delete()
        .eq('id', id);

    if (error) {
      return alert(
        error.message
      );
    }

    await loadAll();

    renderShell();
  };

/* ===========================
   STORE SETTINGS
=========================== */

function settings(m) {
  const s =
    A.data.settings;

  m.innerHTML = `

    ${pageHeader(
      'Business Info',
      'Store Settings',
      'Update your customer-facing store information.'
    )}

    <form
      id="settingsForm"
      class="app-card panel admin-form narrow-form"
    >

      <label>

        Business name

        <input
          name="business_name"
          value="${esc(
            s.business_name
          )}"
        >

      </label>

      <label>

        Pickup location

        <textarea
          name="pickup_location"
        >${esc(
          s.pickup_location
        )}</textarea>

      </label>

      <label>

        QR image

        <input
          name="qr_file"
          type="file"
          accept="image/*"
        >

      </label>

      <label>

        Or QR image URL

        <input
          name="qr_image_url"
          value="${esc(
            s.qr_image_url ||
            ''
          )}"
          placeholder="https://..."
        >

      </label>

      <button class="primary-btn full-btn">
        Save Settings
      </button>

    </form>
  `;

  document.getElementById(
    'settingsForm'
  ).onsubmit =
    async e => {
      e.preventDefault();

      const fd =
        new FormData(
          e.currentTarget
        );

      let qr =
        String(
          fd.get(
            'qr_image_url'
          ) || ''
        );

      const file =
        fd.get(
          'qr_file'
        );

      try {
        if (
          file &&
          file.size
        ) {
          qr =
            await uploadImage(
              file,
              'store-assets'
            );
        }

        const row = {
          business_name:
            fd.get(
              'business_name'
            ),

          pickup_location:
            fd.get(
              'pickup_location'
            ),

          qr_image_url:
            qr
        };

        const { error } =
          await db
            .from(
              'store_settings'
            )
            .update(row)
            .eq('id', 1);

        if (error) {
          throw error;
        }

        await loadAll();

        alert(
          'Settings saved.'
        );

        renderShell();

      } catch (err) {
        alert(err.message);
      }
    };
}

/* ===========================
   APPEARANCE
=========================== */

function appearance(m) {
  const s =
    A.data.settings;

  const existing =
    s.hero_images || [];

  const slots =
    Math.max(
      5,
      existing.length
    );

  const heroSlots =
    Array.from(
      {
        length: slots
      },
      (_, i) => `
        <label class="hero-upload-card">

          <span>
            Hero image ${i + 1}
          </span>

          ${
            existing[i]
              ? `
                <img
                  src="${esc(existing[i])}"
                  class="hero-preview"
                  alt=""
                >
              `
              : ''
          }

          <input
            name="hero_file_${i}"
            type="file"
            accept="image/*"
          >

        </label>
      `
    ).join('');

  m.innerHTML = `

    ${pageHeader(
      'Storefront Content',
      'Appearance',
      'Manage the content customers see on the store.'
    )}

    <form
      id="appearanceForm"
      class="app-card panel admin-form narrow-form"
    >

      <label>

        Hero title

        <input
          name="hero_title"
          value="${esc(
            s.hero_title ||
            ''
          )}"
        >

      </label>

      <label>

        Hero tagline

        <textarea
          name="hero_tagline"
        >${esc(
          s.hero_tagline ||
          ''
        )}</textarea>

      </label>

      <div>

        <span class="eyebrow">
          Hero Images
        </span>

        <div class="hero-upload-grid">
          ${heroSlots}
        </div>

      </div>

      <label>

        About text

        <textarea
          name="about_text"
          rows="6"
        >${esc(
          s.about_text ||
          ''
        )}</textarea>

      </label>

      <label>

        About image

        <input
          name="about_file"
          type="file"
          accept="image/*"
        >

      </label>

      <label>

        Or About image URL

        <input
          name="about_image_url"
          value="${esc(
            s.about_image_url ||
            ''
          )}"
          placeholder="https://..."
        >

      </label>

      <button class="primary-btn full-btn">
        Save Appearance
      </button>

    </form>
  `;

  document.getElementById(
    'appearanceForm'
  ).onsubmit =
    async e => {
      e.preventDefault();

      const fd =
        new FormData(
          e.currentTarget
        );

      let about =
        String(
          fd.get(
            'about_image_url'
          ) || ''
        );

      const aboutFile =
        fd.get(
          'about_file'
        );

      try {
        if (
          aboutFile &&
          aboutFile.size
        ) {
          about =
            await uploadImage(
              aboutFile,
              'store-assets'
            );
        }

        const heroUrls = [];

        for (
          let i = 0;
          i < slots;
          i++
        ) {
          const file =
            fd.get(
              `hero_file_${i}`
            );

          if (
            file &&
            file.size
          ) {
            heroUrls.push(
              await uploadImage(
                file,
                'store-assets'
              )
            );
          } else if (
            existing[i]
          ) {
            heroUrls.push(
              existing[i]
            );
          }
        }

        const row = {
          hero_title:
            fd.get(
              'hero_title'
            ),

          hero_tagline:
            fd.get(
              'hero_tagline'
            ),

          hero_images:
            heroUrls,

          about_text:
            fd.get(
              'about_text'
            ),

          about_image_url:
            about
        };

        const { error } =
          await db
            .from(
              'store_settings'
            )
            .update(row)
            .eq('id', 1);

        if (error) {
          throw error;
        }

        await loadAll();

        alert(
          'Appearance saved.'
        );

        renderShell();

      } catch (err) {
        alert(err.message);
      }
    };
}

/* ===========================
   SECURITY
=========================== */

function security(m) {
  m.innerHTML = `

    ${pageHeader(
      'Access',
      'Security',
      'Manage your admin account and session.'
    )}

    <div class="security-grid">

      <section class="app-card panel">

        <small>
          Signed in as
        </small>

        <h3 class="account-email">
          ${esc(
            A.session.user.email
          )}
        </h3>

        <p class="muted">
          Admin access is protected by
          Supabase Auth and the admin_users table.
        </p>

      </section>

      <section class="app-card panel">

        <h3>
          Session
        </h3>

        <p class="muted">
          Your service-role key is never
          exposed to the browser.
        </p>

        <button
          class="danger-btn full-btn"
          id="logout"
        >
          Log Out
        </button>

      </section>

    </div>
  `;

  document.getElementById(
    'logout'
  ).onclick =
    async () => {
      await db.auth.signOut();

      A.session = null;

      renderLogin();
    };
}

/* ===========================
   START APP
=========================== */

init().catch(e => {
  console.error(e);

  app.innerHTML = `
    <div class="login-wrap">

      <div class="login-card">

        <h2>
          Bilihan Admin
        </h2>

        <p>
          ${esc(e.message)}
        </p>

      </div>

    </div>
  `;
});
