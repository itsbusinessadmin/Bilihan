const GOOGLE_SHEETS_WEB_APP_URL = (window.BILIHAN_CONFIG||{}).GOOGLE_SHEETS_WEB_APP_URL || '';
const A={section:'dashboard',session:null,orderFilter:'all',data:{products:[],categories:[],orders:[],settings:null}};const app=document.getElementById('app');const money=n=>`₱${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function configured(){return !!window.BILIHAN_SUPABASE_CONFIGURED}
/* The Supabase client stores the session in this browser (persistSession), so a
   device that has signed in once stays signed in until Log Out is used.

   Only a definite "you are not an admin" answer may tear that down. A network
   failure must never sign the device out: signOut() deletes the stored refresh
   token, so treating one unreachable request as "not an admin" loses the saved
   session permanently and forces a fresh login.

   Returns 'yes' | 'no' | 'unknown'. */
async function adminStatus(){
  if(!A.session)return 'no';
  for(let attempt=0;attempt<2;attempt++){
    const {data,error}=await db.rpc('is_admin');
    if(!error)return data===true?'yes':'no';
    console.warn('Bilihan admin: could not verify admin access',error);
    if(attempt===0)await new Promise(r=>setTimeout(r,700));
  }
  return 'unknown';
}

function renderRestoring(){app.innerHTML=`<div class="login-wrap"><div class="login-card"><img src="bilihan-mark.webp" alt="" style="width:86px;border-radius:50%;margin:auto"><span class="eyebrow">Bilihan Admin</span><h2>Signing you in…</h2><p class="muted">Restoring your session on this device.</p></div></div>`}

/* Reached when the database is unreachable. The session stays saved, so this is a
   retry screen rather than a login screen. */
function renderReconnect(message){
  const email=A.session?.user?.email||'';
  app.innerHTML=`<div class="login-wrap"><div class="login-card"><img src="bilihan-mark.webp" alt="" style="width:86px;border-radius:50%;margin:auto"><span class="eyebrow">Bilihan Admin</span><h2>Can't reach the database</h2><div class="status-banner">${esc(message||'We could not load your admin data.')}</div><p class="muted">You are still signed in on this device${email?` as ${esc(email)}`:''}.</p><button type="button" class="primary-btn" id="retryAdmin">Try Again</button><button type="button" class="secondary-btn" id="signOutAdmin">Log Out</button></div></div>`;
  document.getElementById('retryAdmin').onclick=()=>{init().catch(err=>renderReconnect(err?.message))};
  document.getElementById('signOutAdmin').onclick=async()=>{await db.auth.signOut();A.session=null;renderLogin()};
}

async function init(){
  if(!configured()){renderSetup();return}
  renderRestoring();
  let session=null;
  try{const {data}=await db.auth.getSession();session=data?.session||null}
  catch(err){console.warn('Bilihan admin: could not read the stored session',err)}
  A.session=session;
  if(!session){renderLogin();return}
  const status=await adminStatus();
  if(status==='no'){await db.auth.signOut();A.session=null;renderLogin('This account is not listed as a Bilihan admin.');return}
  if(status==='unknown'){renderReconnect('We could not confirm your admin access right now.');return}
  try{await loadAll()}
  catch(err){console.error(err);renderReconnect(err?.message);return}
  renderShell();
}
function renderSetup(){app.innerHTML=`<div class="login-wrap"><div class="login-card"><img src="bilihan-logo.png" style="width:90px;border-radius:50%"><span class="eyebrow">Bilihan v3</span><h2>Connect Supabase</h2><p>Edit <strong>config.js</strong> once and paste your Supabase Project URL and anon public key, then reload this page.</p><p class="muted">Never paste a service_role key into the website.</p></div></div>`}
function renderLogin(msg=''){app.innerHTML=`<div class="login-wrap"><form id="loginForm" class="login-card admin-form"><img src="bilihan-mark.webp" alt="" style="width:86px;border-radius:50%;margin:auto"><span class="eyebrow">Bilihan Admin</span><h2>Secure sign in</h2>${msg?`<div class="status-banner">${esc(msg)}</div>`:''}<label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary-btn">Sign In</button><p class="muted" style="margin:0;text-align:center">This device stays signed in until you use Log Out.</p></form></div>`;document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));const {data,error}=await db.auth.signInWithPassword(d);if(error)return renderLogin(error.message);A.session=data.session;const status=await adminStatus();if(status==='no'){await db.auth.signOut();A.session=null;return renderLogin('This account is not listed as a Bilihan admin.')}if(status==='unknown')return renderReconnect('We could not confirm your admin access right now.');try{await loadAll()}catch(err){console.error(err);return renderReconnect(err?.message)}renderShell()}}
async function loadAll(){const [p,c,o,s,t]=await Promise.all([db.from('products').select('*').order('sort_order'),db.from('categories').select('*').order('sort_order'),db.from('orders').select('*,order_items(*)').order('created_at',{ascending:false}),db.from('store_settings').select('*').eq('id',1).single(),db.from('support_threads').select('*').order('last_message_at',{ascending:false})]);for(const r of [p,c,o,s])if(r.error)throw r.error;
  /* The support tables may not exist yet on a database that predates the chat, so
     a failure there must not stop the rest of Admin from loading. */
  if(t.error)console.warn('Bilihan admin: support threads unavailable',t.error);
  A.data={products:p.data,categories:c.data,orders:o.data,settings:s.data,threads:t.error?[]:(t.data||[])}}
function renderShell(){app.innerHTML=`<div class="admin-shell"><aside class="sidebar"><div class="admin-brand"><img src="bilihan-logo.png"><div><strong>Bilihan</strong><small style="display:block">ADMIN</small></div></div><nav class="side-nav">${[['dashboard','Dashboard'],['products','Products'],['categories','Categories'],['orders','Orders'],['messages','Messages'],['settings','Settings'],['appearance','Appearance'],['security','Security']].map(([id,n])=>`<button data-s="${id}" class="${A.section===id?'active':''}">${n}${id==='messages'&&adminUnreadTotal()?`<span class="nav-badge">${adminUnreadTotal()>99?'99+':adminUnreadTotal()}</span>`:''}</button>`).join('')}</nav></aside><main id="adminMain" class="admin-main"></main></div>`;document.querySelectorAll('.side-nav button').forEach(b=>b.onclick=()=>{A.section=b.dataset.s;bulkReset();if(A.section!=='messages'){stopMessagePolling();MSG.openId=null}renderShell()});const m=document.getElementById('adminMain');({dashboard,products,categories,orders,messages,settings,appearance,security}[A.section]||dashboard)(m)}
/* ---- Sales reporting ----------------------------------------------------
   Resolve the original-price / interest split for one order line. An order item
   may carry its own original_price and interest recorded at order time; when it
   does not, fall back to the product row, matched by id first and then by name
   so renamed or deleted products still resolve. */
function lineItemPrices(item){
  const p=A.data.products.find(x=>x.id===item.product_id)
        ||A.data.products.find(x=>String(x.name||'').toLowerCase()===String(item.product_name||'').toLowerCase());
  const unit=Number(item.unit_price??p?.price??0);
  const original=Number(item.original_price??p?.original_price??unit);
  const interest=Number(item.interest??p?.interest??0);
  return {original,interest};
}
/* A cancelled order is not a sale. */
function soldOrders(){return (A.data.orders||[]).filter(o=>o.status!=='Cancelled')}

/* One row per product, best sellers first. */
function salesByProduct(){
  const rows=new Map();
  for(const o of soldOrders()){
    for(const item of (o.order_items||[])){
      const name=item.product_name||'(unnamed product)';
      const qty=Number(item.qty||0);
      const {original,interest}=lineItemPrices(item);
      const row=rows.get(name)||{name,qty:0,original:0,interest:0};
      row.qty+=qty;row.original+=original*qty;row.interest+=interest*qty;
      rows.set(name,row);
    }
  }
  return [...rows.values()]
    .map(r=>({...r,overall:r.original+r.interest}))
    .sort((a,b)=>b.overall-a.overall);
}

