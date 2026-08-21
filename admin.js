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
  String(s ?? '').replace(
    /[&<>'"]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[c]
  );

/* =========================================================
   SUPABASE / AUTH
   ========================================================= */

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

        <span class="eyebrow">Bilihan v3</span>

        <h2>Connect Supabase</h2>

        <p>
          Edit <strong>config.js</strong> once and paste your
          Supabase Project URL and public key, then reload this page.
        </p>

        <p class="muted">
          Never paste a service_role or secret key into the website.
        </p>
      </div>
    </div>
  `;
}

function renderLogin(msg = '') {
  app.innerHTML = `
    <div class="login-wrap">
      <form id="loginForm" class="login-card admin-form">

        <img
          src="bilihan-logo.png"
          class="login-logo"
          alt="Bilihan"
        >

        <span class="eyebrow">Bilihan Admin</span>

        <h2>Secure sign in</h2>

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

        <button class="primary-btn">
          Sign In
        </button>

      </form>
    </div>
  `;

  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();

    const d = Object.fromEntries(
      new FormData(e.currentTarget)
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

/* =========================================================
   LOAD DATA
   ========================================================= */

async function loadAll() {
  const [p, c, o, s] = await Promise.all([
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

/* =========================================================
   APP SHELL
   ========================================================= */

function sectionLabel(section) {
  return (
    {
      dashboard: 'Dashboard',
      products: 'Products',
      categories: 'Categories',
      orders: 'Orders',
      settings: 'Store Settings',
      appearance: 'Appearance',
      security: 'Security'
    }[section] || 'Dashboard'
  );
}

function renderShell() {
  app.innerHTML = `
    <div class="admin-app">

      <aside
        class="sidebar"
        id="adminSidebar"
      >

        <div class="admin-brand">

          <img
            src="bilihan-logo.png"
            alt="Bilihan"
          >

          <div>
            <strong>Bilihan</strong>
            <small>ADMIN</small>
          </div>

          <button
            class="icon-btn sidebar-close"
            id="sidebarClose"
            type="button"
            aria-label="Close menu"
          >
            ✕
          </button>

        </div>

        <nav class="side-nav">

          ${[
            ['dashboard', '⌂', 'Dashboard'],
            ['products', '▣', 'Products'],
            ['categories', '▦', 'Categories'],
            ['orders', '🛒', 'Orders'],
            ['settings', '⚙', 'Store Settings'],
            ['appearance', '✦', 'Appearance'],
            ['security', '🔒', 'Security']
          ]
            .map(
              ([id, icon, name]) => `
                <button
                  type="button"
                  data-s="${id}"
                  class="${
                    A.section === id
                      ? 'active'
                      : ''
                  }"
                >
                  <span class="nav-icon">
                    ${icon}
                  </span>

                  <span class="nav-label">
                    ${name}
                  </span>
                </button>
              `
            )
            .join('')}

        </nav>

        <div class="sidebar-footer">
          <small>Signed in</small>

          <span>
            ${esc(
              A.session?.user?.email || ''
            )}
          </span>
        </div>

      </aside>

      <div
        class="sidebar-backdrop"
        id="sidebarBackdrop"
      ></div>

      <section class="app-stage">

        <header class="app-topbar">

          <div class="topbar-left">

            <button
              class="icon-btn menu-btn"
              id="menuBtn"
              type="button"
              aria-label="Open menu"
            >
              ☰
            </button>

            <div>
              <span class="topbar-kicker">
                Bilihan Admin
              </span>

              <strong id="pageTitle">
                ${sectionLabel(A.section)}
              </strong>
            </div>

          </div>

          <div class="topbar-actions">

            <button
              class="icon-btn"
              id="refreshBtn"
              type="button"
              title="Refresh"
              aria-label="Refresh"
            >
              ↻
            </button>

            <img
              src="bilihan-logo.png"
              class="topbar-avatar"
              alt=""
            >

          </div>

        </header>

        <main
          id="adminMain"
          class="admin-main"
        ></main>

        <nav class="mobile-bottom-nav">

          ${[
            ['dashboard', '⌂', 'Home'],
            ['products', '▣', 'Products'],
            ['categories', '▦', 'Categories'],
            ['orders', '🛒', 'Orders'],
            ['settings', '⚙', 'Settings']
          ]
            .map(
              ([id, icon, name]) => `
                <button
                  type="button"
                  data-s="${id}"
                  class="${
                    A.section === id
                      ? 'active'
                      : ''
                  }"
                >
                  <span class="nav-icon">
                    ${icon}
                  </span>

                  <span class="nav-label">
                    ${name}
                  </span>
                </button>
              `
            )
            .join('')}

        </nav>

      </section>

    </div>
  `;

  const go = id => {
    A.section = id;
    renderShell();
  };

  document
    .querySelectorAll('[data-s]')
    .forEach(button => {
      button.onclick = () =>
        go(button.dataset.s);
    });

  const sidebar =
    document.getElementById(
      'adminSidebar'
    );

  const backdrop =
    document.getElementById(
      'sidebarBackdrop'
    );

  const openMenu = () => {
    sidebar.classList.add('open');
    backdrop.classList.add('show');

    document.body.classList.add(
      'menu-open'
    );
  };

  const closeMenu = () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');

    document.body.classList.remove(
      'menu-open'
    );
  };

  document
    .getElementById('menuBtn')
    ?.addEventListener(
      'click',
      openMenu
    );

  document
    .getElementById('sidebarClose')
    ?.addEventListener(
      'click',
      closeMenu
    );

  backdrop?.addEventListener(
    'click',
    closeMenu
  );

  document
    .getElementById('refreshBtn')
    ?.addEventListener(
      'click',
      async e => {
        const button =
          e.currentTarget;

        button.classList.add('spin');

        try {
          await loadAll();
          renderShell();
        } catch (err) {
          button.classList.remove(
            'spin'
          );

          alert(err.message);
        }
      }
    );

  const main =
    document.getElementById(
      'adminMain'
    );

  (
    {
      dashboard,
      products,
      categories,
      orders,
      settings,
      appearance,
      security
    }[A.section] || dashboard
  )(main);
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function dashboard(m) {
  const products = A.data.products;
  const orders = A.data.orders;

  const available =
    products.filter(
      p =>
        p.is_available &&
        p.stock > 0
    ).length;

  const soldOut =
    products.filter(
      p =>
        !p.is_available ||
        p.stock <= 0
    ).length;

  const lowStock =
    products.filter(
      p =>
        p.stock > 0 &&
        p.stock <= 5
    ).length;

  const pendingPayments =
    orders.filter(
      o =>
        (o.payment_status ||
          'Pending') ===
        'Pending'
    ).length;

  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Overview
      </span>

      <h1>Dashboard</h1>

      <p>
        Manage your live Bilihan
        storefront from one place.
      </p>

    </div>

    <div class="metric-grid">

      <div class="metric">
        <small>Total Products</small>
        <h2>${products.length}</h2>
        <span>All catalog items</span>
      </div>

      <div class="metric">
        <small>Available</small>
        <h2>${available}</h2>
        <span>Ready to order</span>
      </div>

      <div class="metric">
        <small>Sold Out</small>
        <h2>${soldOut}</h2>
        <span>Needs attention</span>
      </div>

      <div class="metric">
        <small>Total Orders</small>
        <h2>${orders.length}</h2>
        <span>All recorded orders</span>
      </div>

    </div>

    <div class="dashboard-grid">

      <section class="panel">

        <div class="section-title">

          <div>
            <span class="eyebrow">
              Live data
            </span>

            <h3>
              Supabase control center
            </h3>
          </div>

          <span
            class="status-dot"
          ></span>

        </div>

        <p>
          Products, categories,
          orders, images, stock and
          storefront settings save
          directly to Supabase.
        </p>

      </section>

      <section class="panel">

        <div class="section-title">
          <div>
            <span class="eyebrow">
              Quick view
            </span>

            <h3>Store health</h3>
          </div>
        </div>

        <div class="summary-row">
          <span>Low stock (≤5)</span>
          <strong>${lowStock}</strong>
        </div>

        <div class="summary-row">
          <span>
            Pending payments
          </span>

          <strong>
            ${pendingPayments}
          </strong>
        </div>

      </section>

    </div>
  `;
}

