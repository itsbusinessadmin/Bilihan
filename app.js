const GOOGLE_SHEETS_WEB_APP_URL = (window.BILIHAN_CONFIG||{}).GOOGLE_SHEETS_WEB_APP_URL || '';
const LS = { cart:'bilihan_cart_v3', theme:'bilihan_theme_v3', skin:'bilihan_skin_v1', latestOrder:'bilihan_latest_order_v3', cache:'bilihan_cache_v3', pendingCancel:'bilihan_pending_cancel_v3', productView:'bilihan_product_view_v1', lastOrderAt:'bilihan_last_order_at_v1' };
const TITLE_SUFFIX='Order Food Online for Pickup or Delivery';
/* Order cooldown and form dwell time: cheap client-side deterrents against bots and
   accidental double submissions. Server-side limits still belong in Supabase. */
const ORDER_COOLDOWN_MS=30*1000, MIN_CHECKOUT_DWELL_MS=3000;
/* Seed values shipped with the database. Treat them as 'not configured yet' so the
   storefront never shows placeholder contact details to a customer. */
const PLACEHOLDER_SETTINGS=['+63 900 000 0000','https://m.me/','https://instagram.com/','Your pickup location here'];
function realSetting(value){const v=String(value||'').trim();return v&&!PLACEHOLDER_SETTINGS.includes(v)?v:''}
function telHref(phone){return 'tel:'+phone.replace(/[^\d+]/g,'')}
function track(event){try{window.BilihanAnalytics?.track?.(event)}catch{/* analytics must never break checkout */}}
const FALLBACK = {
  settings:{business_name:'Bilihan',phone:'+63 900 000 0000',messenger_url:'https://m.me/',instagram_url:'https://instagram.com/',pickup_location:'Your pickup location here',qr_image_url:'bilihan-logo.png',hero_title:'Good food, made easy.',hero_tagline:'From everyday favorites to satisfying cravings, find something good at Bilihan.',about_text:'Bilihan is your easy online food stop for everyday favorites, cravings, meals, snacks, and more.',about_image_url:'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80',hero_images:['https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1600&q=80']},
  categories:[],products:[]
};
function safeJsonParse(value,fallback){try{const parsed=JSON.parse(value);return parsed??fallback}catch{return fallback}}
const savedCart=safeJsonParse(localStorage.getItem(LS.cart),'[]');
const state={data:null,category:'all',cart:Array.isArray(savedCart)?savedCart:[],heroIndex:0,online:navigator.onLine!==false,productView:localStorage.getItem(LS.productView)==='list'?'list':'grid'};
const $=id=>document.getElementById(id); const money=n=>`₱${Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),1800)}
function saveCart(){localStorage.setItem(LS.cart,JSON.stringify(state.cart));renderCart()}
async function bootstrap(){
  if(!window.BILIHAN_SUPABASE_CONFIGURED){state.online=false; state.data=safeJsonParse(localStorage.getItem(LS.cache),null)||structuredClone(FALLBACK);renderAll();return;}
  /* Paint the cached menu immediately so a returning customer sees products without
     waiting on the network, then refresh in the background. A briefly stale card cannot
     produce a wrong order: checkout re-reads live products and place_order re-checks
     stock and price server-side. */
  const cached=safeJsonParse(localStorage.getItem(LS.cache),null);
  if(cached?.products?.length&&cached.settings){state.data=cached;renderAll()}
  else renderSkeletons();
  try{
    const [{data:categories,error:ce},{data:products,error:pe},{data:settings,error:se}] = await Promise.all([
      db.from('categories').select('*').order('sort_order'),
      db.from('products').select('*').order('sort_order'),
      db.from('store_settings').select('*').eq('id',1).single()
    ]);
    if(ce||pe||se) throw ce||pe||se;
    state.data={categories,products,settings};state.online=true;localStorage.setItem(LS.cache,JSON.stringify(state.data));
  }catch(e){console.error(e);state.online=false;state.data=safeJsonParse(localStorage.getItem(LS.cache),null)||structuredClone(FALLBACK)}
  renderAll();retryPendingCancel();
}
function renderSkeletons(){$('menuGrid').innerHTML=Array.from({length:8},()=>'<div class="skeleton"></div>').join('')}
/* The browser chrome colour follows the design's own --bg token rather than a
   hardcoded pair, so a second design does not need this file edited to match. */
function syncThemeColor(){
  const meta=document.querySelector('meta[name="theme-color"]');
  if(!meta)return;
  const dark=document.documentElement.dataset.theme==='dark';
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  meta.setAttribute('content',bg||(dark?'#0d100e':'#faf8f3'));
}
/* Which of the two storefront designs to wear. The owner picks this in
   Admin -> Appearance and it arrives with the rest of store_settings; we mirror it
   into localStorage so the inline script in index.html can apply it before first
   paint on the next visit. Light/dark mode stays a separate, per-visitor choice. */
const SKINS=['original','storefront'];
function applySkin(name){
  const skin=SKINS.includes(name)?name:'original';
  if(document.documentElement.dataset.skin!==skin){document.documentElement.dataset.skin=skin;syncThemeColor()}
  try{localStorage.setItem(LS.skin,skin)}catch(e){}
}
function renderAll(){renderSettings();renderCategories();renderViewSwitch();renderProducts();renderCart();renderLatestOrderButton();renderConnection()}
function renderConnection(){
  const b=$('connectionBanner');
  if(!window.BILIHAN_SUPABASE_CONFIGURED){b.textContent=window.BILIHAN_SUPABASE_LIB_MISSING?'We could not reach our ordering system. You are browsing a saved copy of the menu, and checkout is disabled until the connection returns.':'Store database is not connected yet. Browsing demo/cache only; checkout is disabled.';b.classList.remove('hidden');return}
  if(!state.online){b.textContent='Ordering is temporarily unavailable. You can still browse our cached menu while we reconnect. ';const btn=document.createElement('button');btn.className='secondary-btn';btn.textContent='Try Again';btn.onclick=bootstrap;b.replaceChildren(document.createTextNode(b.textContent),btn);b.classList.remove('hidden')} else b.classList.add('hidden')
}
function renderSettings(){
  const s=state.data.settings||FALLBACK.settings;
  applySkin(s.storefront_skin);
  const name=realSetting(s.business_name)||'Bilihan';
  const logo=s.logo_url||'bilihan-mark.webp';
  $('brandName').textContent=$('footerBrand').textContent=name;
  /* On phones the name is hidden and this label is all a screen reader gets, so it
     has to follow the store's actual name rather than stay at the seeded one. */
  document.querySelector('.brand-lockup')?.setAttribute('aria-label',`${name} Home`);
  document.querySelectorAll('.footer-copy-name').forEach(el=>{el.textContent=name});
  document.title=`${name} — ${TITLE_SUFFIX}`;
  document.querySelectorAll('img[data-store-logo]').forEach(img=>{img.src=logo});
  $('heroTitle').textContent=s.hero_title;$('heroTagline').textContent=s.hero_tagline;$('aboutText').textContent=s.about_text;
  $('aboutImage').onerror=()=>{$('aboutImage').src='bilihan-logo.png';$('aboutImage').onerror=null};$('aboutImage').src=s.about_image_url||'bilihan-logo.png';
  $('aboutImage').alt=`A selection of the food available at ${name}`;
  renderContact(s);
  $('year').textContent=new Date().getFullYear();
  renderHero();
  syncHeroTimer();
}
function renderContact(s){
  const methods=[];
  const phone=realSetting(s.phone),email=realSetting(s.email),messenger=realSetting(s.messenger_url),instagram=realSetting(s.instagram_url);
  if(phone)methods.push({href:telHref(phone),label:phone,icon:'phone'});
  if(email)methods.push({href:`mailto:${email}`,label:email});
  if(messenger)methods.push({href:messenger,label:'Messenger',external:true});
  if(instagram)methods.push({href:instagram,label:'Instagram',external:true});
  const html=methods.map(m=>`<a class="contact-link${m.icon?' contact-'+m.icon:''}" href="${esc(m.href)}"${m.external?' target="_blank" rel="noopener noreferrer"':''}>${esc(m.label)}</a>`).join('');
  const footer=$('footerContact');if(footer)footer.innerHTML=html;
}
/* The dots are rebuilt only when the image list itself changes. The old version
   re-wrote their innerHTML and re-bound every click handler on each rotation —
   a full teardown of the same markup, four seconds apart, forever. */
let heroDotsKey='';
function buildHeroDots(imgs){
  const key=imgs.join('|');
  if(key===heroDotsKey)return;
  heroDotsKey=key;
  const dots=$('heroDots');
  dots.innerHTML=imgs.length>1?imgs.map((_,i)=>`<button data-i="${i}" aria-label="Show featured image ${i+1}"></button>`).join(''):'';
  if(imgs.length>1&&!dots.dataset.bound){
    dots.dataset.bound='1';
    dots.addEventListener('click',e=>{const b=e.target.closest('button[data-i]');if(!b)return;state.heroIndex=+b.dataset.i;renderHero()});
  }
}
function renderHero(){
  const imgs=state.data.settings?.hero_images||[];
  const img=$('heroImage');
  if(!imgs.length){img.src='bilihan-logo.png';$('heroDots').innerHTML='';heroDotsKey='';return}
  img.onerror=()=>{img.src='bilihan-logo.png';img.onerror=null};
  const i=state.heroIndex%imgs.length;
  img.src=imgs[i];
  buildHeroDots(imgs);
  /* Toggling two classes beats re-rendering the whole strip. */
  for(const b of $('heroDots').children){
    const on=+b.dataset.i===i;
    b.classList.toggle('active',on);
    b.setAttribute('aria-current',String(on));
  }
  /* Warm the next slide so the swap has no blank frame. */
  if(imgs.length>1)new Image().src=imgs[(i+1)%imgs.length];
}
/* One rotation timer, started only when there is something to rotate, and the
   reduced-motion query is created once instead of on every tick. */
const heroReduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let heroTimer=0;
function syncHeroTimer(){
  const n=state.data?.settings?.hero_images?.length||0;
  const wanted=n>1&&!heroReduceMotion.matches;
  if(wanted&&!heroTimer)heroTimer=setInterval(()=>{if(document.hidden)return;state.heroIndex=(state.heroIndex+1)%(state.data.settings.hero_images.length||1);renderHero()},4000);
  else if(!wanted&&heroTimer){clearInterval(heroTimer);heroTimer=0}
}
heroReduceMotion.addEventListener('change',syncHeroTimer);

function visibleCategories(){return (state.data.categories||[]).filter(c=>(state.data.products||[]).some(p=>p.category_id===c.id)).sort((a,b)=>a.sort_order-b.sort_order)}
/* Categories are a dropdown rather than a row of pills: the owner can add as many
   as they like, and a native select gets the platform's own picker on phones. */
function renderCategories(){
  const sel=$('categorySelect');
  sel.innerHTML=[{id:'all',name:'All'},...visibleCategories()].map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  /* A category can disappear while it is the selected one (the owner deletes it, or
     it empties out). Assigning a value no option carries leaves the select blank, so
     fall back to All instead of showing an empty filter. */
  sel.value=state.category;
  if(!sel.value){state.category='all';sel.value='all'}
  bindCategorySelect();
}
function bindCategorySelect(){const sel=$('categorySelect');if(!sel||sel.dataset.bound)return;sel.dataset.bound='1';sel.addEventListener('change',()=>{state.category=sel.value;renderProducts()})}
function renderViewSwitch(){const grid=$('gridViewBtn'),list=$('listViewBtn'),menu=$('menuGrid');if(!grid||!list||!menu)return;const isList=state.productView==='list';menu.classList.toggle('list-view',isList);grid.classList.toggle('active',!isList);list.classList.toggle('active',isList);grid.setAttribute('aria-pressed',String(!isList));list.setAttribute('aria-pressed',String(isList));grid.onclick=()=>setProductView('grid');list.onclick=()=>setProductView('list')}
function setProductView(view){state.productView=view==='list'?'list':'grid';localStorage.setItem(LS.productView,state.productView);renderViewSwitch()}
function renderProducts(){const showStock=state.data.settings?.show_stock!==false;const ps=(state.data.products||[]).filter(p=>state.category==='all'||p.category_id===state.category).sort((a,b)=>a.sort_order-b.sort_order);const allSold=ps.length&&ps.every(p=>!p.is_available||p.stock<=0);const empty=!ps.length?'<div class="empty-state"><h3>No products here yet</h3><p>Try another category or check back soon.</p></div>':'';$('menuGrid').innerHTML=empty+(allSold?'<div class="status-banner" style="grid-column:1/-1">We’re currently sold out. Please check back again soon!</div>':'')+ps.map(p=>{const sold=!p.is_available||p.stock<=0;const stock=sold?'Sold Out':p.stock<=5?`Only ${p.stock} left!`:`${p.stock} available`;const stockHtml=(showStock||sold)?`<div class="stock ${sold?'sold':''}">${stock}</div>`:'';const addButton=sold?'':`<button class="product-card-add" type="button" data-add-id="${p.id}" aria-label="Add ${esc(p.name)} to cart" title="Add to cart"><img class="ui-icon" src="ios-icons/add-to-cart.png" alt="" aria-hidden="true"></button>`;return `<article class="product-card" data-id="${p.id}"><img class="product-card-image" loading="lazy" decoding="async" src="${esc(p.image_url||'bilihan-logo.png')}" onerror="this.onerror=null;this.src='bilihan-logo.png'" alt="${esc(p.name)}"><div class="product-info"><div class="product-row"><strong>${esc(p.name)}</strong><span class="price">${money(p.price)}</span></div><div class="product-card-bottom">${stockHtml}${addButton}</div></div></article>`}).join('');bindMenuGrid()}
/* One delegated listener for the whole grid, attached once. The previous version
   re-bound two handlers per card on every render, which got slower with the
   catalogue and left the old closures behind each time. */
function bindMenuGrid(){const grid=$('menuGrid');if(!grid||grid.dataset.bound)return;grid.dataset.bound='1';grid.addEventListener('click',e=>{const add=e.target.closest('.product-card-add');if(add){quickAddToCart(add.dataset.addId,e,add);return}const card=e.target.closest('.product-card');if(card)openProduct(card.dataset.id)})}
function quickAddToCart(id,event,button){event?.stopPropagation();const p=state.data.products.find(x=>x.id===id);if(!p||!p.is_available||p.stock<=0)return;const ex=state.cart.find(x=>x.productId===id);const current=ex?.qty||0;if(current>=p.stock){toast('Maximum available stock reached');return}if(ex)ex.qty+=1;else state.cart.push({productId:id,qty:1,price:+p.price,name:p.name,image:p.image_url});saveCart();const btn=button||event?.currentTarget;if(btn?.classList){btn.classList.add('added');setTimeout(()=>btn.classList.remove('added'),350)}toast('Added to cart ✓')}
function openProduct(id){const showStock=state.data.settings?.show_stock!==false;const p=state.data.products.find(x=>x.id===id);if(!p){toast('This product is no longer available.');renderProducts();return}const inCart=state.cart.find(x=>x.productId===id)?.qty||0;const max=Math.max(0,p.stock-inCart);const sold=!p.is_available||p.stock<=0;const cat=state.data.categories.find(c=>c.id===p.category_id)?.name||'';$('productDialog').innerHTML=`<div class="modal-body"><button class="icon-btn modal-close" aria-label="Close" onclick="productDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><div class="product-modal-grid"><img class="product-modal-image" src="${esc(p.image_url||'bilihan-logo.png')}" onerror="this.onerror=null;this.src='bilihan-logo.png'" alt="${esc(p.name)}"><div><span class="eyebrow">${esc(cat)}</span><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><h3>${money(p.price)}</h3>${(showStock||sold)?`<p class="stock ${sold?'sold':''}">${sold?'Sold Out':p.stock<=5?`Only ${p.stock} left!`:`${p.stock} available`}</p>`:''}${sold?'<button class="primary-btn" disabled>Sold Out</button>':max<=0?'<p class="muted">You already have the maximum available quantity in your cart.</p>':`<div class="qty"><button id="qMinus" aria-label="Decrease quantity"><img class="ui-icon" src="ios-icons/minus.png" alt="" aria-hidden="true"></button><strong id="qVal">1</strong><button id="qPlus" aria-label="Increase quantity"><img class="ui-icon" src="ios-icons/plus.png" alt="" aria-hidden="true"></button></div><br><button id="addToCart" class="primary-btn">Add to Cart</button>`}</div></div></div>`;$('productDialog').showModal();let q=1;if($('qMinus')){$('qMinus').onclick=()=>{q=Math.max(1,q-1);$('qVal').textContent=q};$('qPlus').onclick=()=>{q=Math.min(max,q+1);$('qVal').textContent=q};$('addToCart').onclick=()=>{const ex=state.cart.find(x=>x.productId===id);if(ex)ex.qty+=q;else state.cart.push({productId:id,qty:q,price:+p.price,name:p.name,image:p.image_url});saveCart();$('productDialog').close();toast('Added to cart ✓')}}}
function renderCart(){
  $('cartCount').textContent=state.cart.reduce((s,i)=>s+i.qty,0);
  if(!state.cart.length){$('cartItems').innerHTML='<div style="text-align:center;padding:60px 20px"><h3>Your cart is empty</h3><button class="secondary-btn" id="browseBtn">Browse Menu</button></div>';$('cartFooter').innerHTML='';setTimeout(()=>$('browseBtn')&&($('browseBtn').onclick=closeCart),0);return}
  $('cartItems').innerHTML=state.cart.map((i,idx)=>`<div class="cart-item"><img src="${esc(i.image||'bilihan-logo.png')}" width="72" height="72" loading="lazy" alt="${esc(i.name)}" onerror="this.onerror=null;this.src='bilihan-logo.png'"><div class="cart-item-main"><strong>${esc(i.name)}</strong><span>${money(i.price)}</span><div class="cart-controls"><button class="qty-btn" data-a="minus" data-i="${idx}" aria-label="Decrease ${esc(i.name)} quantity"><img class="ui-icon" src="ios-icons/minus.png" alt="" aria-hidden="true"></button><span class="qty-value">${i.qty}</span><button class="qty-btn" data-a="plus" data-i="${idx}" aria-label="Increase ${esc(i.name)} quantity"><img class="ui-icon" src="ios-icons/plus.png" alt="" aria-hidden="true"></button><button class="remove-btn icon-remove-btn" data-a="remove" data-i="${idx}" aria-label="Remove ${esc(i.name)} from cart" title="Remove"><img class="ui-icon" src="ios-icons/trash.png" alt="" aria-hidden="true"></button></div></div></div>`).join('');
  const total=state.cart.reduce((s,i)=>s+i.qty*i.price,0);$('cartFooter').innerHTML=`<div class="summary-row"><strong>Total</strong><strong>${money(total)}</strong></div><button id="checkoutBtn" class="primary-btn" style="width:100%">Checkout</button>`;
  $('cartItems').querySelectorAll('button').forEach(b=>b.onclick=()=>cartAction(b.dataset.a,+b.dataset.i));$('checkoutBtn').onclick=openCheckout;
}
async function cartAction(a,i){const item=state.cart[i];if(a==='minus')item.qty=Math.max(1,item.qty-1);if(a==='plus'){const p=state.data.products.find(p=>p.id===item.productId);if(item.qty<(p?.stock||0))item.qty++;else toast('Maximum available stock reached')}if(a==='remove'&&confirm('Remove this item from your cart?'))state.cart.splice(i,1);saveCart()}
function openCart(){const d=$('cartDrawer');d.classList.add('open');d.setAttribute('aria-hidden','false');d.removeAttribute('inert');$('backdrop').classList.remove('hidden');$('closeCart').focus()}
function closeCart(){const d=$('cartDrawer');d.classList.remove('open');d.setAttribute('aria-hidden','true');d.setAttribute('inert','');$('backdrop').classList.add('hidden')}
$('cartBtn').onclick=openCart;$('closeCart').onclick=closeCart;$('backdrop').onclick=closeCart;
$('cartDrawer').setAttribute('inert','');