function openAllSalesModal(){
  const rows=salesByProduct();
  const t=rows.reduce((a,r)=>({qty:a.qty+r.qty,original:a.original+r.original,interest:a.interest+r.interest,overall:a.overall+r.overall}),{qty:0,original:0,interest:0,overall:0});
  document.getElementById('allSalesModal')?.remove();
  const table=rows.length?`<div class="table-wrap"><table class="table sales-table"><thead><tr><th>Item</th><th>Qty Sold</th><th>Original Price Total</th><th>Interest Total</th><th>Overall</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${r.qty}</td><td>${money(r.original)}</td><td>${money(r.interest)}</td><td><strong>${money(r.overall)}</strong></td></tr>`).join('')}</tbody><tfoot><tr><td><strong>All items</strong></td><td><strong>${t.qty}</strong></td><td><strong>${money(t.original)}</strong></td><td><strong>${money(t.interest)}</strong></td><td><strong>${money(t.overall)}</strong></td></tr></tfoot></table></div>`
    :'<p class="muted" style="padding:20px 0">No sales yet. Once customers place orders they will be broken down here.</p>';
  document.body.insertAdjacentHTML('beforeend',`<div class="admin-modal-backdrop" id="allSalesModal"><div class="admin-modal admin-modal-wide" role="dialog" aria-modal="true" aria-labelledby="allSalesTitle"><div class="admin-modal-header"><div><span class="eyebrow">Overview</span><h2 id="allSalesTitle">All Sales</h2></div><button type="button" class="admin-modal-close" id="closeAllSales" aria-label="Close">&times;</button></div>${table}<p class="muted" style="margin:14px 0 0;font-size:var(--admin-text-caption)">Cancelled orders are not counted. Where an order line has no stored price split, the product's current original price and interest are used, so those rows move if you change a price later.</p></div></div>`);
  document.body.classList.add('modal-open');
  const modal=document.getElementById('allSalesModal');
  const onKey=e=>{if(e.key==='Escape')close()};
  function close(){modal.remove();document.body.classList.remove('modal-open');document.removeEventListener('keydown',onKey);document.getElementById('openAllSales')?.focus()}
  document.getElementById('closeAllSales').onclick=close;
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',onKey);
  document.getElementById('closeAllSales').focus();
}

function dashboard(m){const ps=A.data.products,os=A.data.orders;const salesTotal=salesByProduct().reduce((sum,r)=>sum+r.overall,0);m.innerHTML=`<span class="eyebrow">Overview</span><h2>Dashboard</h2><a class="primary-btn view-store-btn" href="index.html" target="_blank" rel="noopener">View customer store</a><div class="cards"><div class="metric"><small>Total Products</small><h2>${ps.length}</h2></div><div class="metric"><small>Available</small><h2>${ps.filter(p=>p.is_available&&p.stock>0).length}</h2></div><div class="metric"><small>Sold Out</small><h2>${ps.filter(p=>!p.is_available||p.stock<=0).length}</h2></div><div class="metric"><small>Total Orders</small><h2>${os.length}</h2></div><button type="button" class="metric metric-action metric-money" id="openAllSales"><small>All Sales</small><h2>${money(salesTotal)}</h2><span class="metric-hint">View per-item breakdown</span></button></div>`;
  document.getElementById('openAllSales').onclick=openAllSalesModal;
}
/* Product and storefront images are usually picked straight from a phone camera,
   where one photo is several megabytes - and that exact file was then served to
   every customer on every visit. Downscale and re-encode in the browser first.
   WebP is used so logos with transparency survive; if anything about the re-encode
   fails, or it would not actually be smaller, the original file is uploaded. */