/* =========================================================
   IMAGE UPLOAD
   ========================================================= */

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

  if (error) throw error;

  return db.storage
    .from(bucket)
    .getPublicUrl(path)
    .data.publicUrl;
}

/* =========================================================
   PRODUCTS
   ========================================================= */

function products(m) {
  const rows =
    A.data.products.map(p => {
      const category =
        A.data.categories.find(
          c =>
            c.id ===
            p.category_id
        )?.name || '';

      return {
        p,
        category
      };
    });

  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Catalog
      </span>

      <h1>Products</h1>

      <p>
        Add, edit, reorder and
        manage stock from any device.
      </p>

    </div>

    <div class="content-split">

      <div>

        <div
          class="
            panel
            desktop-table
            table-wrap
          "
        >

          <table class="table">

            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>

              ${rows
                .map(
                  ({
                    p,
                    category
                  }) => `
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

                        <span
                          class="
                            pill
                            ${
                              p.is_available &&
                              p.stock > 0
                                ? 'success'
                                : 'danger'
                            }
                          "
                        >
                          ${
                            p.is_available &&
                            p.stock > 0
                              ? 'Available'
                              : 'Sold Out'
                          }
                        </span>

                      </td>

                      <td>

                        <div
                          class="row-actions"
                        >

                          <button
                            onclick="editProduct('${p.id}')"
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
                  `
                )
                .join('')}

            </tbody>

          </table>

        </div>

        <div
          class="mobile-card-list"
        >

          ${rows
            .map(
              ({
                p,
                category
              }) => `
                <article
                  class="
                    app-card
                    product-admin-card
                  "
                >

                  <img
                    src="${esc(
                      p.image_url ||
                        'bilihan-logo.png'
                    )}"
                    alt=""
                  >

                  <div
                    class="
                      product-admin-info
                    "
                  >

                    <div
                      class="
                        product-admin-top
                      "
                    >

                      <div>
                        <strong>
                          ${esc(p.name)}
                        </strong>

                        <small>
                          ${esc(category)}
                        </small>
                      </div>

                      <span
                        class="
                          pill
                          ${
                            p.is_available &&
                            p.stock > 0
                              ? 'success'
                              : 'danger'
                          }
                        "
                      >
                        ${
                          p.is_available &&
                          p.stock > 0
                            ? 'Available'
                            : 'Sold Out'
                        }
                      </span>

                    </div>

                    <div
                      class="product-meta"
                    >
                      <span>
                        ${money(p.price)}
                      </span>

                      <span>
                        Stock:
                        <strong>
                          ${p.stock}
                        </strong>
                      </span>
                    </div>

                    <div
                      class="card-actions"
                    >

                      <button
                        onclick="editProduct('${p.id}')"
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
              `
            )
            .join('')}

        </div>

      </div>

      <aside
        class="
          panel
          sticky-editor
        "
      >

        <div class="form-title">
          <div>
            <span class="eyebrow">
              No-code editor
            </span>

            <h3>Add product</h3>
          </div>
        </div>

        <form
          id="productForm"
          class="admin-form"
        >

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
              ${A.data.categories
                .map(
                  c => `
                    <option
                      value="${c.id}"
                    >
                      ${esc(c.name)}
                    </option>
                  `
                )
                .join('')}
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
            Image URL

            <input
              name="image_url"
              placeholder="
                Optional direct image URL
              "
            >
          </label>

          <label
            class="switch-row"
          >

            <span>
              Available

              <small>
                Allow customers to
                order this product.
              </small>
            </span>

            <input
              type="checkbox"
              name="is_available"
              checked
            >

          </label>

          <button
            class="
              primary-btn
              full-btn
            "
          >
            Save Product
          </button>

        </form>

      </aside>

    </div>
  `;

  document
    .getElementById(
      'productForm'
    )
    .onsubmit = async e => {
      e.preventDefault();

      const fd =
        new FormData(
          e.currentTarget
        );

      const file =
        fd.get('image_file');

      let image =
        String(
          fd.get(
            'image_url'
          ) || ''
        ).trim();

      try {
        if (
          file &&
          file.size
        ) {
          image =
            await uploadImage(
              file
            );
        }

        const stock =
          +fd.get('stock');

        const row = {
          name:
            fd.get('name'),

          description:
            fd.get(
              'description'
            ),

          category_id:
            fd.get(
              'category_id'
            ),

          price:
            +fd.get('price'),

          stock,

          is_available:
            fd.get(
              'is_available'
            ) === 'on' &&
            stock > 0,

          image_url:
            image || null,

          sort_order:
            A.data.products
              .length + 1
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
      }
    };
}

/* =========================================================
   EDIT PRODUCT
   ========================================================= */

window.editProduct =
  async id => {
    const p =
      A.data.products.find(
        x => x.id === id
      );

    if (!p) return;

    const name =
      prompt(
        'Product name',
        p.name
      );

    if (name === null) return;

    const price =
      prompt(
        'Price',
        p.price
      );

    if (price === null) return;

    const stock =
      prompt(
        'Stock',
        p.stock
      );

    if (stock === null) return;

    const description =
      prompt(
        'Description',
        p.description
      );

    if (
      description === null
    ) {
      return;
    }

    const {
      error
    } =
      await db
        .from('products')
        .update({
          name,
          price: +price,
          stock: +stock,
          description,
          is_available:
            +stock > 0
        })
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
    }

    await loadAll();
    renderShell();
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

    const {
      error
    } =
      await db
        .from('products')
        .delete()
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
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
      [
        ...A.data.products
      ].sort(
        (a, b) =>
          a.sort_order -
          b.sort_order
      );

    const index =
      sorted.findIndex(
        p => p.id === id
      );

    const nextIndex =
      index + direction;

    if (
      nextIndex < 0 ||
      nextIndex >=
        sorted.length
    ) {
      return;
    }

    const current =
      sorted[index];

    const next =
      sorted[nextIndex];

    const {
      error: error1
    } =
      await db
        .from('products')
        .update({
          sort_order:
            next.sort_order
        })
        .eq(
          'id',
          current.id
        );

    const {
      error: error2
    } =
      await db
        .from('products')
        .update({
          sort_order:
            current.sort_order
        })
        .eq(
          'id',
          next.id
        );

    if (
      error1 ||
      error2
    ) {
      alert(
        (
          error1 ||
          error2
        ).message
      );

      return;
    }

    await loadAll();
    renderShell();
  };

/* =========================================================
   CATEGORIES
   ========================================================= */

function categories(m) {
  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Menu structure
      </span>

      <h1>Categories</h1>

      <p>
        Organize how customers
        browse your menu.
      </p>

    </div>

    <div class="content-split">

      <div
        class="
          panel
          stack-list
        "
      >

        ${
          A.data.categories.length
            ? A.data.categories
                .map(
                  c => `
                    <div
                      class="
                        summary-row
                        category-row
                      "
                    >

                      <strong>
                        ${esc(c.name)}
                      </strong>

                      <div
                        class="
                          row-actions
                        "
                      >

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
                <div
                  class="empty-state"
                >
                  No categories yet.
                </div>
              `
        }

      </div>

      <form
        id="catForm"
        class="
          panel
          admin-form
          sticky-editor
        "
      >

        <div class="form-title">
          <div>
            <span class="eyebrow">
              New category
            </span>

            <h3>Add category</h3>
          </div>
        </div>

        <label>
          Category name

          <input
            name="name"
            placeholder="e.g. Meals"
            required
          >
        </label>

        <button
          class="
            primary-btn
            full-btn
          "
        >
          Add Category
        </button>

      </form>

    </div>
  `;

  document
    .getElementById(
      'catForm'
    )
    .onsubmit =
      async e => {
        e.preventDefault();

        const name =
          new FormData(
            e.currentTarget
          ).get('name');

        const {
          error
        } =
          await db
            .from(
              'categories'
            )
            .insert({
              name,
              sort_order:
                A.data
                  .categories
                  .length + 1
            });

        if (error) {
          alert(
            error.message
          );

          return;
        }

        await loadAll();
        renderShell();
      };
}

