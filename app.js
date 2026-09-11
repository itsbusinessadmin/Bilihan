const GOOGLE_SHEETS_WEB_APP_URL = (window.BILIHAN_CONFIG||{}).GOOGLE_SHEETS_WEB_APP_URL || '';
const LS = { cart:'bilihan_cart_v3', theme:'bilihan_theme_v3', latestOrder:'bilihan_latest_order_v3', cache:'bilihan_cache_v3', pendingCancel:'bilihan_pending_cancel_v3', productView:'bilihan_product_view_v1', lastOrderAt:'bilihan_last_order_at_v1' };
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
function renderAll(){renderSettings();renderCategories();renderViewSwitch();renderProducts();renderCart();renderLatestOrderButton();renderConnection()}
function renderConnection(){
  const b=$('connectionBanner');
  if(!window.BILIHAN_SUPABASE_CONFIGURED){b.textContent=window.BILIHAN_SUPABASE_LIB_MISSING?'We could not reach our ordering system. You are browsing a saved copy of the menu, and checkout is disabled until the connection returns.':'Store database is not connected yet. Browsing demo/cache only; checkout is disabled.';b.classList.remove('hidden');return}
  if(!state.online){b.textContent='Ordering is temporarily unavailable. You can still browse our cached menu while we reconnect. ';const btn=document.createElement('button');btn.className='secondary-btn';btn.textContent='Try Again';btn.onclick=bootstrap;b.replaceChildren(document.createTextNode(b.textContent),btn);b.classList.remove('hidden')} else b.classList.add('hidden')
}
function renderSettings(){
  const s=state.data.settings||FALLBACK.settings;
  const name=realSetting(s.business_name)||'Bilihan';
  const logo=s.logo_url||'bilihan-mark.webp';
  $('brandName').textContent=$('footerBrand').textContent=name;
  document.querySelectorAll('.footer-copy-name').forEach(el=>{el.textContent=name});
  document.title=`${name} — ${TITLE_SUFFIX}`;
  document.querySelectorAll('img[data-store-logo]').forEach(img=>{img.src=logo});
  $('heroTitle').textContent=s.hero_title;$('heroTagline').textContent=s.hero_tagline;$('aboutText').textContent=s.about_text;
  $('aboutImage').onerror=()=>{$('aboutImage').src='bilihan-logo.png';$('aboutImage').onerror=null};$('aboutImage').src=s.about_image_url||'bilihan-logo.png';
  $('aboutImage').alt=`A selection of the food available at ${name}`;
  renderContact(s);
  $('year').textContent=new Date().getFullYear();
  renderHero();
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
  const nav=$('mobileNavContact');if(nav)nav.innerHTML=html;
}
function renderHero(){const imgs=state.data.settings?.hero_images||[];if(!imgs.length){$('heroImage').src='bilihan-logo.png';$('heroDots').innerHTML='';return}$('heroImage').onerror=()=>{$('heroImage').src='bilihan-logo.png';$('heroImage').onerror=null};$('heroImage').src=imgs[state.heroIndex%imgs.length];$('heroDots').innerHTML=imgs.length>1?imgs.map((_,i)=>`<button class="${i===state.heroIndex?'active':''}" data-i="${i}" aria-label="Show featured image ${i+1}" aria-current="${i===state.heroIndex?'true':'false'}"></button>`).join(''):'';[...$('heroDots').children].forEach(b=>b.onclick=()=>{state.heroIndex=+b.dataset.i;renderHero()})}
setInterval(()=>{if(state.data&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const n=state.data.settings?.hero_images?.length||1;state.heroIndex=(state.heroIndex+1)%n;renderHero()}},4000);
function visibleCategories(){return (state.data.categories||[]).filter(c=>(state.data.products||[]).some(p=>p.category_id===c.id)).sort((a,b)=>a.sort_order-b.sort_order)}
function renderCategories(){const cats=visibleCategories();$('categoryTabs').innerHTML=[{id:'all',name:'All'},...cats].map(c=>`<button class="tab ${state.category===c.id?'active':''}" type="button" role="tab" aria-selected="${state.category===c.id?'true':'false'}" data-id="${c.id}">${esc(c.name)}</button>`).join('');[...$('categoryTabs').children].forEach(b=>b.onclick=()=>{state.category=b.dataset.id;renderCategories();renderProducts()})}
function renderViewSwitch(){const grid=$('gridViewBtn'),list=$('listViewBtn'),menu=$('menuGrid');if(!grid||!list||!menu)return;const isList=state.productView==='list';menu.classList.toggle('list-view',isList);grid.classList.toggle('active',!isList);list.classList.toggle('active',isList);grid.setAttribute('aria-pressed',String(!isList));list.setAttribute('aria-pressed',String(isList));grid.onclick=()=>setProductView('grid');list.onclick=()=>setProductView('list')}
function setProductView(view){state.productView=view==='list'?'list':'grid';localStorage.setItem(LS.productView,state.productView);renderViewSwitch()}
function renderProducts(){const showStock=state.data.settings?.show_stock!==false;const ps=(state.data.products||[]).filter(p=>state.category==='all'||p.category_id===state.category).sort((a,b)=>a.sort_order-b.sort_order);const allSold=ps.length&&ps.every(p=>!p.is_available||p.stock<=0);const empty=!ps.length?'<div class="empty-state"><h3>No products here yet</h3><p>Try another category or check back soon.</p></div>':'';$('menuGrid').innerHTML=empty+(allSold?'<div class="status-banner" style="grid-column:1/-1">We’re currently sold out. Please check back again soon!</div>':'')+ps.map(p=>{const sold=!p.is_available||p.stock<=0;const stock=sold?'Sold Out':p.stock<=5?`Only ${p.stock} left!`:`${p.stock} available`;const stockHtml=(showStock||sold)?`<div class="stock ${sold?'sold':''}">${stock}</div>`:'';const addButton=sold?'':`<button class="product-card-add" type="button" data-add-id="${p.id}" aria-label="Add ${esc(p.name)} to cart" title="Add to cart"><img class="ui-icon" src="ios-icons/add-to-cart.png" alt="" aria-hidden="true"></button>`;return `<article class="product-card" data-id="${p.id}"><img class="product-card-image" loading="lazy" src="${esc(p.image_url||'bilihan-logo.png')}" onerror="this.onerror=null;this.src='bilihan-logo.png'" alt="${esc(p.name)}"><div class="product-info"><div class="product-row"><strong>${esc(p.name)}</strong><span class="price">${money(p.price)}</span></div><div class="product-card-bottom">${stockHtml}${addButton}</div></div></article>`}).join('');document.querySelectorAll('.product-card').forEach(c=>c.onclick=()=>openProduct(c.dataset.id));document.querySelectorAll('.product-card-add').forEach(b=>b.onclick=e=>quickAddToCart(b.dataset.addId,e))}
function quickAddToCart(id,event){event?.stopPropagation();const p=state.data.products.find(x=>x.id===id);if(!p||!p.is_available||p.stock<=0)return;const ex=state.cart.find(x=>x.productId===id);const current=ex?.qty||0;if(current>=p.stock){toast('Maximum available stock reached');return}if(ex)ex.qty+=1;else state.cart.push({productId:id,qty:1,price:+p.price,name:p.name,image:p.image_url});saveCart();const btn=event?.currentTarget;if(btn){btn.classList.add('added');setTimeout(()=>btn.classList.remove('added'),350)}toast('Added to cart ✓')}
function openProduct(id){const showStock=state.data.settings?.show_stock!==false;const p=state.data.products.find(x=>x.id===id);if(!p){toast('This product is no longer available.');renderProducts();return}const inCart=state.cart.find(x=>x.productId===id)?.qty||0;const max=Math.max(0,p.stock-inCart);const sold=!p.is_available||p.stock<=0;const cat=state.data.categories.find(c=>c.id===p.category_id)?.name||'';$('productDialog').innerHTML=`<div class="modal-body"><button class="icon-btn modal-close" aria-label="Close" onclick="productDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><div class="product-modal-grid"><img class="product-modal-image" src="${esc(p.image_url||'bilihan-logo.png')}" onerror="this.onerror=null;this.src='bilihan-logo.png'" alt="${esc(p.name)}"><div><span class="eyebrow">${esc(cat)}</span><h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><h3>${money(p.price)}</h3>${(showStock||sold)?`<p class="stock ${sold?'sold':''}">${sold?'Sold Out':p.stock<=5?`Only ${p.stock} left!`:`${p.stock} available`}</p>`:''}${sold?'<button class="primary-btn" disabled>Sold Out</button>':max<=0?'<p class="muted">You already have the maximum available quantity in your cart.</p>':`<div class="qty"><button id="qMinus" aria-label="Decrease quantity"><img class="ui-icon" src="ios-icons/minus.png" alt="" aria-hidden="true"></button><strong id="qVal">1</strong><button id="qPlus" aria-label="Increase quantity"><img class="ui-icon" src="ios-icons/plus.png" alt="" aria-hidden="true"></button></div><br><button id="addToCart" class="primary-btn icon-only-action" aria-label="Add to cart" title="Add to cart"><img class="ui-icon" src="ios-icons/add-to-cart.png" alt="" aria-hidden="true"></button>`}</div></div></div>`;$('productDialog').showModal();let q=1;if($('qMinus')){$('qMinus').onclick=()=>{q=Math.max(1,q-1);$('qVal').textContent=q};$('qPlus').onclick=()=>{q=Math.min(max,q+1);$('qVal').textContent=q};$('addToCart').onclick=()=>{const ex=state.cart.find(x=>x.productId===id);if(ex)ex.qty+=q;else state.cart.push({productId:id,qty:q,price:+p.price,name:p.name,image:p.image_url});saveCart();$('productDialog').close();toast('Added to cart ✓')}}}
function renderCart(){
  $('cartCount').textContent=state.cart.reduce((s,i)=>s+i.qty,0);
  if(!state.cart.length){$('cartItems').innerHTML='<div style="text-align:center;padding:60px 20px"><h3>Your cart is empty</h3><button class="secondary-btn" id="browseBtn">Browse Menu</button></div>';$('cartFooter').innerHTML='';setTimeout(()=>$('browseBtn')&&($('browseBtn').onclick=closeCart),0);return}
  $('cartItems').innerHTML=state.cart.map((i,idx)=>`<div class="cart-item"><img src="${esc(i.image||'bilihan-logo.png')}" width="72" height="72" loading="lazy" alt="${esc(i.name)}" onerror="this.onerror=null;this.src='bilihan-logo.png'"><div class="cart-item-main"><strong>${esc(i.name)}</strong><span>${money(i.price)}</span><div class="cart-controls"><button class="qty-btn" data-a="minus" data-i="${idx}" aria-label="Decrease ${esc(i.name)} quantity"><img class="ui-icon" src="ios-icons/minus.png" alt="" aria-hidden="true"></button><span class="qty-value">${i.qty}</span><button class="qty-btn" data-a="plus" data-i="${idx}" aria-label="Increase ${esc(i.name)} quantity"><img class="ui-icon" src="ios-icons/plus.png" alt="" aria-hidden="true"></button><button class="remove-btn icon-remove-btn" data-a="remove" data-i="${idx}" aria-label="Remove ${esc(i.name)} from cart" title="Remove"><img class="ui-icon" src="ios-icons/trash.png" alt="" aria-hidden="true"></button></div></div></div>`).join('');
  const total=state.cart.reduce((s,i)=>s+i.qty*i.price,0);$('cartFooter').innerHTML=`<div class="summary-row"><strong>Total</strong><strong>${money(total)}</strong></div><button id="checkoutBtn" class="primary-btn" style="width:100%">Checkout</button>`;
  $('cartItems').querySelectorAll('button').forEach(b=>b.onclick=()=>cartAction(b.dataset.a,+b.dataset.i));$('checkoutBtn').onclick=openCheckout;
}
async function cartAction(a,i){const item=state.cart[i];if(a==='minus')item.qty=Math.max(1,item.qty-1);if(a==='plus'){const p=state.data.products.find(p=>p.id===item.productId);if(item.qty<(p?.stock||0))item.qty++;else toast('Maximum available stock reached')}if(a==='remove'&&confirm('Remove this item from your cart?'))state.cart.splice(i,1);saveCart()}
function openCart(){closeMobileNav();const d=$('cartDrawer');d.classList.add('open');d.setAttribute('aria-hidden','false');d.removeAttribute('inert');$('backdrop').classList.remove('hidden');$('closeCart').focus()}
function closeCart(){const d=$('cartDrawer');d.classList.remove('open');d.setAttribute('aria-hidden','true');d.setAttribute('inert','');$('backdrop').classList.add('hidden')}
$('cartBtn').onclick=openCart;$('closeCart').onclick=closeCart;$('backdrop').onclick=()=>{closeCart();closeMobileNav()};
$('cartDrawer').setAttribute('inert','');