const IMAGE_MAX_SIDE=1600, IMAGE_QUALITY=0.82, IMAGE_SKIP_BELOW=200*1024;
async function compressImage(file){
  if(!file.type?.startsWith('image/')||file.type==='image/gif'||file.type==='image/svg+xml')return file;
  let bitmap;
  try{bitmap=await createImageBitmap(file)}catch{return file}
  const scale=Math.min(1,IMAGE_MAX_SIDE/Math.max(bitmap.width,bitmap.height));
  if(scale===1&&file.size<=IMAGE_SKIP_BELOW){bitmap.close?.();return file}
  const width=Math.max(1,Math.round(bitmap.width*scale));
  const height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  canvas.getContext('2d').drawImage(bitmap,0,0,width,height);
  bitmap.close?.();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',IMAGE_QUALITY));
  if(!blob||blob.size>=file.size)return file;
  const base=(file.name||'image').replace(/\.[^.]+$/,'');
  return new File([blob],`${base}.webp`,{type:'image/webp',lastModified:Date.now()});
}
async function uploadImage(file,bucket='product-images'){
  if(!file)return null;
  const prepared=await compressImage(file);
  const ext=(prepared.name.split('.').pop()||'jpg').toLowerCase();
  const path=`${crypto.randomUUID()}.${ext}`;
  const {error}=await db.storage.from(bucket).upload(path,prepared,{upsert:false,contentType:prepared.type});
  if(error)throw error;
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
/* ---- Bulk selection, shared by Products and Orders -------------------------
   Selection lives outside the render so that re-drawing a list (a search keystroke
   on Orders, a reload after saving) keeps the ticks. The checkbox markup is always
   in the DOM and revealed by a class, so toggling select mode never re-renders. */
const bulk={section:null,ids:new Set()};
function bulkReset(){bulk.section=null;bulk.ids.clear()}
function bulkCheckboxHtml(id){return `<label class="row-select"><input type="checkbox" data-pick="${esc(id)}" aria-label="Select for deletion"></label>`}
function bulkBarHtml(){return `<div class="bulk-bar" id="bulkBar" hidden><label class="check-row"><input type="checkbox" id="bulkAll"> Select all</label><span class="bulk-count" id="bulkCount">0 selected</span><div class="row-actions"><button type="button" class="danger-btn" id="bulkDelete" disabled>Delete selected</button><button type="button" id="bulkCancel">Cancel</button></div></div>`}

/* container: the element wrapping the rows. noun: for the confirm prompt.
   remove(ids): performs the deletion. Returns a sync() to call after a re-draw. */
function wireBulk(section,container,noun,remove){
  const bar=document.getElementById('bulkBar');
  const toggle=document.getElementById('bulkToggle');
  const countEl=document.getElementById('bulkCount');
  const delBtn=document.getElementById('bulkDelete');
  const allBox=document.getElementById('bulkAll');
  if(!bar||!container)return()=>{};

  const boxes=()=>[...container.querySelectorAll('[data-pick]')];
  function sync(){
    const on=bulk.section===section;
    container.classList.toggle('select-mode',on);
    bar.hidden=!on;
    if(toggle)toggle.textContent=on?'Done':'Select';
    const list=boxes();
    list.forEach(b=>{b.checked=bulk.ids.has(b.dataset.pick)});
    const n=list.filter(b=>b.checked).length;
    countEl.textContent=`${n} selected`;
    delBtn.disabled=n===0;
    allBox.checked=list.length>0&&n===list.length;
    allBox.indeterminate=n>0&&n<list.length;
  }

  container.addEventListener('change',e=>{
    const box=e.target.closest('[data-pick]');
    if(!box)return;
    if(box.checked)bulk.ids.add(box.dataset.pick);else bulk.ids.delete(box.dataset.pick);
    sync();
  });
  /* Select all applies to the rows on screen, so it respects an active search. */
  allBox.onchange=()=>{boxes().forEach(b=>{if(allBox.checked)bulk.ids.add(b.dataset.pick);else bulk.ids.delete(b.dataset.pick)});sync()};
  if(toggle)toggle.onclick=()=>{if(bulk.section===section)bulkReset();else{bulk.section=section;bulk.ids.clear()}sync()};
  document.getElementById('bulkCancel').onclick=()=>{bulkReset();sync()};

  delBtn.onclick=async()=>{
    const ids=boxes().filter(b=>b.checked).map(b=>b.dataset.pick);
    if(!ids.length)return;
    if(!confirm(`Delete ${ids.length} ${noun}${ids.length===1?'':'s'}? This cannot be undone.`))return;
    delBtn.disabled=true;delBtn.textContent='Deleting…';
    try{await remove(ids);bulkReset();await loadAll();renderShell()}
    catch(err){console.error(err);alert(err.message||'Could not delete the selected items.');delBtn.disabled=false;delBtn.textContent='Delete selected'}
  };
  sync();
  return sync;
}

function products(m) {   m.innerHTML = `     <div class="products-page">        <div class="products-page-header">          <div>           <span class="eyebrow">Catalog</span>           <h2>Products</h2>         </div>          <div class="row-actions"><button type="button" id="bulkToggle">Select</button><button type="button" class="danger-btn" id="deleteAllProducts">Delete All Products</button><button type="button" class="primary-btn" id="openAddProduct">+ Add Product</button></div>        </div>         ${bulkBarHtml()}         <div class="panel table-wrap">          <table class="table">            <thead>             <tr>               <th></th>               <th>Product</th>               <th>Original Price</th><th>Interest</th><th>Total Price</th><th>Stock</th>               <th></th>             </tr>           </thead>            <tbody>              ${A.data.products.map(p => `               <tr>                  <td>                   ${bulkCheckboxHtml(p.id)}<img                     class="thumb"                     src="${esc(p.image_url || 'bilihan-logo.png')}"                     alt="${esc(p.name)}"                   >                 </td>                  <td>                   <strong>${esc(p.name)}</strong>                   <br>                    <small>                     ${esc(                       A.data.categories.find(                         c => c.id === p.category_id                       )?.name || ''                     )}                   </small>                 </td>                  <td>${money(p.original_price??p.price)}</td><td>${money(p.interest||0)}</td><td>${money(p.price)}</td><td>${p.stock}                 </td>                  <td>                    <div class="row-actions">                      <button                       onclick="editProduct('${p.id}')"                     >                       Edit                     </button>                      <button                       onclick="moveProduct('${p.id}',-1)"                       title="Move up"                     >                       ↑                     </button>                      <button                       onclick="moveProduct('${p.id}',1)"                       title="Move down"                     >                       ↓                     </button>                      <button                       onclick="deleteProduct('${p.id}')"                     >                       Delete                     </button>                    </div>                  </td>                </tr>             `).join('')}            </tbody>          </table>        </div>      </div>   `;    document.getElementById('openAddProduct').onclick=openAddProductModal;document.getElementById('deleteAllProducts').onclick=deleteAllProducts;
  wireBulk('products',m.querySelector('.products-page'),'product',async ids=>{
    const {error}=await db.from('products').delete().in('id',ids);
    if(error)throw error;
  });
}   function openAddProductModal() {    const categoryOptions = A.data.categories     .map(c => `       <option value="${c.id}">         ${esc(c.name)}       </option>     `)     .join('');     const oldModal =     document.getElementById('addProductModal');    if (oldModal) {     oldModal.remove();   }     document.body.insertAdjacentHTML(     'beforeend',     `     <div       class="admin-modal-backdrop"       id="addProductModal"     >        <div         class="admin-modal"         role="dialog"         aria-modal="true"         aria-labelledby="addProductTitle"       >          <div class="admin-modal-header">            <div>             <span class="eyebrow">               Catalog             </span>              <h2 id="addProductTitle">               Add Product             </h2>           </div>            <button             type="button"             class="admin-modal-close"             id="closeAddProduct"             aria-label="Close"           >             ×           </button>          </div>           <form           id="addProductForm"           class="admin-form"         >            <label>             Product name              <input               name="name"               placeholder="Product name"               required             >           </label>             <label>             Description              <textarea               name="description"               rows="4"               placeholder="Description"               required             ></textarea>           </label>             <label>             Category              <select               name="category_id"               required             >               ${categoryOptions}             </select>           </label>             <div class="edit-product-row">              <label>Original Price<input id="addOriginalPrice" name="original_price" type="number" min="0" step="0.01" placeholder="0.00" required></label><label>Interest<input id="addInterest" name="interest" type="number" min="0" step="0.01" value="0" required></label></div><div class="edit-product-row"><label>Total Price<input id="addTotalPrice" name="price" type="number" readonly></label><label>Stock                <input                 name="stock"                 type="number"                 min="0"                 step="1"                 placeholder="0"                 required               >             </label>            </div>             <label>             Product photo              <input               name="image_file"               type="file"               accept="image/*"             >           </label>             <label>             Image URL              <input               name="image_url"               placeholder="Or paste an image URL"             >           </label>             <label class="edit-available-row">              <input               type="checkbox"               name="is_available"               checked             >              <span>               <strong>Available</strong>                <small>                 Customers can order this product                 while stock is available.               </small>             </span>            </label>             <div class="admin-modal-actions">              <button               type="button"               class="modal-secondary-btn"               id="cancelAddProduct"             >               Cancel             </button>              <button               type="submit"               class="primary-btn"               id="saveAddProduct"             >               Save Product             </button>            </div>          </form>        </div>      </div>     `   );     const modal =     document.getElementById('addProductModal');    const form =     document.getElementById('addProductForm');    const closeButton =     document.getElementById('closeAddProduct');    const cancelButton=document.getElementById('cancelAddProduct');const aop=document.getElementById('addOriginalPrice'),ai=document.getElementById('addInterest'),at=document.getElementById('addTotalPrice');const calc=()=>at.value=(Number(aop.value||0)+Number(ai.value||0)).toFixed(2);aop.oninput=calc;ai.oninput=calc;calc();document.body.classList.add('modal-open');     const closeModal = () => {      modal.remove();      document.body.classList.remove(       'modal-open'     );      document.removeEventListener(       'keydown',       escapeModal     );    };     const escapeModal = e => {      if (e.key === 'Escape') {       closeModal();     }    };     closeButton.onclick = closeModal;    cancelButton.onclick = closeModal;     modal.addEventListener('click', e => {      if (e.target === modal) {       closeModal();     }    });     document.addEventListener(     'keydown',     escapeModal   );     form.onsubmit = async e => {      e.preventDefault();       const saveButton =       document.getElementById(         'saveAddProduct'       );       saveButton.disabled = true;      saveButton.textContent =       'Saving...';       const fd =       new FormData(form);       try {        const file =         fd.get('image_file');         let imageUrl =         String(           fd.get('image_url') || ''         ).trim();         if (file && file.size) {          imageUrl =           await uploadImage(file);        }         const stock =         Number(fd.get('stock'));         const row = {          name:           String(             fd.get('name') || ''           ).trim(),          description:           String(             fd.get('description') || ''           ).trim(),          category_id:fd.get('category_id'),original_price:Number(fd.get('original_price')||0),interest:Number(fd.get('interest')||0),price:Number(fd.get('original_price')||0)+Number(fd.get('interest')||0),          stock:           stock,          is_available:           fd.get('is_available') === 'on' &&           stock > 0,          image_url:           imageUrl || null,          sort_order:           A.data.products.length + 1        };         const { error } =         await db           .from('products')           .insert(row);         if (error) {         throw error;       }         await loadAll();        closeModal();        renderShell();       } catch (err) {        console.error(err);        alert(         'Unable to add product: ' +         err.message       );         saveButton.disabled = false;        saveButton.textContent =         'Save Product';      }    };  }
window.editProduct = id => {   const p = A.data.products.find(x => x.id === id);    if (!p) {     alert('Product not found.');     return;   }    const categoryOptions = A.data.categories     .map(c => `       <option         value="${c.id}"         ${c.id === p.category_id ? 'selected' : ''}       >         ${esc(c.name)}       </option>     `)     .join('');    const oldModal = document.getElementById('editProductModal');    if (oldModal) {     oldModal.remove();   }    document.body.insertAdjacentHTML(     'beforeend',     `     <div class="admin-modal-backdrop" id="editProductModal">        <div         class="admin-modal"         role="dialog"         aria-modal="true"         aria-labelledby="editProductTitle"       >          <div class="admin-modal-header">            <div>             <span class="eyebrow">Product editor</span>             <h2 id="editProductTitle">Edit Product</h2>           </div>            <button             type="button"             class="admin-modal-close"             id="closeEditProduct"             aria-label="Close"           >             ×           </button>          </div>          <form id="editProductForm" class="admin-form">            <div class="edit-product-image-area">              <img               id="editProductPreview"               src="${esc(p.image_url || 'bilihan-logo.png')}"               alt="${esc(p.name)}"             >              <div>               <strong>Product photo</strong>               <p class="muted">                 Upload a new photo or keep the current image.               </p>             </div>            </div>            <label>             Product name              <input               name="name"               value="${esc(p.name)}"               required             >           </label>            <label>             Description              <textarea               name="description"               rows="4"               required             >${esc(p.description || '')}</textarea>           </label>            <label>             Category              <select name="category_id" required>               ${categoryOptions}             </select>           </label>            <div class="edit-product-row">              <label>Original Price<input id="editOriginalPrice" name="original_price" type="number" min="0" step="0.01" value="${Number(p.original_price??p.price??0)}" required></label><label>Interest<input id="editInterest" name="interest" type="number" min="0" step="0.01" value="${Number(p.interest||0)}" required></label></div><div class="edit-product-row"><label>Total Price<input id="editTotalPrice" name="price" type="number" value="${Number(p.price||0)}" readonly></label><label>Stock                <input                 name="stock"                 type="number"                 min="0"                 step="1"                 value="${Number(p.stock || 0)}"                 required               >             </label>            </div>            <label>             Upload new product photo              <input               name="image_file"               id="editProductFile"               type="file"               accept="image/*"             >           </label>            <label>             Image URL              <input               name="image_url"               value="${esc(p.image_url || '')}"               placeholder="Or paste an image URL"             >           </label>            <label class="edit-available-row">              <input               type="checkbox"               name="is_available"               ${p.is_available ? 'checked' : ''}             >              <span>               <strong>Available</strong>                <small>                 Customers can order this product while stock is available.               </small>             </span>            </label>            <div class="admin-modal-actions">              <button               type="button"               class="modal-secondary-btn"               id="cancelEditProduct"             >               Cancel             </button>              <button               type="submit"               class="primary-btn"               id="saveEditProduct"             >               Save Changes             </button>            </div>          </form>        </div>      </div>     `   );    const modal = document.getElementById('editProductModal');   const form = document.getElementById('editProductForm');   const closeButton = document.getElementById('closeEditProduct');   const cancelButton = document.getElementById('cancelEditProduct');   const fileInput = document.getElementById('editProductFile');   const preview=document.getElementById('editProductPreview');const eop=document.getElementById('editOriginalPrice'),ei=document.getElementById('editInterest'),et=document.getElementById('editTotalPrice');const calcEdit=()=>et.value=(Number(eop.value||0)+Number(ei.value||0)).toFixed(2);eop.oninput=calcEdit;ei.oninput=calcEdit;calcEdit();document.body.classList.add('modal-open');    const closeModal = () => {     modal.remove();     document.body.classList.remove('modal-open');     document.removeEventListener('keydown', escapeModal);   };    closeButton.onclick = closeModal;   cancelButton.onclick = closeModal;    modal.addEventListener('click', e => {     if (e.target === modal) {       closeModal();     }   });    const escapeModal = e => {     if (e.key === 'Escape') {       closeModal();     }   };    document.addEventListener('keydown', escapeModal);    fileInput.onchange = () => {     const file = fileInput.files[0];      if (!file) {       return;     }      const temporaryUrl = URL.createObjectURL(file);      preview.src = temporaryUrl;   };    form.onsubmit = async e => {     e.preventDefault();      const saveButton = document.getElementById('saveEditProduct');      saveButton.disabled = true;     saveButton.textContent = 'Saving...';      const fd = new FormData(form);      try {       const file = fd.get('image_file');        let imageUrl = String(         fd.get('image_url') || ''       ).trim();        /*        * If you selected a new product photo,        * upload it to your existing Supabase        * product-images bucket.        */       if (file && file.size) {         imageUrl = await uploadImage(file);       }        /*        * If no new photo or URL was entered,        * keep the product's existing photo.        */       if (!imageUrl) {         imageUrl = p.image_url || null;       }        const stock = Number(fd.get('stock'));        const updatedProduct = {         name: String(           fd.get('name') || ''         ).trim(),          description: String(           fd.get('description') || ''         ).trim(),          category_id:fd.get('category_id'),original_price:Number(fd.get('original_price')||0),interest:Number(fd.get('interest')||0),price:Number(fd.get('original_price')||0)+Number(fd.get('interest')||0),          stock: stock,          image_url: imageUrl,          is_available:           fd.get('is_available') === 'on' &&           stock > 0       };        const { error } = await db         .from('products')         .update(updatedProduct)         .eq('id', id);        if (error) {         throw error;       }        await loadAll();        closeModal();        renderShell();      } catch (err) {       console.error(err);        alert(         'Unable to update product: ' +         err.message       );        saveButton.disabled = false;       saveButton.textContent = 'Save Changes';     }   }; };
window.deleteProduct=async id=>{if(!confirm('Delete this product?'))return;const {error}=await db.from('products').delete().eq('id',id);if(error)return alert(error.message);await loadAll();renderShell()};async function deleteAllProducts(){if(!A.data.products.length)return alert('There are no products to delete.');if(!confirm(`Delete ALL ${A.data.products.length} products? This cannot be undone.`))return;if(prompt('Type DELETE ALL PRODUCTS to confirm:')!=='DELETE ALL PRODUCTS')return alert('Delete All cancelled.');const {error}=await db.from('products').delete().in('id',A.data.products.map(p=>p.id));if(error)return alert(error.message);await loadAll();renderShell();alert('All products have been deleted.');}
window.moveProduct=async(id,d)=>{const s=[...A.data.products].sort((a,b)=>a.sort_order-b.sort_order),i=s.findIndex(p=>p.id===id),j=i+d;if(j<0||j>=s.length)return;const a=s[i],b=s[j];const {error:e1}=await db.from('products').update({sort_order:b.sort_order}).eq('id',a.id);const {error:e2}=await db.from('products').update({sort_order:a.sort_order}).eq('id',b.id);if(e1||e2)return alert((e1||e2).message);await loadAll();renderShell()};
function categories(m){m.innerHTML=`<span class="eyebrow">Menu structure</span><h2>Categories</h2><div class="admin-grid"><div class="panel">${A.data.categories.map(c=>`<div class="summary-row"><strong>${esc(c.name)}</strong><div class="row-actions"><button onclick="renameCategory('${c.id}')">Rename</button><button onclick="moveCategory('${c.id}',-1)">↑</button><button onclick="moveCategory('${c.id}',1)">↓</button><button onclick="deleteCategory('${c.id}')">Delete</button></div></div>`).join('')}</div><form id="catForm" class="panel admin-form"><input name="name" placeholder="New category name" required><button class="primary-btn">Add Category</button></form></div>`;document.getElementById('catForm').onsubmit=async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');const {error}=await db.from('categories').insert({name,sort_order:A.data.categories.length+1});if(error)return alert(error.message);await loadAll();renderShell()}}
window.renameCategory=async id=>{const c=A.data.categories.find(x=>x.id===id),n=prompt('Category name',c.name);if(!n)return;const {error}=await db.from('categories').update({name:n}).eq('id',id);if(error)return alert(error.message);await loadAll();renderShell()};window.deleteCategory=async id=>{if(A.data.products.some(p=>p.category_id===id))return alert('Move or delete products in this category first.');if(!confirm('Delete category?'))return;const {error}=await db.from('categories').delete().eq('id',id);if(error)return alert(error.message);await loadAll();renderShell()};window.moveCategory=async(id,d)=>{const s=[...A.data.categories].sort((a,b)=>a.sort_order-b.sort_order),i=s.findIndex(c=>c.id===id),j=i+d;if(j<0||j>=s.length)return;const a=s[i],b=s[j];await db.from('categories').update({sort_order:b.sort_order}).eq('id',a.id);await db.from('categories').update({sort_order:a.sort_order}).eq('id',b.id);await loadAll();renderShell()};
const PAY_COLORS={Paid:{bg:'#dcfce7',text:'#166534',border:'#86efac'},Pending:{bg:'#fef9c3',text:'#854d0e',border:'#fde047'},'Not Paid':{bg:'#fee2e2',text:'#991b1b',border:'#fca5a5'}};
function paySelectHtml(o){const st=o.payment_status||'Pending';const c=PAY_COLORS[st]||PAY_COLORS.Pending;return `<select onchange="updatePaymentStatus('${o.id}',this.value)" style="font-weight:700;padding:4px 8px;border-radius:8px;border:1px solid ${c.border};background:${c.bg};color:${c.text};cursor:pointer">${Object.keys(PAY_COLORS).map(k=>`<option value="${k}" ${k===st?'selected':''}>${k}</option>`).join('')}</select>`}
/* The orders table shows only what you scan for. Everything else lives here,
   opened by clicking an order number. */
/* Receipts live in Google Drive, not in Supabase: app.js uploads them through the
   Apps Script with mode:'no-cors', so the browser never gets to read the Drive URL
   back. receipt_url is honoured first in case a future upload path does store one;
   otherwise we hand the order code to the Apps Script, which looks the file up and
   redirects. Drive's own permissions decide who is allowed to see it. */
function receiptUrlFor(order){
  if(!order)return '';
  if(order.receipt_url)return String(order.receipt_url);
  if(order.payment_method!=='QR Payment')return '';
  if(!GOOGLE_SHEETS_WEB_APP_URL)return '';
  return GOOGLE_SHEETS_WEB_APP_URL+'?action=receipt&order_code='+encodeURIComponent(order.order_code||'');
}
function openOrderDetails(id){
  const o=(A.data.orders||[]).find(x=>x.id===id);
  if(!o){alert('That order is no longer available. Refresh the page.');return}
  const field=(label,value)=>value===''||value===null||value===undefined?'':`<dt>${esc(label)}</dt><dd>${esc(String(value))}</dd>`;
  const items=(o.order_items||[]);
  const itemRows=items.map(i=>`<tr><td>${esc(i.product_name)}</td><td>${i.qty}</td><td>${money(i.unit_price)}</td><td><strong>${money(Number(i.unit_price||0)*Number(i.qty||0))}</strong></td></tr>`).join('');
  const receiptHref=receiptUrlFor(o);
  document.getElementById('orderDetailModal')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div class="admin-modal-backdrop" id="orderDetailModal"><div class="admin-modal admin-modal-wide" role="dialog" aria-modal="true" aria-labelledby="orderDetailTitle"><div class="admin-modal-header"><div><span class="eyebrow">Customer order</span><h2 id="orderDetailTitle">#${esc(o.order_code)}${o.status==='Cancelled'?' <span class="order-cancelled-tag">Cancelled</span>':''}</h2></div><button type="button" class="admin-modal-close" id="closeOrderDetail" aria-label="Close">&times;</button></div>
  <dl class="order-detail">
    ${field('Placed',new Date(o.created_at).toLocaleString())}
    ${field('Customer',o.customer_name)}
    ${field('Phone',o.phone||'—')}
    ${field('Fulfillment',o.fulfillment)}
    ${o.fulfillment==='Delivery'?field('Address',o.address||'—'):''}
    ${field('Preferred date',o.preferred_date)}
    ${field('Payment method',o.payment_method)}
    ${field('Payment status',o.payment_status||'Pending')}
    ${field('Order status',o.status)}
    ${o.cancellation_reason?field('Cancellation reason',o.cancellation_reason):''}
    ${o.cancelled_at?field('Cancelled at',new Date(o.cancelled_at).toLocaleString()):''}
    ${o.note?field('Customer note',o.note):''}
  </dl>
  ${receiptHref?`<p class="order-receipt-row"><a class="modal-secondary-btn" id="viewReceipt" href="${esc(receiptHref)}" target="_blank" rel="noopener noreferrer">View payment receipt</a><span class="muted">Opens the customer's uploaded receipt in a new tab.</span></p>`:''}
  ${items.length?`<div class="table-wrap" style="margin-top:18px"><table class="table orders-items-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>${itemRows}</tbody><tfoot><tr><td><strong>Total</strong></td><td><strong>${items.reduce((n,i)=>n+Number(i.qty||0),0)}</strong></td><td></td><td><strong>${money(o.total)}</strong></td></tr></tfoot></table></div>`:'<p class="muted" style="margin-top:18px">This order has no line items recorded.</p>'}
  </div></div>`);
  document.body.classList.add('modal-open');
  const modal=document.getElementById('orderDetailModal');
  const onKey=e=>{if(e.key==='Escape')close()};
  function close(){modal.remove();document.body.classList.remove('modal-open');document.removeEventListener('keydown',onKey);document.querySelector(`[data-order="${CSS.escape(id)}"]`)?.focus()}
  document.getElementById('closeOrderDetail').onclick=close;
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',onKey);
  document.getElementById('closeOrderDetail').focus();
}

function orders(m){
  const totals=A.data.orders.reduce((acc,o)=>{const st=o.payment_status||'Pending';acc.sell+=+o.total;if(st==='Paid')acc.paid+=+o.total;else acc.unpaid+=+o.total;(o.order_items||[]).forEach(i=>{const q=Number(i.qty||0);const {original,interest}=lineItemPrices(i);acc.original+=original*q;acc.interest+=interest*q});return acc},{sell:0,paid:0,unpaid:0,original:0,interest:0});
  m.innerHTML=`<div class="page-head"><div><span class="eyebrow">Customer orders</span><h2>Orders</h2></div><div class="row-actions"><button type="button" id="bulkToggle">Select</button><button type="button" class="danger-btn" id="deleteAllOrders">Delete All Orders</button></div></div><div class="cards orders-cards"><div class="metric metric-money"><small>Total Sell</small><h2>${money(totals.sell)}</h2></div><div class="metric metric-money" style="border-color:#86efac"><small>Total Paid</small><h2 style="color:#166534">${money(totals.paid)}</h2></div><div class="metric metric-money" style="border-color:#fca5a5"><small>Total Unpaid</small><h2 style="color:#991b1b">${money(totals.unpaid)}</h2></div><div class="metric metric-money"><small>Total Interest</small><h2>${money(totals.interest)}</h2></div><div class="metric metric-money"><small>Total Original Price</small><h2>${money(totals.original)}</h2></div></div>
  <div class="panel"><input id="orderSearch" placeholder="Search name, phone, order number" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text)">
  <div id="payFilters" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${['all','Paid','Pending','Not Paid'].map(f=>{const active=A.orderFilter===f;const c=f==='all'?null:PAY_COLORS[f];const bg=active?(c?c.bg:'var(--text)'):'transparent';const text=active?(c?c.text:'var(--bg)'):'var(--text)';const border=c?c.border:'var(--line)';return `<button data-f="${f}" style="padding:6px 14px;border-radius:999px;border:1px solid ${border};background:${bg};color:${text};font-weight:600;cursor:pointer">${f==='all'?'All':f}</button>`}).join('')}</div>
  </div>
  ${bulkBarHtml()}
  <div id="orderList" class="panel table-wrap"></div>`;
  document.querySelectorAll('#payFilters button').forEach(b=>b.onclick=()=>{A.orderFilter=b.dataset.f;orders(m)});document.getElementById('deleteAllOrders').onclick=deleteAllOrders;
  const draw=()=>{
    const t=document.getElementById('orderSearch').value.toLowerCase();
    const rows=A.data.orders.filter(o=>{
      const matchesSearch=`${o.order_code} ${o.customer_name} ${o.phone||''}`.toLowerCase().includes(t);
      const matchesFilter=A.orderFilter==='all'||((o.payment_status||'Pending')===A.orderFilter);
      return matchesSearch&&matchesFilter;
    });
    const list=document.getElementById('orderList');
    list.innerHTML=rows.length?`<table class="table orders-table"><thead><tr><th>Order #</th><th>Payment Status</th><th>Customer</th><th><span class="sr-only">Delete</span></th></tr></thead><tbody>${rows.map(o=>`<tr><td>${bulkCheckboxHtml(o.id)}<button type="button" class="order-code-btn" data-order="${esc(o.id)}" title="View full order details">#${esc(o.order_code)}</button>${o.status==='Cancelled'?'<span class="order-cancelled-tag">Cancelled</span>':''}</td><td>${paySelectHtml(o)}</td><td>${esc(o.customer_name)}</td><td><button type="button" class="icon-delete-btn" data-delete="${esc(o.id)}" title="Delete order" aria-label="Delete order #${esc(o.order_code)}"></button></td></tr>`).join('')}</tbody></table>`:'<p style="padding:20px">No orders match this filter.</p>';
    list.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>openOrderDetails(b.dataset.order));
    list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteOrder(b.dataset.delete));
  };
  const syncBulk=wireBulk('orders',document.getElementById('orderList'),'order',async ids=>{
    const codes=ids.map(id=>A.data.orders.find(o=>o.id===id)?.order_code).filter(Boolean);
    const {error}=await db.from('orders').delete().in('id',ids);
    if(error)throw error;
    for(const code of codes)await deleteOrderFromGoogleSheet(code);
  });
  document.getElementById('orderSearch').oninput=()=>{draw();syncBulk()};
  draw();syncBulk();
}
async function syncAdminOrderToGoogleSheet(order){try{if(!GOOGLE_SHEETS_WEB_APP_URL||!order)return;const items=(order.order_items||order.items||[]).map(i=>`${i.product_name} x ${i.qty}`).join(', ');const payload={order_id:order.id||order.order_id||order.order_code,order_code:order.order_code||'',order_date:order.created_at||new Date().toISOString(),customer_name:order.customer_name||'',phone:order.phone||'',fulfillment:order.fulfillment||'',address:order.address||'',preferred_date:order.preferred_date||'',payment_method:order.payment_method||'',items:items,subtotal:Number(order.subtotal??order.total??0),delivery_fee:Number(order.delivery_fee||0),total:Number(order.total||0),payment_status:order.payment_status||'Pending',order_status:order.status||'Pending',cancellation_reason:order.cancellation_reason||''};await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)})}catch(err){console.warn('Google Sheets admin sync failed:',err)}}
window.updatePaymentStatus=async(id,status)=>{const {error}=await db.from('orders').update({payment_status:status}).eq('id',id);if(error)return alert(error.message);const o=A.data.orders.find(x=>x.id===id);if(o){o.payment_status=status;await syncAdminOrderToGoogleSheet(o)}orders(document.getElementById('adminMain'))};
async function deleteOrderFromGoogleSheet(orderCode){try{if(!GOOGLE_SHEETS_WEB_APP_URL||!orderCode)return;await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'delete_order',order_code:orderCode})})}catch(err){console.warn('Google Sheets/Drive delete sync failed:',err)}}
async function deleteAllOrdersFromGoogleServices(){try{if(!GOOGLE_SHEETS_WEB_APP_URL)return;await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'delete_all_orders'})})}catch(err){console.warn('Google Sheets/Drive bulk delete sync failed:',err)}}
window.deleteOrder=async id=>{const o=A.data.orders.find(x=>x.id===id);if(!o)return alert('Order not found.');if(!confirm(`Delete Order #${o.order_code} permanently? This will also delete its Google Sheet row and matching payment receipt from Google Drive.`))return;const {error}=await db.from('orders').delete().eq('id',id);if(error)return alert(error.message);await deleteOrderFromGoogleSheet(o.order_code);await loadAll();renderShell()};async function deleteAllOrders(){if(!A.data.orders.length)return alert('There are no orders to delete.');if(!confirm(`Delete ALL ${A.data.orders.length} customer orders? This cannot be undone. It will also remove all matching Google Sheet rows and payment receipt files from Google Drive.`))return;if(prompt('Type DELETE ALL ORDERS to confirm:')!=='DELETE ALL ORDERS')return alert('Delete All cancelled.');const ids=A.data.orders.map(o=>o.id);const {error}=await db.from('orders').delete().in('id',ids);if(error)return alert(error.message);await deleteAllOrdersFromGoogleServices();A.orderFilter='all';await loadAll();renderShell();alert('All customer orders, matching Google Sheet rows, and matching Google Drive receipts have been deleted.');}
/* ---- Customer messages -----------------------------------------------------
   One thread per customer, so several orders from the same person stay in a
   single conversation. Threads arrive with loadAll(); the messages of the open
   thread are fetched on demand and polled while this section is on screen. */