window.renameCategory =
  async id => {
    const category =
      A.data.categories.find(
        x => x.id === id
      );

    const name =
      prompt(
        'Category name',
        category.name
      );

    if (!name) return;

    const {
      error
    } =
      await db
        .from(
          'categories'
        )
        .update({
          name
        })
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
    }

    await loadAll();
    renderShell();
  };

window.deleteCategory =
  async id => {
    if (
      A.data.products.some(
        p =>
          p.category_id ===
          id
      )
    ) {
      alert(
        'Move or delete products in this category first.'
      );

      return;
    }

    if (
      !confirm(
        'Delete category?'
      )
    ) {
      return;
    }

    const {
      error
    } =
      await db
        .from(
          'categories'
        )
        .delete()
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
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
      [
        ...A.data
          .categories
      ].sort(
        (a, b) =>
          a.sort_order -
          b.sort_order
      );

    const index =
      sorted.findIndex(
        c => c.id === id
      );

    const nextIndex =
      index + direction;

    if (
      nextIndex < 0 ||
      nextIndex >=
        sorted.length
    ) {
      return;
    }

    const current =
      sorted[index];

    const next =
      sorted[nextIndex];

    const {
      error: error1
    } =
      await db
        .from(
          'categories'
        )
        .update({
          sort_order:
            next.sort_order
        })
        .eq(
          'id',
          current.id
        );

    if (error1) {
      alert(
        error1.message
      );

      return;
    }

    const {
      error: error2
    } =
      await db
        .from(
          'categories'
        )
        .update({
          sort_order:
            current.sort_order
        })
        .eq(
          'id',
          next.id
        );

    if (error2) {
      alert(
        error2.message
      );

      return;
    }

    await loadAll();
    renderShell();
  };