/* ---- Mobile navigation (the desktop nav is hidden below 820px) ---- */
function mobileNavOpen(){return $('menuBtn')?.getAttribute('aria-expanded')==='true'}
function openMobileNav(){closeCart();$('mobileNav').hidden=false;requestAnimationFrame(()=>$('mobileNav').classList.add('open'));$('menuBtn').setAttribute('aria-expanded','true');$('menuBtn').setAttribute('aria-label','Close menu');$('backdrop').classList.remove('hidden')}
function closeMobileNav(){const nav=$('mobileNav');if(!nav||nav.hidden)return;nav.classList.remove('open');nav.hidden=true;$('menuBtn').setAttribute('aria-expanded','false');$('menuBtn').setAttribute('aria-label','Open menu');if(!$('cartDrawer').classList.contains('open'))$('backdrop').classList.add('hidden')}
if($('menuBtn'))$('menuBtn').onclick=()=>mobileNavOpen()?closeMobileNav():openMobileNav();
if($('mobileNav'))$('mobileNav').addEventListener('click',e=>{if(e.target.closest('a'))closeMobileNav()});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(mobileNavOpen())closeMobileNav();if($('cartDrawer').classList.contains('open'))closeCart()});
addEventListener('resize',()=>{if(innerWidth>820)closeMobileNav()});
function validateCartAgainstLive(liveProducts){let changed=false, invalid=[];for(const item of state.cart){const p=liveProducts.find(x=>x.id===item.productId);if(!p){invalid.push(`${item.name} is no longer available.`);changed=true;continue}if(!p.is_available||p.stock<item.qty){invalid.push(`${item.name} no longer has enough stock.`);changed=true}if(+p.price!==+item.price){item.price=+p.price;invalid.push(`${item.name} price was updated.`);changed=true}}if(changed)saveCart();return invalid}
async function fetchLiveProducts(){const {data,error}=await db.from('products').select('*');if(error)throw error;return data}
async function syncOrderToGoogleSheet(order){try{if(!GOOGLE_SHEETS_WEB_APP_URL)return;const items=(order.items||[]).map(i=>`${i.product_name} x ${i.qty}`).join(', ');const payload={order_id:order.id||order.order_id||order.order_code,order_code:order.order_code||'',order_date:order.created_at||new Date().toISOString(),customer_name:order.customer_name||'',phone:order.phone||'',fulfillment:order.fulfillment||'',address:order.address||'',preferred_date:order.preferred_date||'',payment_method:order.payment_method||'',items:items,subtotal:Number(order.subtotal??order.total??0),delivery_fee:Number(order.delivery_fee||0),total:Number(order.total||0),payment_status:order.payment_status||'Pending',order_status:order.status||'Pending',cancellation_reason:order.cancellation_reason||''};await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)})}catch(err){console.warn('Google Sheets sync failed:',err)}}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Unable to read receipt file.'));reader.readAsDataURL(file)})}
function formatFileSize(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(0)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`}
async function compressReceiptImage(file){const allowed=['image/jpeg','image/png','image/webp','application/pdf'];if(!allowed.includes(file.type))throw new Error('Receipt must be JPG, PNG, WEBP, or PDF.');if(file.type==='application/pdf'){if(file.size>3*1024*1024)throw new Error('PDF receipt must be 3 MB or smaller.');return file}if(file.size>12*1024*1024)throw new Error('Receipt image is too large. Please use an image smaller than 12 MB.');const bitmap=await createImageBitmap(file);const maxSide=1400;const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));const width=Math.max(1,Math.round(bitmap.width*scale));const height=Math.max(1,Math.round(bitmap.height*scale));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(bitmap,0,0,width,height);bitmap.close?.();const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to optimize receipt image.')),'image/jpeg',0.72));const baseName=(file.name||'receipt').replace(/\.[^.]+$/,'');return new File([blob],`${baseName}.jpg`,{type:'image/jpeg',lastModified:Date.now()})}
async function uploadReceiptToGoogleDrive(order,file){if(!order?.order_code)throw new Error('Order number is missing.');if(!file)throw new Error('Please upload your payment receipt.');const file_base64=await fileToBase64(file);const payload={action:'upload_receipt',order_code:order.order_code,file_name:file.name,mime_type:file.type,file_base64};const response=await fetch(GOOGLE_SHEETS_WEB_APP_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),cache:'no-store'});return response}
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
  $('checkoutDialog').innerHTML=`<div class="modal-body checkout-modal"><button class="icon-btn modal-close" aria-label="Close" onclick="checkoutDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><div class="checkout-heading"><h2>Complete your order</h2><p>Review your contact, fulfillment, and payment details before placing the order.</p></div><div id="checkoutError" class="status-banner hidden" role="alert" aria-live="assertive"></div><form id="checkoutForm" class="checkout-form" novalidate><div class="hp-field" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div><div class="checkout-layout"><div class="checkout-main"><section class="checkout-group" aria-labelledby="checkoutContactTitle"><div class="checkout-group-title"><h3 id="checkoutContactTitle">Contact</h3></div><div class="form-grid"><label class="field"><span class="field-label">Name *</span><input name="name" maxlength="100" autocomplete="name" required></label><label class="field"><span class="field-label">Mobile number <span class="muted">(optional)</span></span><input name="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="09XXXXXXXXX"></label></div></section><section class="checkout-group" aria-labelledby="checkoutFulfillmentTitle"><div class="checkout-group-title"><h3 id="checkoutFulfillmentTitle">Fulfillment</h3></div><div class="form-grid">${fulfillmentField}${preferredDateField}<label id="addressField" class="field full"><span class="field-label">Delivery address *</span><textarea name="address" maxlength="500" autocomplete="street-address" rows="2"></textarea></label><div id="pickupInfo" class="field full hidden"><div class="status-banner" style="margin:0"><strong>Pickup location:</strong> ${esc(s.pickup_location||'Please contact the store for the pickup location.')}</div></div></div></section><section class="checkout-group" aria-labelledby="checkoutPaymentTitle"><div class="checkout-group-title"><h3 id="checkoutPaymentTitle">Payment</h3></div><div class="form-grid">${paymentField}<label class="field checkout-note"><span class="field-label">Customer note <span class="muted">(optional)</span></span><textarea name="note" maxlength="500" rows="2" placeholder="Anything the store should know?"></textarea></label><div id="paymentInfo" class="field full"></div></div></section></div><aside class="checkout-aside" aria-labelledby="checkoutSummaryTitle"><div class="checkout-aside-inner"><div class="checkout-group-title"><h3 id="checkoutSummaryTitle">Your order</h3></div><div class="summary" id="checkoutSummary"></div><div class="checkout-actions"><label class="checkout-confirm"><input type="checkbox" name="confirm" id="confirmOrder" required><span>I confirm that my order and contact details are correct.</span></label><button class="primary-btn" id="placeOrderBtn" disabled>Place Order</button><p class="muted checkout-progress" id="orderProgress" role="status" aria-live="polite"></p></div></div></aside></div></form></div>`;
  $('checkoutDialog').showModal();
  const f=$('checkoutForm');
  f._receiptPrepared=null;f._receiptPreparing=false;f.dataset.openedAt=String(Date.now());
  const updatePlaceOrderButton=()=>{const qr=f.payment.value==='QR Payment';const hasReceipt=!qr||!!f._receiptPrepared;const confirmed=$('confirmOrder')?.checked;$('placeOrderBtn').disabled=!!f._receiptPreparing||!(hasReceipt&&confirmed)};
  const renderDynamic=()=>{
    checkoutError('');
    const pickup=f.fulfillment.value==='Pickup';
    $('addressField').classList.toggle('hidden',pickup);$('pickupInfo').classList.toggle('hidden',!pickup);f.address.required=!pickup;
    f._receiptPrepared=null;f._receiptPreparing=false;
    if(f.payment.value==='QR Payment'){
      const qrUrl=String(s.qr_image_url||'').trim();
      if(!qrUrl){checkoutError('QR payment is no longer available. Please choose another payment method.');updatePlaceOrderButton();return}
      $('paymentInfo').innerHTML=`<div class="qr-payment-card"><div id="qrImageState"><img id="paymentQrImage" src="${esc(qrUrl)}" alt="Store payment QR code"></div><div class="qr-payment-actions"><p><strong>Pay by QR</strong><br><span class="muted">Scan or save the code, then upload your payment receipt.</span></p><a class="secondary-btn" href="${esc(qrUrl)}" download="Bilihan-QR-Code" target="_blank" rel="noopener">Save QR Code</a><label class="field"><strong>Payment receipt *</strong><input name="receipt" id="paymentReceipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><p class="muted" id="receiptStatus" role="status" aria-live="polite">No receipt selected yet.</p></div></div>`;
      const qrImg=$('paymentQrImage');if(qrImg)qrImg.onerror=()=>{$('qrImageState').innerHTML='<div class="status-banner" role="alert">The payment QR code could not be loaded. Please choose another payment method.</div>'};
      const receipt=$('paymentReceipt');receipt.onchange=async()=>{const file=receipt.files[0];f._receiptPrepared=null;if(!file){$('receiptStatus').textContent='No receipt selected yet.';updatePlaceOrderButton();return}f._receiptPreparing=true;$('receiptStatus').textContent='Preparing receipt…';updatePlaceOrderButton();try{const prepared=await compressReceiptImage(file);f._receiptPrepared=prepared;$('receiptStatus').textContent=`Receipt ready: ${prepared.name} (${formatFileSize(prepared.size)})`}catch(err){receipt.value='';f._receiptPrepared=null;$('receiptStatus').textContent=err.message||'Unable to prepare this receipt. Please choose a JPG, PNG, WEBP, or PDF file.'}finally{f._receiptPreparing=false;updatePlaceOrderButton()}}
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
  const problems=[];
  if(String(d.name||'').trim().length<2)problems.push(['name','Please enter the name we should put on this order.']);
  if(phone&&!/^(?:09\d{9}|\+639\d{9})$/.test(phone))problems.push(['phone','Enter a Philippine mobile number as 09XXXXXXXXX or +639XXXXXXXXX.']);
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
    const {data,error}=await db.rpc('place_order',{p_customer_name:String(d.name||'').trim(),p_phone:phone||null,p_fulfillment:fulfillment,p_address:address,p_preferred_date:preferredDate,p_payment_method:d.payment,p_note:String(d.note||'').trim()||null,p_items:items});
    if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Order could not be placed.');const order=data.order;
    if(isQr&&receiptFile){btn.textContent='Uploading receipt…';if(progress)progress.textContent=`Uploading receipt for Order #${order.order_code}…`;await uploadReceiptToGoogleDrive(order,receiptFile)}
    btn.textContent='Finalizing…';if(progress)progress.textContent='Finalizing order…';syncOrderToGoogleSheet(order);localStorage.setItem(LS.latestOrder,JSON.stringify(order));localStorage.setItem(LS.lastOrderAt,String(Date.now()));state.cart=[];saveCart();$('checkoutDialog').close();await bootstrap();showOrder(order);toast(`Order #${order.order_code} placed ✓`);track('order_placed')
  }catch(err){console.error(err);checkoutError(err?.message||'Unable to place your order. Please check your connection and try again.')}finally{delete f.dataset.submitting;btn.disabled=false;btn.textContent='Place Order';if(progress)progress.textContent=''}
}
function showOrder(order){
  const cancelled=order.status==='Cancelled';
  $('orderDialog').innerHTML=`<div class="modal-body"><button class="icon-btn modal-close" aria-label="Close" onclick="orderDialog.close()"><img class="ui-icon" src="ios-icons/close.png" alt="" aria-hidden="true"></button><span class="order-status">${cancelled?'Order cancelled':'Order confirmed'}</span><h2>#${esc(order.order_code)}</h2><p>${new Date(order.created_at).toLocaleString()}</p><div class="summary">${(order.items||[]).map(i=>`<div class="summary-row"><span>${esc(i.product_name)} × ${i.qty}</span><strong>${money(i.unit_price*i.qty)}</strong></div>`).join('')}<hr><div class="summary-row"><strong>Total</strong><strong>${money(order.total)}</strong></div><p>${esc(order.fulfillment)} · ${esc(order.preferred_date)} · ${esc(order.payment_method)}</p></div><div class="contact-actions" style="margin-top:16px"><button class="secondary-btn" id="copyOrderNo">Copy Order Number</button>${!cancelled?'<button class="danger-btn" id="cancelOrderBtn">Cancel Order</button>':'<button class="secondary-btn" disabled>Order Cancelled</button>'}<button class="primary-btn" id="continueBtn">Continue Shopping</button></div><div id="cancelState" aria-live="polite"></div></div>`;
  $('orderDialog').showModal();
  $('copyOrderNo').onclick=async()=>{try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(order.order_code);else{const ta=document.createElement('textarea');ta.value=order.order_code;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}toast('Copied ✓')}catch{toast(`Order #${order.order_code}`)}};
  $('continueBtn').onclick=()=>$('orderDialog').close();
  if($('cancelOrderBtn')){const deadline=new Date(order.created_at).getTime()+3*60*60*1000;if(Date.now()>deadline)$('cancelOrderBtn').disabled=true;else $('cancelOrderBtn').onclick=()=>cancelOrder(order)}
}
function cancelOrder(order){
  const host=$('cancelState');if(!host)return;
  host.innerHTML=`<form id="cancelOrderForm" class="cancel-form"><strong>Cancel this order?</strong><p class="muted" style="margin:.35rem 0 0">Tell us why so the store has the right context.</p><label class="field"><span>Reason *</span><textarea name="reason" maxlength="500" required placeholder="Reason for cancellation"></textarea></label><div class="cancel-form-actions"><button type="button" class="secondary-btn" id="keepOrderBtn">Keep Order</button><button type="submit" class="danger-btn">Confirm Cancellation</button></div></form>`;
  $('keepOrderBtn').onclick=()=>{host.innerHTML=''};
  $('cancelOrderForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;clearFieldErrors(form);
    const reason=String(new FormData(form).get('reason')||'').trim();
    if(reason.length<5){fieldError(form,'reason','Please tell us briefly why you are cancelling (at least 5 characters).');form.reason.focus();return}
    await submitCancellation(order,reason);
  };
  $('cancelOrderForm').reason?.focus();
}
async function submitCancellation(order,reason){
  const host=$('cancelState');
  try{
    if(host)host.innerHTML='<div class="status-banner">Cancelling order…</div>';
    const {data,error}=await db.rpc('cancel_order',{p_order_code:order.order_code,p_cancel_token:order.cancel_token,p_reason:reason,p_requested_at:new Date().toISOString()});
    if(error)throw error;
    /* A refusal from the server (window expired, wrong token) is a final answer, not a
       connection problem — queueing it for retry would loop forever. */
    if(!data?.ok){const rejected=new Error(data?.error||'This order can no longer be cancelled online. Please contact the store.');rejected.rejected=true;throw rejected}
    const updated={...order,status:'Cancelled',cancellation_reason:reason,cancelled_at:new Date().toISOString()};
    localStorage.setItem(LS.latestOrder,JSON.stringify(updated));await bootstrap();showOrder(updated);toast('Order cancelled');track('order_cancelled');
    if(order.payment_method==='QR Payment'){$('cancelState').innerHTML='<div class="status-banner">If you already sent payment, contact the store through Messenger or Instagram regarding your refund.</div>'}
  }catch(e){
    if(e?.rejected){if(host)host.innerHTML=`<div class="status-banner" role="alert">${esc(e.message)}</div>`;toast('Could not cancel this order');return}
    const pending={order,reason,requestedAt:new Date().toISOString()};localStorage.setItem(LS.pendingCancel,JSON.stringify(pending));
    if(host)host.innerHTML='<div class="status-banner" role="status">Cancellation queued. We will retry when your connection is available.</div>';toast('Cancellation queued')
  }
}
async function retryPendingCancel(){if(!window.BILIHAN_SUPABASE_CONFIGURED)return;const raw=localStorage.getItem(LS.pendingCancel);if(!raw)return;const p=safeJsonParse(raw,null);if(!p?.order?.order_code){localStorage.removeItem(LS.pendingCancel);return}try{const {data,error}=await db.rpc('cancel_order',{p_order_code:p.order.order_code,p_cancel_token:p.order.cancel_token,p_reason:p.reason,p_requested_at:p.requestedAt});if(error)throw error;if(data?.ok){localStorage.removeItem(LS.pendingCancel);const updated={...p.order,status:'Cancelled',cancellation_reason:p.reason};localStorage.setItem(LS.latestOrder,JSON.stringify(updated))}}catch(e){console.warn('Pending cancellation still waiting',e)}}
function renderLatestOrderButton(){
  const o=safeJsonParse(localStorage.getItem(LS.latestOrder),null);
  [$('myOrderBtn'),$('myOrderBtnMobile')].forEach(btn=>{
    if(!btn)return;
    btn.classList.toggle('hidden',!o);
    btn.onclick=()=>{closeMobileNav();if(o)showOrder(safeJsonParse(localStorage.getItem(LS.latestOrder),o))};
  });
}
function syncThemeIcon(){const dark=document.documentElement.dataset.theme==='dark';const icon=$('themeIcon');if(icon)icon.src=dark?'ios-icons/light-mode.png':'ios-icons/dark-mode.png';$('themeToggle').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');$('themeToggle').setAttribute('aria-pressed',String(dark));const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',dark?'#0d100e':'#faf8f3')}document.documentElement.dataset.theme=localStorage.getItem(LS.theme)||'light';syncThemeIcon();$('themeToggle').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem(LS.theme,dark?'light':'dark');syncThemeIcon()};
window.addEventListener('offline',()=>{state.online=false;renderConnection()});window.addEventListener('online',()=>bootstrap());
bootstrap();