function adminUnreadTotal(){return (A.data.threads||[]).reduce((n,t)=>n+Number(t.admin_unread||0),0)}
const MSG={openId:null,messages:[],timer:null,loading:false,sync:null};

function stopMessagePolling(){clearInterval(MSG.timer);MSG.timer=null;MSG.sync=null}

async function loadThreadMessages(id,{silent}={}){
  if(!id)return;
  if(!silent)MSG.loading=true;
  const {data,error}=await db.from('support_messages').select('*').eq('thread_id',id).order('created_at');
  if(error){console.warn('Bilihan admin: could not load messages',error);MSG.loading=false;return}
  MSG.messages=data||[];MSG.loading=false;
  paintThread();
}

async function openThread(id){
  if(MSG.openId===id)return;
  MSG.openId=id;MSG.messages=[];
  paintThread();
  await loadThreadMessages(id);
  const thread=(A.data.threads||[]).find(t=>t.id===id);
  if(thread&&thread.admin_unread>0){
    const {error}=await db.rpc('support_admin_mark_read',{p_thread_id:id});
    if(!error){thread.admin_unread=0;paintThreadList();paintNavBadge()}
  }
}

function paintNavBadge(){
  const btn=document.querySelector('.side-nav button[data-s="messages"]');
  if(!btn)return;
  const n=adminUnreadTotal();
  const existing=btn.querySelector('.nav-badge');
  if(!n){existing?.remove();return}
  if(existing)existing.textContent=n>99?'99+':n;
  else btn.insertAdjacentHTML('beforeend',`<span class="nav-badge">${n>99?'99+':n}</span>`);
}