/* =========================================================
   PAYMENT STATUS
   ========================================================= */

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

  const css =
    status === 'Paid'
      ? 'payment-paid'
      : status ===
          'Not Paid'
        ? 'payment-not-paid'
        : 'payment-pending';

  return `
    <select
      class="
        payment-select
        ${css}
      "
      onchange="
        updatePaymentStatus(
          '${o.id}',
          this.value
        )
      "
    >

      ${Object.keys(
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
        .join('')}

    </select>
  `;
}

/* =========================================================
   ORDERS
   ========================================================= */

function orders(m) {
  const totals =
    A.data.orders.reduce(
      (acc, order) => {
        const status =
          order.payment_status ||
          'Pending';

        acc.sell +=
          +order.total;

        if (
          status === 'Paid'
        ) {
          acc.paid +=
            +order.total;
        } else {
          acc.unpaid +=
            +order.total;
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
    <div class="page-heading">

      <span class="eyebrow">
        Customer orders
      </span>

      <h1>Orders</h1>

      <p>
        Search, review and update
        payment status from desktop
        or mobile.
      </p>

    </div>

    <div
      class="
        metric-grid
        order-metrics
      "
    >

      <div class="metric">
        <small>Total Sell</small>
        <h2>
          ${money(totals.sell)}
        </h2>
      </div>

      <div class="metric">
        <small>Total Paid</small>
        <h2>
          ${money(totals.paid)}
        </h2>
      </div>

      <div class="metric">
        <small>Total Unpaid</small>
        <h2>
          ${money(totals.unpaid)}
        </h2>
      </div>

    </div>

    <div
      class="
        order-tools
        panel
      "
    >

      <input
        id="orderSearch"
        class="search-input"
        placeholder="
          Search name, phone,
          order number
        "
      >

      <div
        id="payFilters"
        class="filter-pills"
      >

        ${[
          'all',
          'Paid',
          'Pending',
          'Not Paid'
        ]
          .map(
            filter => `
              <button
                type="button"
                data-f="${filter}"
                class="${
                  A.orderFilter ===
                  filter
                    ? 'active'
                    : ''
                }"
              >
                ${
                  filter === 'all'
                    ? 'All'
                    : filter
                }
              </button>
            `
          )
          .join('')}

      </div>

    </div>

    <div id="orderList"></div>
  `;

  document
    .querySelectorAll(
      '#payFilters button'
    )
    .forEach(button => {
      button.onclick = () => {
        A.orderFilter =
          button.dataset.f;

        orders(m);
      };
    });

  const draw = () => {
    const search =
      document
        .getElementById(
          'orderSearch'
        )
        .value
        .toLowerCase();

    const rows =
      A.data.orders.filter(
        order => {
          const matchesSearch =
            `${
              order.order_code
            } ${
              order.customer_name
            } ${
              order.phone || ''
            }`
              .toLowerCase()
              .includes(
                search
              );

          const matchesFilter =
            A.orderFilter ===
              'all' ||
            (
              order.payment_status ||
              'Pending'
            ) ===
              A.orderFilter;

          return (
            matchesSearch &&
            matchesFilter
          );
        }
      );

    if (!rows.length) {
      document.getElementById(
        'orderList'
      ).innerHTML = `
        <div
          class="
            panel
            empty-state
          "
        >
          No orders match this
          filter.
        </div>
      `;

      return;
    }

    const desktop = `
      <div
        class="
          panel
          desktop-table
          table-wrap
        "
      >

        <table class="table">

          <thead>
            <tr>
              <th>Order</th>
              <th>Payment</th>
              <th>Customer</th>
              <th>Fulfillment</th>
              <th>
                Preferred Date
              </th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>

            ${rows
              .map(
                o => `
                  <tr>

                    <td>
                      <strong>
                        #${esc(
                          o.order_code
                        )}
                      </strong>

                      <br>

                      <small>
                        ${new Date(
                          o.created_at
                        ).toLocaleString()}
                      </small>
                    </td>

                    <td>
                      ${paySelectHtml(
                        o
                      )}
                    </td>

                    <td>
                      <strong>
                        ${esc(
                          o.customer_name
                        )}
                      </strong>

                      <br>

                      <small>
                        ${esc(
                          o.phone ||
                            '—'
                        )}
                      </small>
                    </td>

                    <td>
                      ${esc(
                        o.fulfillment
                      )}
                    </td>

                    <td>
                      ${esc(
                        o.preferred_date
                      )}
                    </td>

                    <td>
                      ${money(
                        o.total
                      )}
                    </td>

                    <td>
                      ${esc(
                        o.status
                      )}
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
              .join('')}

          </tbody>

        </table>

      </div>
    `;

    const mobile = `
      <div
        class="mobile-card-list"
      >

        ${rows
          .map(
            o => `
              <article
                class="
                  app-card
                  order-card
                "
              >

                <div
                  class="
                    order-card-head
                  "
                >

                  <div>
                    <strong>
                      #${esc(
                        o.order_code
                      )}
                    </strong>

                    <small>
                      ${new Date(
                        o.created_at
                      ).toLocaleString()}
                    </small>
                  </div>

                  ${paySelectHtml(
                    o
                  )}

                </div>

                <div
                  class="
                    order-customer
                  "
                >

                  <strong>
                    ${esc(
                      o.customer_name
                    )}
                  </strong>

                  <span>
                    ${esc(
                      o.phone ||
                        '—'
                    )}
                  </span>

                </div>

                <div
                  class="
                    order-info-grid
                  "
                >

                  <div>
                    <small>
                      Total
                    </small>

                    <strong>
                      ${money(
                        o.total
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      Fulfillment
                    </small>

                    <strong>
                      ${esc(
                        o.fulfillment
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      Preferred date
                    </small>

                    <strong>
                      ${esc(
                        o.preferred_date
                      )}
                    </strong>
                  </div>

                  <div>
                    <small>
                      Status
                    </small>

                    <strong>
                      ${esc(
                        o.status
                      )}
                    </strong>
                  </div>

                </div>

                <details>

                  <summary>
                    Order details
                  </summary>

                  <div
                    class="
                      details-stack
                    "
                  >

                    <p>
                      <strong>
                        Address:
                      </strong>

                      ${esc(
                        o.address ||
                          '—'
                      )}
                    </p>

                    <p>
                      <strong>
                        Payment method:
                      </strong>

                      ${esc(
                        o.payment_method
                      )}
                    </p>

                    <p>
                      <strong>
                        Items:
                      </strong>

                      ${
                        (
                          o.order_items ||
                          []
                        )
                          .map(
                            item =>
                              `${esc(
                                item.product_name
                              )} × ${item.qty}`
                          )
                          .join(
                            ', '
                          ) ||
                        '—'
                      }
                    </p>

                    <p>
                      <strong>
                        Cancellation
                        reason:
                      </strong>

                      ${esc(
                        o.cancellation_reason ||
                          '—'
                      )}
                    </p>

                  </div>

                </details>

                <button
                  class="
                    danger-outline
                    full-btn
                  "
                  onclick="deleteOrder('${o.id}')"
                >
                  Delete Order
                </button>

              </article>
            `
          )
          .join('')}

      </div>
    `;

    document.getElementById(
      'orderList'
    ).innerHTML =
      desktop + mobile;
  };

  document.getElementById(
    'orderSearch'
  ).oninput = draw;

  draw();
}

window.updatePaymentStatus =
  async (
    id,
    status
  ) => {
    const {
      error
    } =
      await db
        .from('orders')
        .update({
          payment_status:
            status
        })
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
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

    const {
      error
    } =
      await db
        .from('orders')
        .delete()
        .eq(
          'id',
          id
        );

    if (error) {
      alert(error.message);
      return;
    }

    await loadAll();
    renderShell();
  };

/* =========================================================
   STORE SETTINGS
   ========================================================= */

function settings(m) {
  const s =
    A.data.settings;

  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Business info
      </span>

      <h1>Store Settings</h1>

      <p>
        Update the information
        customers see without
        touching GitHub code.
      </p>

    </div>

    <form
      id="settingsForm"
      class="
        panel
        admin-form
        narrow-form
      "
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
        QR image URL

        <input
          name="qr_image_url"
          value="${esc(
            s.qr_image_url ||
              ''
          )}"
          placeholder="
            Or paste a direct
            image URL
          "
        >
      </label>

      <button
        class="
          primary-btn
          full-btn
        "
      >
        Save Settings
      </button>

    </form>
  `;

  document
    .getElementById(
      'settingsForm'
    )
    .onsubmit =
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

          const {
            error
          } =
            await db
              .from(
                'store_settings'
              )
              .update(row)
              .eq(
                'id',
                1
              );

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

/* =========================================================
   APPEARANCE
   ========================================================= */

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
        <div
          class="upload-field"
        >

          <label>
            Hero image ${i + 1}
          </label>

          ${
            existing[i]
              ? `
                  <img
                    src="${esc(
                      existing[i]
                    )}"
                    class="
                      upload-preview
                    "
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

        </div>
      `
    ).join('');

  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Storefront content
      </span>

      <h1>Appearance</h1>

      <p>
        Control your homepage
        text and imagery from
        the Admin app.
      </p>

    </div>

    <form
      id="appearanceForm"
      class="
        panel
        admin-form
      "
    >

      <label>
        Hero title

        <input
          name="hero_title"
          value="${esc(
            s.hero_title
          )}"
        >
      </label>

      <label>
        Hero tagline

        <textarea
          name="hero_tagline"
        >${esc(
          s.hero_tagline
        )}</textarea>
      </label>

      <div
        class="upload-grid"
      >
        ${heroSlots}
      </div>

      <label>
        About text

        <textarea
          name="about_text"
          rows="6"
        >${esc(
          s.about_text
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
        About image URL

        <input
          name="about_image_url"
          value="${esc(
            s.about_image_url ||
              ''
          )}"
          placeholder="
            Or paste a direct
            image URL
          "
        >
      </label>

      <button
        class="
          primary-btn
          full-btn
        "
      >
        Save Appearance
      </button>

    </form>
  `;

  document
    .getElementById(
      'appearanceForm'
    )
    .onsubmit =
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

          const {
            error
          } =
            await db
              .from(
                'store_settings'
              )
              .update(row)
              .eq(
                'id',
                1
              );

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

/* =========================================================
   SECURITY
   ========================================================= */

function security(m) {
  m.innerHTML = `
    <div class="page-heading">

      <span class="eyebrow">
        Access
      </span>

      <h1>Security</h1>

      <p>
        Your Admin area is
        protected by Supabase
        authentication.
      </p>

    </div>

    <div
      class="security-grid"
    >

      <section class="panel">

        <span class="eyebrow">
          Account
        </span>

        <h3>Signed in as</h3>

        <p
          class="account-email"
        >
          ${esc(
            A.session.user.email
          )}
        </p>

        <p class="muted">
          Access is checked
          against the
          <code>
            admin_users
          </code>
          table.
        </p>

      </section>

      <section class="panel">

        <span class="eyebrow">
          Session
        </span>

        <h3>Log out</h3>

        <p class="muted">
          End the current Admin
          session on this device.
        </p>

        <button
          class="danger-btn"
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

/* =========================================================
   START ADMIN APP
   ========================================================= */

init().catch(error => {
  console.error(error);

  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">

        <img
          src="bilihan-logo.png"
          class="login-logo"
          alt="Bilihan"
        >

        <span class="eyebrow">
          Bilihan Admin
        </span>

        <h2>
          Something went wrong
        </h2>

        <p>
          ${esc(error.message)}
        </p>

      </div>
    </div>
  `;
});