/* ---- Mobile navigation (the desktop nav is hidden below 820px) ---- */
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('cartDrawer').classList.contains('open'))closeCart()});

/* Bottom tab bar (phones), in place of the old hamburger. Home/Products/About are
   anchors on this one page, so the bar is a jump bar rather than a router: it marks
   whichever section the reader is actually looking at. */
function syncBottomNav(id){
  document.querySelectorAll('.bottom-nav-link[data-section]').forEach(a=>{
    const on=a.dataset.section===id;
    a.classList.toggle('active',on);
    if(on)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');
  });
}
(function watchSections(){
  const secs=['home','menu','about'].map(id=>$(id)).filter(Boolean);
  if(!secs.length)return;
  if(!('IntersectionObserver' in window)){syncBottomNav('home');return}
  /* A zero-height band across the middle of the viewport. The sections are stacked
     with no gaps, so exactly one crosses the midline at a time — no ratio tie-break
     and no guessing from scroll offsets. */
  const io=new IntersectionObserver(entries=>{
    for(const e of entries)if(e.isIntersecting)syncBottomNav(e.target.id);
  },{rootMargin:'-50% 0px -50% 0px',threshold:0});
  secs.forEach(sec=>io.observe(sec));
  syncBottomNav('home');
})();
function validateCartAgainstLive(liveProducts){let changed=false, invalid=[];for(const item of state.cart){const p=liveProducts.find(x=>x.id===item.productId);if(!p){invalid.push(`${item.name} is no longer available.`);changed=true;continue}if(!p.is_available||p.stock<item.qty){invalid.push(`${item.name} no longer has enough stock.`);changed=true}if(+p.price!==+item.price){item.price=+p.price;invalid.push(`${item.name} price was updated.`);changed=true}}if(changed)saveCart();return invalid}
async function fetchLiveProducts(){const {data,error}=await db.from('products').select('*');if(error)throw error;return data}
async function syncOrderToGoogleSheet(order){try{if(!GOOGLE_SHEETS_WEB_APP_URL)return;const items=(order.items||[]).map(i=>`${i.product_name} x ${i.qty}`).join(', ');const payload={order_id:order.id||order.order_id||order.order_code,order_code:order.order_code||'',order_date:order.created_at||new Date().toISOString(),customer_name:order.customer_name||'',phone:order.phone||'',email:order.email||'',fulfillment:order.fulfillment||'',address:order.address||'',preferred_date:order.preferred_date||'',payment_method:order.payment_method||'',items:items,subtotal:Number(order.subtotal??order.total??0),delivery_fee:Number(order.delivery_fee||0),total:Number(order.total||0),payment_status:order.payment_status||'Pending',order_status:order.status||'Pending',cancellation_reason:order.cancellation_reason||'',store_name:realSetting(state.data.settings?.business_name)||'Bilihan',pickup_location:realSetting(state.data.settings?.pickup_location)||'',site_url:(window.BILIHAN_CONFIG||{}).SITE_URL||''};await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)})}catch(err){console.warn('Google Sheets sync failed:',err)}}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Unable to read receipt file.'));reader.readAsDataURL(file)})}
function formatFileSize(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(0)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`}
/* Receipts are read, not admired: 1280px at a size budget keeps every digit
   legible while cutting what has to cross a phone connection. */
const RECEIPT_MAX_SIDE=1280,RECEIPT_TARGET_BYTES=180*1024,RECEIPT_QUALITY_STEPS=[.7,.55,.42];
function encodeCanvasToJpeg(canvas,quality){
  /* OffscreenCanvas keeps the encode off the main thread, so the UI never janks
     while a large photo is being squeezed. */
  if(canvas.convertToBlob)return canvas.convertToBlob({type:'image/jpeg',quality});
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to optimize receipt image.')),'image/jpeg',quality));
}
async function compressReceiptImage(file){
  const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
  if(!allowed.includes(file.type))throw new Error('Receipt must be JPG, PNG, WEBP, or PDF.');
  if(file.type==='application/pdf'){if(file.size>3*1024*1024)throw new Error('PDF receipt must be 3 MB or smaller.');return file}
  if(file.size>12*1024*1024)throw new Error('Receipt image is too large. Please use an image smaller than 12 MB.');
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,RECEIPT_MAX_SIDE/Math.max(bitmap.width,bitmap.height));
  const width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
  const ctx=canvas.getContext('2d',{alpha:false});
  ctx.drawImage(bitmap,0,0,width,height);
  bitmap.close?.();
  /* Step the quality down only while the result is still over budget, so a
     small receipt is never degraded to pay for a large one. */
  let blob=await encodeCanvasToJpeg(canvas,RECEIPT_QUALITY_STEPS[0]);
  for(let i=1;i<RECEIPT_QUALITY_STEPS.length&&blob.size>RECEIPT_TARGET_BYTES;i++)blob=await encodeCanvasToJpeg(canvas,RECEIPT_QUALITY_STEPS[i]);
  /* An already-small original beats anything re-encoding produces. */
  if(blob.size>=file.size)return file;
  const baseName=(file.name||'receipt').replace(/\.[^.]+$/,'');
  return new File([blob],`${baseName}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
}