function threadRowHtml(t){
  const when=new Date(t.last_message_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  /* The checkbox sits beside the row button rather than inside it: a button may
     not contain another interactive control. */
  return `<div class="thread-item${MSG.openId===t.id?' active':''}">${bulkCheckboxHtml(t.id)}<button type="button" class="thread-row" data-thread="${esc(t.id)}">
    <span class="thread-row-top"><strong>${esc(t.customer_name||'Customer')}</strong>${t.admin_unread?`<span class="thread-unread">${t.admin_unread}</span>`:''}</span>
    <span class="thread-row-sub">${esc(t.phone||'No phone on file')} · ${esc(when)}</span></button></div>`;
}

function paintThreadList(){
  const list=document.getElementById('threadList');
  if(!list)return;
  const threads=A.data.threads||[];
  list.innerHTML=threads.length?threads.map(threadRowHtml).join(''):'<p class="muted" style="padding:14px">No customer messages yet.</p>';
  list.querySelectorAll('[data-thread]').forEach(b=>b.onclick=()=>openThread(b.dataset.thread));
  MSG.sync?.();
}

function paintThread(){
  const host=document.getElementById('threadView');
  if(!host)return;
  const thread=(A.data.threads||[]).find(t=>t.id===MSG.openId);
  if(!thread){host.innerHTML='<div class="thread-empty"><p class="muted">Pick a conversation on the left to read it and reply.</p></div>';return}
  const log=MSG.loading&&!MSG.messages.length
    ?'<p class="muted" style="padding:14px">Loading…</p>'
    :(MSG.messages.length?MSG.messages.map(m=>{
        const when=new Date(m.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
        return `<div class="admin-msg admin-msg-${m.sender==='admin'?'out':'in'}"><p>${esc(m.body)}</p><time>${esc(when)}</time></div>`;
      }).join(''):'<p class="muted" style="padding:14px">No messages in this conversation yet.</p>');
  const atBottom=(()=>{const l=host.querySelector('.thread-log');return !l||l.scrollHeight-l.scrollTop-l.clientHeight<40})();
  host.innerHTML=`<div class="thread-head"><div><strong>${esc(thread.customer_name||'Customer')}</strong><span class="thread-row-sub">${esc(thread.phone||'No phone on file')}</span></div></div>
    <div class="thread-log">${log}</div>
    <form class="thread-compose" id="threadCompose"><label class="sr-only" for="threadInput">Reply</label>
      <textarea id="threadInput" rows="1" maxlength="2000" placeholder="Write a reply…"></textarea>
      <button class="primary-btn" type="submit">Send</button></form>`;
  const logEl=host.querySelector('.thread-log');
  if(logEl&&atBottom)logEl.scrollTop=logEl.scrollHeight;
  const form=document.getElementById('threadCompose');
  const input=document.getElementById('threadInput');
  const grow=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'};
  input.addEventListener('input',grow);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
  form.onsubmit=async e=>{
    e.preventDefault();
    const body=input.value.trim();
    if(!body)return;
    input.value='';grow();
    MSG.messages=[...MSG.messages,{id:'local-'+Date.now(),sender:'admin',body,created_at:new Date().toISOString()}];
    paintThread();
    const {data,error}=await db.rpc('support_admin_reply',{p_thread_id:MSG.openId,p_body:body});
    if(error||!data?.ok){alert(error?.message||data?.error||'Reply not sent.');}
    await loadThreadMessages(MSG.openId,{silent:true});
  };
  input.focus();
}

async function refreshThreads(){
  const {data,error}=await db.from('support_threads').select('*').order('last_message_at',{ascending:false});
  if(error)return;
  A.data.threads=data||[];
  paintThreadList();paintNavBadge();
  if(MSG.openId)await loadThreadMessages(MSG.openId,{silent:true});
}

async function removeThreads(ids){
  /* support_messages has on delete cascade, so removing the threads clears their
     messages from the database in the same statement. */
  const {error}=await db.from('support_threads').delete().in('id',ids);
  if(error)throw error;
  if(ids.includes(MSG.openId)){MSG.openId=null;MSG.messages=[]}
}

async function deleteAllThreads(){
  const threads=A.data.threads||[];
  if(!threads.length)return alert('There are no conversations to delete.');
  if(!confirm(`Delete ALL ${threads.length} conversation${threads.length===1?'':'s'} and every message in them? This cannot be undone.`))return;
  if(prompt('Type DELETE ALL MESSAGES to confirm:')!=='DELETE ALL MESSAGES')return alert('Delete All cancelled.');
  try{
    await removeThreads(threads.map(t=>t.id));
    bulkReset();await loadAll();renderShell();
    alert('All conversations and their messages have been deleted.');
  }catch(err){console.error(err);alert(err.message||'Could not delete the conversations.')}
}

function messages(m){
  m.innerHTML=`<div class="page-head"><div><span class="eyebrow">Support</span><h2>Messages</h2></div>
      <div class="row-actions"><button type="button" id="bulkToggle">Select</button><button type="button" class="danger-btn" id="deleteAllThreads">Delete All Messages</button></div></div>
    ${bulkBarHtml()}
    <div class="thread-layout"><div class="panel thread-list" id="threadList"></div><div class="panel thread-view" id="threadView"></div></div>`;
  paintThreadList();paintThread();
  document.getElementById('deleteAllThreads').onclick=deleteAllThreads;
  MSG.sync=wireBulk('messages',document.getElementById('threadList'),'conversation',removeThreads);
  stopMessagePolling();
  MSG.timer=setInterval(()=>{if(!document.hidden&&A.section==='messages')refreshThreads()},12000);
}

function settings(m){
  const s=A.data.settings;

  m.innerHTML=`
    <span class="eyebrow">Business info</span>
    <h2>Store Settings</h2>

    <form id="settingsForm" class="panel admin-form">

      <section class="form-section">
        <h3>Contact details</h3>
        <p class="muted form-hint">Shown in your storefront footer. Leave a field blank to hide it from customers.</p>

        <div class="form-row">
          <label>Business name<input name="business_name" value="${esc(s.business_name||'')}"></label>
          <label>Contact number<input name="phone" type="tel" inputmode="tel" value="${esc(s.phone||'')}" placeholder="09XXXXXXXXX"></label>
        </div>

        <div class="form-row">
          <label>Contact email<input name="email" type="email" value="${esc(s.email||'')}" placeholder="hello@bilihan.shop"></label>
          <label>Messenger link<input name="messenger_url" type="url" value="${esc(s.messenger_url||'')}" placeholder="https://m.me/yourpage"></label>
        </div>

        <div class="form-row">
          <label>Instagram link<input name="instagram_url" type="url" value="${esc(s.instagram_url||'')}" placeholder="https://instagram.com/yourhandle"></label>
        </div>

        <label>Pickup location<textarea name="pickup_location">${esc(s.pickup_location||'')}</textarea></label>
      </section>

      <section class="form-section">
        <h3>Ordering</h3>

        <label class="check-row"><input type="checkbox" name="show_delivery_address" ${s.show_delivery_address===true?'checked':''}> Show delivery option and delivery address</label>
        <label class="check-row"><input type="checkbox" name="show_preferred_date" ${s.show_preferred_date===true?'checked':''}> Show preferred date</label>
        <label class="check-row"><input type="checkbox" name="show_stock" ${s.show_stock===true?'checked':''}> Show available stock on the customer page</label>

        <div class="form-row">
          <label>Preferred date mode
            <select name="preferred_date_mode" id="preferredDateMode">
              <option value="calendar" ${(s.preferred_date_mode||'calendar')==='calendar'?'selected':''}>Customer chooses date</option>
              <option value="fixed" ${s.preferred_date_mode==='fixed'?'selected':''}>Fixed date</option>
            </select>
          </label>

          <label id="orderAvailableDateLabel">
            <span id="orderAvailableDateText">${(s.preferred_date_mode||'calendar')==='fixed'?'Fixed preferred date':'Orders available from'}</span>
            <input name="order_available_from" type="date" value="${esc(s.order_available_from||'')}">
          </label>
        </div>
      </section>

      <section class="form-section">
        <h3>Payment methods</h3>

        <label class="check-row"><input type="checkbox" name="show_qr_payment" ${s.show_qr_payment===true?'checked':''}> Show QR Payment</label>
        <label class="check-row"><input type="checkbox" name="show_cash_payment" ${s.show_cash_payment===true?'checked':''}> Show Cash</label>

        <div class="form-row">
          <label>QR image<input name="qr_file" type="file" accept="image/*"></label>
          <label>Or QR image URL<input name="qr_image_url" value="${esc(s.qr_image_url||'')}" placeholder="https://..."></label>
        </div>
      </section>

      <button class="primary-btn">Save Settings</button>

    </form>
  `;

  const form=document.getElementById('settingsForm');
  const modeSelect=document.getElementById('preferredDateMode');
  const dateText=document.getElementById('orderAvailableDateText');

  function updateDateLabel(){
    dateText.textContent=
      modeSelect.value==='fixed'
        ?'Fixed preferred date'
        :'Orders available from';
  }

  modeSelect.onchange=updateDateLabel;
  updateDateLabel();

  form.onsubmit=async e=>{
    e.preventDefault();

    const fd=new FormData(e.currentTarget);

    const showQr=
      fd.get('show_qr_payment')==='on';

    const showCash=
      fd.get('show_cash_payment')==='on';

    if(!showQr&&!showCash){
      alert('Please keep at least one payment method enabled: QR Payment or Cash.');
      return;
    }

    let qr=
      String(fd.get('qr_image_url')||'').trim();

    const file=
      fd.get('qr_file');

    try{
      if(file&&file.size){
        qr=await uploadImage(file,'store-assets');
      }

      const row={
        business_name:
          fd.get('business_name'),

        phone:
          String(fd.get('phone')||'').trim(),

        email:
          String(fd.get('email')||'').trim()||null,

        messenger_url:
          String(fd.get('messenger_url')||'').trim(),

        instagram_url:
          String(fd.get('instagram_url')||'').trim(),

        pickup_location:
          fd.get('pickup_location'),

        show_delivery_address:
          fd.get('show_delivery_address')==='on',

        show_preferred_date:
          fd.get('show_preferred_date')==='on',

        preferred_date_mode:
          fd.get('preferred_date_mode')||'calendar',

        order_available_from:
          fd.get('order_available_from')||null,

        show_stock:
          fd.get('show_stock')==='on',

        show_qr_payment:
          showQr,

        show_cash_payment:
          showCash,

        qr_image_url:
          qr
      };

      const {error}=await db
        .from('store_settings')
        .update(row)
        .eq('id',1);

      if(error)throw error;

      await loadAll();

      alert('Settings saved.');

      renderShell();

    }catch(err){
      console.error(err);
      alert(err.message);
    }
  };
}

/* ---- Capacity and latency (Security tab) ------------------------------------
   Sizes come from admin_usage(), which reads pg_database_size and the storage
   objects table, so the numbers are the real ones rather than an estimate.
   Plan limits are not readable from the browser, so they come from config.js. */
const LIMITS=Object.assign({plan_label:'Supabase Free',database_mb:500,storage_mb:1024},(window.BILIHAN_CONFIG||{}).USAGE_LIMITS||{});
const USAGE={data:null,latency:null,loading:false};

function fmtBytes(n){
  const b=Number(n||0);
  if(b<1024)return b+' B';
  if(b<1048576)return (b/1024).toFixed(1)+' KB';
  if(b<1073741824)return (b/1048576).toFixed(1)+' MB';
  return (b/1073741824).toFixed(2)+' GB';
}
function meterHtml(label,used,limitBytes,hint){
  const pct=limitBytes?Math.min(100,(used/limitBytes)*100):0;
  const level=pct>=90?'danger':pct>=70?'warn':'ok';
  return `<div class="usage-meter usage-${level}">
    <div class="usage-meter-top"><strong>${esc(label)}</strong><span>${esc(fmtBytes(used))} of ${esc(fmtBytes(limitBytes))} · ${pct.toFixed(1)}%</span></div>
    <div class="usage-bar"><span style="width:${pct.toFixed(2)}%"></span></div>
    ${hint?`<p class="usage-hint">${esc(hint)}</p>`:''}</div>`;
}

/* Median of a few round trips, so one slow sample does not define the number. */
async function timeCall(fn,samples=3){
  const runs=[];
  for(let i=0;i<samples;i++){
    const t0=performance.now();
    try{await fn()}catch{ return null }
    runs.push(performance.now()-t0);
  }
  runs.sort((a,b)=>a-b);
  return Math.round(runs[Math.floor(runs.length/2)]);
}
async function measureLatency(){
  const database=await timeCall(()=>db.rpc('is_admin'));
  const storage=await timeCall(()=>db.storage.from('product-images').list('',{limit:1}),2);
  let sheet=null;
  if(GOOGLE_SHEETS_WEB_APP_URL){
    sheet=await timeCall(()=>fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'ping'})}),1);
  }
  return {database,storage,sheet};
}
function latencyRow(label,ms,note){
  if(ms===null||ms===undefined)return `<tr><td>${esc(label)}</td><td>—</td><td><span class="usage-pill">unreachable</span></td></tr>`;
  const level=ms<250?'ok':ms<700?'warn':'danger';
  const word=ms<250?'fast':ms<700?'ok':'slow';
  return `<tr><td>${esc(label)}${note?`<br><small class="muted">${esc(note)}</small>`:''}</td><td><strong>${ms<1?'<1':ms} ms</strong></td><td><span class="usage-pill usage-${level}">${word}</span></td></tr>`;
}

async function loadUsage(){
  USAGE.loading=true;
  try{
    const [{data,error},latency]=await Promise.all([db.rpc('admin_usage'),measureLatency()]);
    USAGE.latency=latency;
    if(error)throw error;
    USAGE.data=data?.ok?data:{error:data?.error||'Usage is unavailable.'};
  }catch(err){
    console.error('Bilihan admin: usage unavailable',err);
    USAGE.data={error:/could not find the function|does not exist/i.test(err?.message||'')
      ? 'Usage reporting is not installed yet. Run supabase-setup.sql in Supabase.'
      : (err?.message||'Usage is unavailable.')};
  }finally{
    USAGE.loading=false;
    if(A.section==='security')paintUsage();
  }
}

function paintUsage(){
  const host=document.getElementById('usagePanels');
  if(!host)return;
  if(USAGE.loading&&!USAGE.data){host.innerHTML='<p class="muted">Measuring…</p>';return}
  const u=USAGE.data;
  const lat=USAGE.latency||{};
  const latencyBlock=`<div class="panel"><h3>Response time</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Service</th><th>Round trip</th><th></th></tr></thead><tbody>
      ${latencyRow('Supabase database',lat.database)}
      ${latencyRow('Supabase file storage',lat.storage)}
      ${GOOGLE_SHEETS_WEB_APP_URL?latencyRow('Google Apps Script',lat.sheet,'approximate: the browser cannot read this response'):''}
    </tbody></table></div>
    <p class="usage-hint">Median of repeated calls from this device, so it reflects your connection as well as the service.</p></div>`;

  if(!u||u.error){
    host.innerHTML=`<div class="panel"><h3>Storage</h3><div class="status-banner">${esc(u?.error||'Usage is unavailable.')}</div></div>`+latencyBlock;
    return;
  }

  const dbLimit=LIMITS.database_mb*1048576;
  const stLimit=LIMITS.storage_mb*1048576;
  const storageBytes=(u.storage||[]).reduce((n,b)=>n+Number(b.bytes||0),0);
  const storageFiles=(u.storage||[]).reduce((n,b)=>n+Number(b.files||0),0);
  const exact=u.tables?.exact||{};
  const tables=u.tables?.list||[];

  host.innerHTML=`
    <div class="panel"><div class="usage-head"><h3>Capacity</h3><span class="muted">${esc(LIMITS.plan_label)}</span></div>
      ${meterHtml('Database',u.database_bytes,dbLimit,'Rows, indexes and the database itself. Orders, order items and messages are what grow.')}
      ${meterHtml('File storage',storageBytes,stLimit,`${storageFiles} uploaded file${storageFiles===1?'':'s'} across ${ (u.storage||[]).length } bucket${(u.storage||[]).length===1?'':'s'}. Product and hero images.`)}
      <p class="usage-hint">Limits come from <code>config.js</code>. Your plan cannot be read from the browser, so check them against your Supabase plan.</p>
    </div>

    <div class="panel"><h3>What is taking the space</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Table</th><th>Rows</th><th>Size</th></tr></thead><tbody>
        ${tables.map(t=>`<tr><td>${esc(t.name)}</td><td>${Number(t.rows||0).toLocaleString()}</td><td>${esc(fmtBytes(t.bytes))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="usage-hint">Exact counts — orders ${Number(exact.orders||0).toLocaleString()}, order items ${Number(exact.order_items||0).toLocaleString()}, conversations ${Number(exact.support_threads||0).toLocaleString()}, messages ${Number(exact.support_messages||0).toLocaleString()}. Prune from Orders and Messages; deleting a conversation removes its messages too.</p>
    </div>

    ${(u.storage||[]).length?`<div class="panel"><h3>Uploaded files</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Bucket</th><th>Files</th><th>Size</th></tr></thead><tbody>
        ${(u.storage||[]).map(b=>`<tr><td>${esc(b.bucket)}</td><td>${Number(b.files||0).toLocaleString()}</td><td>${esc(fmtBytes(b.bytes))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="usage-hint">Images are compressed on upload, so these should stay small. Deleting a product does not delete its image file.</p></div>`:''}

    ${latencyBlock}

    <div class="panel"><h3>Not measurable from here</h3>
      <ul class="usage-list">
        <li><strong>Bandwidth / egress</strong> — Supabase does not expose this to the browser. Check Supabase → Reports.</li>
        <li><strong>Google Drive space</strong> used by payment receipts — check your Google account storage.</li>
        <li><strong>Project pausing</strong> — free Supabase projects pause after a week with no activity.</li>
      </ul>
    </div>`;
}

function security(m){
  m.innerHTML=`<div class="page-head"><div><span class="eyebrow">Access</span><h2>Security &amp; storage</h2></div>
      <button type="button" id="refreshUsage">Refresh</button></div>
    <div class="panel"><p><strong>Signed in as:</strong> ${esc(A.session.user.email)}</p>
      <p>Admin access is protected by Supabase Auth and the <code>admin_users</code> table. Your service-role key is never exposed to the browser.</p></div>
    <div id="usagePanels"><p class="muted">Measuring…</p></div>
    <div class="panel"><h3>This device</h3>
      <p>You stay signed in on this browser, so you do not have to enter your password each visit. Anyone who can use this browser profile can therefore open Admin — log out below when you are on a shared or public computer.</p>
      <button class="danger-btn" id="logout">Log Out</button></div>`;
  document.getElementById('logout').onclick=async()=>{await db.auth.signOut();A.session=null;renderLogin()};
  document.getElementById('refreshUsage').onclick=()=>{USAGE.data=null;paintUsage();loadUsage()};
  if(USAGE.data)paintUsage();
  loadUsage();
}

function appearance(m){const s=A.data.settings;let heroItems=(s.hero_images||[]).map(url=>({id:crypto.randomUUID(),url,file:null}));m.innerHTML=`<span class="eyebrow">Storefront content</span><h2>Appearance</h2><form id="appearanceForm" class="panel admin-form"><label>Store Logo${s.logo_url?` <img src="${esc(s.logo_url)}" style="width:70px;height:70px;object-fit:cover;border-radius:50%;vertical-align:middle;margin-left:10px;border:1px solid var(--line)">`:` <img src="bilihan-logo.png" style="width:70px;height:70px;object-fit:cover;border-radius:50%;vertical-align:middle;margin-left:10px;border:1px solid var(--line)">`}<input name="logo_file" type="file" accept="image/*"></label><label>Hero title<input name="hero_title" value="${esc(s.hero_title||'')}"></label><label>Hero tagline<textarea name="hero_tagline">${esc(s.hero_tagline||'')}</textarea></label><label>Hero images<small class="muted" style="display:block;font-weight:400;margin:2px 0 8px">Best size 1600×1200px (4:3 ratio). Tap the + tile to add an image, tap × to remove one.</small><div id="heroSlotsWrap" class="hero-slots-grid"></div></label><label>About text<textarea name="about_text" rows="6">${esc(s.about_text||'')}</textarea></label><label>About image<input name="about_file" type="file" accept="image/*"></label><input name="about_image_url" value="${esc(s.about_image_url||'')}" placeholder="Or About image URL"><button class="primary-btn">Save Appearance</button></form>`;const wrap=document.getElementById('heroSlotsWrap');function renderHeroSlots(){wrap.innerHTML=heroItems.map((it,i)=>`<div class="hero-slot" data-id="${it.id}"><img src="${esc(it.file?URL.createObjectURL(it.file):it.url)}" alt="Hero image ${i+1}"><button type="button" class="hero-slot-remove" data-id="${it.id}" aria-label="Remove hero image ${i+1}" title="Remove">×</button></div>`).join('')+`<label class="hero-add-slot" title="Add hero image"><span>+</span><input type="file" accept="image/*" id="heroAddInput"></label>`;wrap.querySelectorAll('.hero-slot-remove').forEach(btn=>btn.onclick=()=>{heroItems=heroItems.filter(x=>x.id!==btn.dataset.id);renderHeroSlots()});document.getElementById('heroAddInput').onchange=ev=>{const f=ev.target.files[0];if(!f)return;heroItems.push({id:crypto.randomUUID(),url:null,file:f});renderHeroSlots()}}renderHeroSlots();document.getElementById('appearanceForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);let logo=s.logo_url||null;let about=String(fd.get('about_image_url')||'');const logoFile=fd.get('logo_file');const aboutFile=fd.get('about_file');try{if(logoFile&&logoFile.size)logo=await uploadImage(logoFile,'store-assets');if(aboutFile&&aboutFile.size)about=await uploadImage(aboutFile,'store-assets');const heroUrls=[];for(const it of heroItems){if(it.file){heroUrls.push(await uploadImage(it.file,'store-assets'))}else if(it.url){heroUrls.push(it.url)}}const row={logo_url:logo,hero_title:fd.get('hero_title'),hero_tagline:fd.get('hero_tagline'),hero_images:heroUrls,about_text:fd.get('about_text'),about_image_url:about};const {error}=await db.from('store_settings').update(row).eq('id',1);if(error)throw error;await loadAll();alert('Appearance saved.');renderShell()}catch(err){alert(err.message)}}}
/* Keep A.session in step with background token refreshes, and follow a sign-out
   that happened in another tab. */
if(window.db){
  db.auth.onAuthStateChange((event,session)=>{
    A.session=session||null;
    if(event==='SIGNED_OUT'&&!A.session)renderLogin();
  });
}
init().catch(e=>{console.error(e);app.innerHTML=`<div class="login-wrap"><div class="login-card"><h2>Bilihan Admin</h2><p>${esc(e.message)}</p></div></div>`});