async function uploadReceiptToGoogleDrive(order,file,cachedBase64){
  if(!order?.order_code)throw new Error('Order number is missing.');
  if(!file)throw new Error('Please upload your payment receipt.');
  const file_base64=cachedBase64||await fileToBase64(file);
  const payload={action:'upload_receipt',order_code:order.order_code,file_name:file.name,mime_type:file.type,file_base64};
  return fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),cache:'no-store'});
}

function isExplicitlyEnabled(settings,key){return settings?.[key]===true}
function checkoutError(message){const box=$('checkoutError');if(!box)return;box.textContent=message||'';box.classList.toggle('hidden',!message)}
function clearFieldErrors(form){form.querySelectorAll('.field-error').forEach(node=>node.remove());form.querySelectorAll('[aria-invalid="true"]').forEach(el=>{el.removeAttribute('aria-invalid');el.classList.remove('invalid')})}
function fieldError(form,name,message){
  const input=form.elements[name];if(!input)return;
  input.setAttribute('aria-invalid','true');input.classList.add('invalid');
  const host=input.closest('.field')||input.parentElement;
  if(host&&!host.querySelector('.field-error')){const span=document.createElement('span');span.className='field-error';span.setAttribute('role','alert');span.textContent=message;host.appendChild(span)}
  input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');input.classList.remove('invalid');host?.querySelector('.field-error')?.remove()},{once:true});
}
function openCheckout(){
  closeCart();
  if(!window.BILIHAN_SUPABASE_CONFIGURED||!state.online){toast('Ordering is temporarily unavailable. Please try again shortly.');return}
  if(!state.cart.length){toast('Your cart is empty.');return}
  const s=state.data.settings||{};
  const deliveryEnabled=isExplicitlyEnabled(s,'show_delivery_address');
  const fulfillmentValues=[...(deliveryEnabled?['Delivery']:[]),'Pickup'];
  const fulfillmentOptions=fulfillmentValues.map(value=>`<option value="${value}">${value}</option>`).join('');
  const fulfillmentField=fulfillmentValues.length===1?`<div class="field"><span class="field-label">Receive order</span><div class="choice-value">${esc(fulfillmentValues[0])}</div><input type="hidden" name="fulfillment" value="${esc(fulfillmentValues[0])}"></div>`:`<label class="field"><span class="field-label">Receive order *</span><select name="fulfillment">${fulfillmentOptions}</select></label>`;
  const showPreferredDate=isExplicitlyEnabled(s,'show_preferred_date');
  /* Contact fields are the shop's choice: each can be hidden, and each can be made
     compulsory. A hidden field is never required — nobody was asked for it. Both
     default to shown-and-optional when the setting has never been saved. */
  const showPhone=s.checkout_show_phone!==false, requirePhone=showPhone&&s.checkout_require_phone===true;
  const showEmail=s.checkout_show_email!==false, requireEmail=showEmail&&s.checkout_require_email===true;
  const optionalTag='<span class="muted">(optional)</span>';
  const phoneField=showPhone?`<label class="field"><span class="field-label">Mobile number ${requirePhone?'*':optionalTag}</span><input name="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="09XXXXXXXXX"${requirePhone?' required':''}></label>`:'';
  const emailField=showEmail?`<label class="field full"><span class="field-label">Email ${requireEmail?'*':optionalTag}</span><input name="email" type="email" inputmode="email" autocomplete="email" maxlength="160" placeholder="you@example.com"${requireEmail?' required':''}><small class="muted">We'll email your order confirmation here.${requireEmail?'':' Leave blank to skip.'}</small></label>`:'';
  const preferredDateMode=s.preferred_date_mode||'calendar';
  const availableFrom=s.order_available_from||'';
  const qrConfigured=isExplicitlyEnabled(s,'show_qr_payment')&&!!String(s.qr_image_url||'').trim();
  const cashEnabled=isExplicitlyEnabled(s,'show_cash_payment');
  const paymentValues=[...(qrConfigured?[{value:'QR Payment',label:'QR Payment'}]:[]),...(cashEnabled?[{value:'Cash on Delivery / Pickup',label:'Cash'}]:[])];
  const paymentOptions=paymentValues.map(item=>`<option value="${item.value}">${item.label}</option>`).join('');
  if(!paymentValues.length){toast(isExplicitlyEnabled(s,'show_qr_payment')?'QR payment is not fully configured yet. Please contact the store.':'No payment method is available right now. Please contact the store.');return}
  const paymentField=paymentValues.length===1?`<div class="field"><span class="field-label">Payment</span><div class="choice-value">${esc(paymentValues[0].label)}</div><input type="hidden" name="payment" value="${esc(paymentValues[0].value)}"></div>`:`<label class="field"><span class="field-label">Payment *</span><select name="payment">${paymentOptions}</select></label>`;
  const today=new Date().toISOString().slice(0,10);
  const minDate=availableFrom||today;
  const fixedDate=availableFrom||today;
  const availableLabel=availableFrom?new Date(availableFrom+'T00:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}):'';
  const preferredDateField=showPreferredDate?(preferredDateMode==='fixed'?`<div class="field"><span class="field-label">Preferred date</span><div class="status-banner" style="margin:0">${esc(availableLabel||fixedDate)}</div><input type="hidden" name="preferredDate" value="${esc(fixedDate)}"></div>`:`<label class="field"><span class="field-label">Preferred date *</span><input name="preferredDate" type="date" required min="${esc(minDate)}"></label>`):`<input type="hidden" name="preferredDate" value="${esc(fixedDate)}">`;
  $('checkoutDialog').innerHTML=`<div class="modal-body checkout-modal"><button class="icon-btn modal-close" aria-label="Close" onclick="checkoutDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><div class="checkout-heading"><h2>Complete your order</h2><p>Review your contact, fulfillment, and payment details before placing the order.</p></div><div id="checkoutError" class="status-banner hidden" role="alert" aria-live="assertive"></div><form id="checkoutForm" class="checkout-form" novalidate><div class="hp-field" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div><div class="checkout-layout"><div class="checkout-main"><section class="checkout-group" aria-labelledby="checkoutContactTitle"><div class="checkout-group-title"><h3 id="checkoutContactTitle">Contact</h3></div><div class="form-grid"><label class="field"><span class="field-label">Name *</span><input name="name" maxlength="100" autocomplete="name" required></label>${phoneField}${emailField}</div></section><section class="checkout-group" aria-labelledby="checkoutFulfillmentTitle"><div class="checkout-group-title"><h3 id="checkoutFulfillmentTitle">Fulfillment</h3></div><div class="form-grid">${fulfillmentField}${preferredDateField}<label id="addressField" class="field full"><span class="field-label">Delivery address *</span><textarea name="address" maxlength="500" autocomplete="street-address" rows="2"></textarea></label><div id="pickupInfo" class="field full hidden"><div class="status-banner" style="margin:0"><strong>Pickup location:</strong> ${esc(s.pickup_location||'Please contact the store for the pickup location.')}</div></div></div></section><section class="checkout-group" aria-labelledby="checkoutPaymentTitle"><div class="checkout-group-title"><h3 id="checkoutPaymentTitle">Payment</h3></div><div class="form-grid">${paymentField}<label class="field checkout-note"><span class="field-label">Customer note <span class="muted">(optional)</span></span><textarea name="note" maxlength="500" rows="2" placeholder="Anything the store should know?"></textarea></label><div id="paymentInfo" class="field full"></div></div></section></div><aside class="checkout-aside" aria-labelledby="checkoutSummaryTitle"><div class="checkout-aside-inner"><div class="checkout-group-title"><h3 id="checkoutSummaryTitle">Your order</h3></div><div class="summary" id="checkoutSummary"></div><div class="checkout-actions"><label class="checkout-confirm"><input type="checkbox" name="confirm" id="confirmOrder" required><span>I confirm that my order and contact details are correct.</span></label><button class="primary-btn" id="placeOrderBtn" disabled>Place Order</button><p class="muted checkout-progress" id="orderProgress" role="status" aria-live="polite"></p></div></div></aside></div></form></div>`;
  $('checkoutDialog').showModal();
  const f=$('checkoutForm');
  f._receiptPrepared=null;f._receiptBase64=null;f._receiptPreparing=false;f.dataset.openedAt=String(Date.now());
  const updatePlaceOrderButton=()=>{const qr=f.payment.value==='QR Payment';const hasReceipt=!qr||!!f._receiptPrepared;const confirmed=$('confirmOrder')?.checked;$('placeOrderBtn').disabled=!!f._receiptPreparing||!(hasReceipt&&confirmed)};
  const renderDynamic=()=>{
    checkoutError('');
    const pickup=f.fulfillment.value==='Pickup';
    $('addressField').classList.toggle('hidden',pickup);$('pickupInfo').classList.toggle('hidden',!pickup);f.address.required=!pickup;
    f._receiptPrepared=null;f._receiptBase64=null;f._receiptPreparing=false;
    if(f.payment.value==='QR Payment'){
      const qrUrl=String(s.qr_image_url||'').trim();
      if(!qrUrl){checkoutError('QR payment is no longer available. Please choose another payment method.');updatePlaceOrderButton();return}
      $('paymentInfo').innerHTML=`<div class="qr-payment-card"><div id="qrImageState"><img id="paymentQrImage" src="${esc(qrUrl)}" alt="Store payment QR code"></div><div class="qr-payment-actions"><p><strong>Pay by QR</strong><br><span class="muted">Scan or save the code, then upload your payment receipt.</span></p><a class="secondary-btn" href="${esc(qrUrl)}" download="Bilihan-QR-Code" target="_blank" rel="noopener">Save QR Code</a><label class="field"><strong>Payment receipt *</strong><input name="receipt" id="paymentReceipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><p class="muted" id="receiptStatus" role="status" aria-live="polite">No receipt selected yet.</p></div></div>`;
      const qrImg=$('paymentQrImage');if(qrImg)qrImg.onerror=()=>{$('qrImageState').innerHTML='<div class="status-banner" role="alert">The payment QR code could not be loaded. Please choose another payment method.</div>'};
      const receipt=$('paymentReceipt');receipt.onchange=async()=>{const file=receipt.files[0];f._receiptPrepared=null;f._receiptBase64=null;if(!file){$('receiptStatus').textContent='No receipt selected yet.';updatePlaceOrderButton();return}f._receiptPreparing=true;$('receiptStatus').textContent='Preparing receipt…';updatePlaceOrderButton();try{const prepared=await compressReceiptImage(file);f._receiptPrepared=prepared;f._receiptBase64=null;$('receiptStatus').textContent=`Receipt ready: ${prepared.name} (${formatFileSize(prepared.size)})`;fileToBase64(prepared).then(b64=>{if(f._receiptPrepared===prepared)f._receiptBase64=b64}).catch(()=>{})}catch(err){receipt.value='';f._receiptPrepared=null;f._receiptBase64=null;$('receiptStatus').textContent=err.message||'Unable to prepare this receipt. Please choose a JPG, PNG, WEBP, or PDF file.'}finally{f._receiptPreparing=false;updatePlaceOrderButton()}}
    }else{$('paymentInfo').innerHTML='<div class="status-banner">Please prepare the exact amount when possible.</div>'}
    updatePlaceOrderButton();
    $('checkoutSummary').innerHTML=state.cart.map(i=>`<div class="summary-row"><span>${esc(i.name)} × ${i.qty}</span><strong>${money(i.price*i.qty)}</strong></div>`).join('')+`<hr><div class="summary-row"><strong>Total</strong><strong>${money(state.cart.reduce((sum,i)=>sum+i.qty*i.price,0))}</strong></div>`
  };
  f.fulfillment.onchange=renderDynamic;f.payment.onchange=renderDynamic;$('confirmOrder').onchange=updatePlaceOrderButton;renderDynamic();f.onsubmit=placeOrder
}
async function placeOrder(e){
  e.preventDefault();
  const f=e.currentTarget;const btn=$('placeOrderBtn');const progress=$('orderProgress');const s=state.data.settings||{};
  if(f.dataset.submitting==='true')return;
  checkoutError('');
  const d=Object.fromEntries(new FormData(f));
  /* Honeypot: a real customer never sees this field, so anything in it is a bot. */
  if(String(d.website||'').trim()){checkoutError('We could not verify this order. Please reload the page and try again.');return}
  const dwell=Date.now()-Number(f.dataset.openedAt||0);
  if(dwell<MIN_CHECKOUT_DWELL_MS){checkoutError('Please take a moment to check your details, then place the order again.');return}
  const lastOrderAt=Number(localStorage.getItem(LS.lastOrderAt)||0);
  const cooldownLeft=ORDER_COOLDOWN_MS-(Date.now()-lastOrderAt);
  if(lastOrderAt&&cooldownLeft>0){checkoutError(`You just placed an order. Please wait ${Math.ceil(cooldownLeft/1000)} seconds before placing another one.`);return}
  const allowedFulfillment=new Set(['Pickup',...(isExplicitlyEnabled(s,'show_delivery_address')?['Delivery']:[])]);
  const allowedPayments=new Set([...(isExplicitlyEnabled(s,'show_qr_payment')&&!!String(s.qr_image_url||'').trim()?['QR Payment']:[]),...(isExplicitlyEnabled(s,'show_cash_payment')?['Cash on Delivery / Pickup']:[])]);
  if(!allowedFulfillment.has(d.fulfillment)){checkoutError('That fulfillment method is no longer available. Please choose another option.');return}
  if(!allowedPayments.has(d.payment)){checkoutError('That payment method is no longer available. Please choose another option.');return}
  clearFieldErrors(f);
  const phone=String(d.phone||'').trim();
  const email=String(d.email||'').trim().toLowerCase();
  const problems=[];
  if(String(d.name||'').trim().length<2)problems.push(['name','Please enter the name we should put on this order.']);
  /* Mirrors what the shop set. place_order checks the same thing, since a check in
     the browser is a courtesy rather than a guarantee. */
  if(f.elements.phone?.required&&!phone)problems.push(['phone','Please enter your mobile number.']);
  if(f.elements.email?.required&&!email)problems.push(['email','Please enter your email address.']);
  if(phone&&!/^(?:09\d{9}|\+639\d{9})$/.test(phone))problems.push(['phone','Enter a Philippine mobile number as 09XXXXXXXXX or +639XXXXXXXXX.']);
  /* Caught here as well as in place_order, so a typo is a highlighted field rather
     than a rejected order. A confirmation can only ever be as good as the address. */
  if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))problems.push(['email','Check this email address, or leave it blank.']);
  if(d.fulfillment==='Delivery'&&String(d.address||'').trim().length<10)problems.push(['address','Please enter a complete delivery address, including street and barangay.']);
  const dateInput=f.elements.preferredDate;
  if(dateInput&&dateInput.type==='date'){
    if(!String(d.preferredDate||'').trim())problems.push(['preferredDate','Please choose the date you want this order for.']);
    else if(dateInput.min&&String(d.preferredDate)<dateInput.min)problems.push(['preferredDate',`Please choose a date on or after ${dateInput.min}.`]);
  }
  if(!f.confirm?.checked)problems.push(['confirm','Please confirm that your order and contact details are correct.']);
  if(problems.length){problems.forEach(([field,message])=>fieldError(f,field,message));checkoutError('Please fix the highlighted fields and place your order again.');f.elements[problems[0][0]]?.focus();return}
  const isQr=d.payment==='QR Payment';const receiptFile=isQr?f._receiptPrepared:null;if(isQr&&!receiptFile){checkoutError('Please upload a JPG, PNG, WEBP, or PDF payment receipt before placing the order.');return}
  f.dataset.submitting='true';btn.disabled=true;btn.textContent='Creating order…';if(progress)progress.textContent='Creating order…';
  try{
    const live=await fetchLiveProducts();const invalid=validateCartAgainstLive(live);if(invalid.length){checkoutError('Your cart changed while you were checking out. Please review it again.');$('checkoutDialog').close();openCart();toast('Cart updated. Please review before checkout.');return}
    const fulfillment=d.fulfillment;const address=fulfillment==='Delivery'?String(d.address||'').trim()||null:null;
    if(fulfillment==='Delivery'&&!address){checkoutError('Delivery address is required.');f.address?.focus();return}
    const showPreferredDate=isExplicitlyEnabled(s,'show_preferred_date');const preferredDateMode=s.preferred_date_mode||'calendar';const availableFrom=s.order_available_from||'';
    let preferredDate=d.preferredDate||availableFrom||new Date().toISOString().slice(0,10);if(showPreferredDate&&preferredDateMode==='calendar'&&availableFrom&&preferredDate<availableFrom)throw new Error('Please select a date on or after the available-from date.');
    const items=state.cart.map(i=>({product_id:i.productId,qty:i.qty}));
    const {data,error}=await db.rpc('place_order',{p_customer_name:String(d.name||'').trim(),p_phone:phone||null,p_email:email||null,p_fulfillment:fulfillment,p_address:address,p_preferred_date:preferredDate,p_payment_method:d.payment,p_note:String(d.note||'').trim()||null,p_items:items});
    if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Order could not be placed.');const order=data.order;
    /* The order is in the database now. Everything below is bookkeeping the
       customer has no reason to wait behind, so none of it blocks the receipt.
       The upload was awaited before, even though mode:'no-cors' makes its
       response unreadable — the wait bought nothing but a slower checkout. */
    if(isQr&&receiptFile)uploadReceiptToGoogleDrive(order,receiptFile,f._receiptBase64).catch(err=>console.warn('Receipt upload failed:',err));
    syncOrderToGoogleSheet(order);
    localStorage.setItem(LS.latestOrder,JSON.stringify(order));localStorage.setItem(LS.lastOrderAt,String(Date.now()));
    state.cart=[];saveCart();$('checkoutDialog').close();
    showOrder(order);toast(`Order #${order.order_code} placed ✓`);track('order_placed');
    /* Refresh stock in the background; the confirmation is already on screen. */
    bootstrap().catch(err=>console.warn('Post-order refresh failed:',err))
  }catch(err){console.error(err);checkoutError(err?.message||'Unable to place your order. Please check your connection and try again.')}finally{delete f.dataset.submitting;btn.disabled=false;btn.textContent='Place Order';if(progress)progress.textContent=''}
}
function showOrder(order){
  const cancelled=order.status==='Cancelled';
  $('orderDialog').innerHTML=`<div class="modal-body"><button class="icon-btn modal-close" aria-label="Close" onclick="orderDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><span class="order-status">${cancelled?'Order cancelled':'Order confirmed'}</span><h2>#${esc(order.order_code)}</h2><p>${new Date(order.created_at).toLocaleString()}</p><div class="summary">${(order.items||[]).map(i=>`<div class="summary-row"><span>${esc(i.product_name)} × ${i.qty}</span><strong>${money(i.unit_price*i.qty)}</strong></div>`).join('')}<hr><div class="summary-row"><strong>Total</strong><strong>${money(order.total)}</strong></div><p>${esc(order.fulfillment)} · ${esc(order.preferred_date)} · ${esc(order.payment_method)}</p></div>${cancelled&&order.cancellation_reason?`<div class="status-banner" style="margin-top:14px"><strong>Cancellation reason:</strong> ${esc(order.cancellation_reason)}</div>`:''}<div class="contact-actions" style="margin-top:16px"><button class="secondary-btn" id="copyOrderNo">Copy Order Number</button><button class="secondary-btn" id="messageUsBtn">Message us</button><button class="primary-btn" id="continueBtn">Continue Shopping</button></div><p class="muted" style="margin:12px 0 0;font-size:var(--text-caption)">Need to change or cancel this order? Message us and we will sort it out.</p></div>`;
  $('orderDialog').showModal();
  $('copyOrderNo').onclick=async()=>{try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(order.order_code);else{const ta=document.createElement('textarea');ta.value=order.order_code;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}toast('Copied ✓')}catch{toast(`Order #${order.order_code}`)}};
  $('continueBtn').onclick=()=>$('orderDialog').close();
  /* Cancelling is no longer self-service: the customer talks to the store instead. */
  $('messageUsBtn').onclick=()=>{$('orderDialog').close();if(window.BilihanSupport?.open)window.BilihanSupport.open();else toast('Chat is loading. Please try again in a moment.')};
}
async function retryPendingCancel(){if(!window.BILIHAN_SUPABASE_CONFIGURED)return;const raw=localStorage.getItem(LS.pendingCancel);if(!raw)return;const p=safeJsonParse(raw,null);if(!p?.order?.order_code){localStorage.removeItem(LS.pendingCancel);return}try{const {data,error}=await db.rpc('cancel_order',{p_order_code:p.order.order_code,p_cancel_token:p.order.cancel_token,p_reason:p.reason,p_requested_at:p.requestedAt});if(error)throw error;if(data?.ok){localStorage.removeItem(LS.pendingCancel);const updated={...p.order,status:'Cancelled',cancellation_reason:p.reason};localStorage.setItem(LS.latestOrder,JSON.stringify(updated))}}catch(e){console.warn('Pending cancellation still waiting',e)}}
function renderLatestOrderButton(){
  const o=safeJsonParse(localStorage.getItem(LS.latestOrder),null);
  [$('myOrderBtn'),$('myOrderBtnMobile')].forEach(btn=>{
    if(!btn)return;
    btn.classList.toggle('hidden',!o);
    btn.onclick=()=>{if(o)showOrder(safeJsonParse(localStorage.getItem(LS.latestOrder),o))};
  });
}
function syncThemeIcon(){const dark=document.documentElement.dataset.theme==='dark';document.documentElement.style.colorScheme=dark?'dark':'light';const icon=$('themeIcon');if(icon)icon.src=dark?'ios-icons/light-mode.png':'ios-icons/dark-mode.png';$('themeToggle').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');$('themeToggle').setAttribute('aria-pressed',String(dark));syncThemeColor()}document.documentElement.dataset.theme=localStorage.getItem(LS.theme)||'light';syncThemeIcon();$('themeToggle').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem(LS.theme,dark?'light':'dark');syncThemeIcon()};
window.addEventListener('offline',()=>{state.online=false;renderConnection()});window.addEventListener('online',()=>bootstrap());
bootstrap();