(function(){
"use strict";
var sb = supabase.createClient(window.SHOP_CONFIG.supabaseUrl, window.SHOP_CONFIG.supabaseKey);
var peso = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
var $ = function(id){return document.getElementById(id)};
var esc = function(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML};
function pwField(id, autocomplete){
  return '<div class="pw-wrap">'+
    '<input id="'+id+'" type="password" required minlength="6" autocomplete="'+autocomplete+'">'+
    '<button type="button" class="pw-toggle" data-target="'+id+'" aria-label="Show password">Show</button>'+
  '</div>';
}
document.addEventListener('click', function(ev){
  var b = ev.target.closest('.pw-toggle');
  if(!b) return;
  var inp = $(b.getAttribute('data-target'));
  if(!inp) return;
  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  b.textContent = show ? 'Hide' : 'Show';
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

var state = {
  session: null,
  profile: null,       // {id, full_name, role, ...}
  products: [],         // active products (customer view)
  adminProducts: [],    // all products (admin view)
  deliveryZones: null,  // barangay -> fee lookup, loaded once per session
  cart: {}              // {product_id: qty}
};

/* ---------------- cart persistence (per-browser convenience only) ---------------- */
function loadCart(){
  try{ state.cart = JSON.parse(localStorage.getItem('shop_cart')||'{}'); }catch(e){ state.cart = {}; }
}
function saveCart(){
  try{ localStorage.setItem('shop_cart', JSON.stringify(state.cart)); }catch(e){}
  renderCartBadge();
}
function cartCount(){
  return Object.values(state.cart).reduce(function(a,b){return a+b},0);
}
function renderCartBadge(){
  var n = cartCount();
  var b = $('cart-count');
  b.hidden = n===0;
  b.textContent = n;
}

/* ---------------- toast ---------------- */
var toastTimer=null;
function toast(msg){
  var t=$('toast'); t.textContent=msg; t.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){t.hidden=true},2600);
}

/* ---------------- image lightbox ---------------- */
function openImageLightbox(src){
  var box = document.createElement('div');
  box.className = 'img-lightbox';
  box.innerHTML = '<img src="'+esc(src)+'" alt="">';
  box.addEventListener('click', function(){ box.remove(); });
  document.body.appendChild(box);
}

/* ---------------- data ---------------- */
function fetchProducts(){
  return sb.from('shop_products').select('*').eq('active',true).order('name')
    .then(function(r){ if(r.error) throw r.error; state.products = r.data||[]; });
}
function fetchAdminProducts(){
  return sb.from('shop_products').select('*').order('name')
    .then(function(r){ if(r.error) throw r.error; state.adminProducts = r.data||[]; });
}
function productById(id){
  return state.products.find(function(p){return p.id===id}) ||
         state.adminProducts.find(function(p){return p.id===id});
}
function fetchDeliveryZones(){
  if(state.deliveryZones) return Promise.resolve(state.deliveryZones);
  return sb.from('shop_delivery_zones').select('*').order('sort_order')
    .then(function(r){ if(r.error) throw r.error; state.deliveryZones = r.data||[]; return state.deliveryZones; });
}

/* ---------------- auth ---------------- */
function refreshProfile(){
  if(!state.session){ state.profile=null; return Promise.resolve(); }
  return sb.from('shop_profiles').select('*').eq('id',state.session.user.id).single()
    .then(function(r){ state.profile = r.data || null; });
}
function isAdmin(){ return !!(state.profile && state.profile.role==='admin'); }

function updateHeader(){
  document.querySelectorAll('[data-auth-only]').forEach(function(el){ el.hidden = !state.session; });
  document.querySelectorAll('[data-admin-only]').forEach(function(el){ el.hidden = !isAdmin(); });
  var acct = $('acct');
  if(state.session){
    var name = (state.profile && state.profile.full_name) || state.session.user.email;
    acct.innerHTML = 'Hi, '+esc(name)+' &middot; <button class="linklike" id="signout-btn">Sign out</button>';
    var b=$('signout-btn'); if(b) b.addEventListener('click', function(){ sb.auth.signOut(); });
  } else {
    acct.innerHTML = '<a href="#/login">Sign in</a>';
  }
  document.querySelectorAll('.site-nav a').forEach(function(a){
    a.classList.toggle('active', a.getAttribute('href')===location.hash || (a.getAttribute('href')==='#/'&&(location.hash===''||location.hash==='#/')));
  });
}

/* ---------------- router ---------------- */
function route(){
  var hash = location.hash.replace(/^#/,'') || '/';
  var app = $('app');
  app.innerHTML = '<p class="helper">Loading…</p>';
  updateHeader();
  if(hash==='/') return renderShop();
  if(hash==='/login') return renderLogin(false);
  if(hash==='/signup') return renderLogin(true);
  if(hash==='/forgot') return renderForgot();
  if(hash==='/reset') return renderReset();
  if(hash==='/checkout') return requireAuth(renderCheckout);
  if(hash==='/orders') return requireAuth(renderOrders);
  app.innerHTML = '<p class="empty">Page not found. <a href="#/">Back to shop</a></p>';
}
function requireAuth(fn){
  if(!state.session){ location.hash = '#/login'; return; }
  return fn();
}
function requireAdmin(fn){
  if(!state.session){ location.hash = '#/login'; return; }
  if(!isAdmin()){ $('app').innerHTML = '<p class="empty">This page is for shop admins only.</p>'; return; }
  return fn();
}

/* ---------------- shop (storefront) ---------------- */
function renderShop(){
  fetchProducts().then(function(){
    var app = $('app');
    app.innerHTML =
      '<div class="hero"><h1>Shop jT</h1><p>Everything in stock right now — order what you need, we confirm and deliver.</p></div>'+
      '<div class="grid" id="product-grid"></div>';
    var grid = $('product-grid');
    if(!state.products.length){
      grid.outerHTML = '<p class="empty">Nothing in stock right now. Check back soon.</p>';
      return;
    }
    grid.innerHTML = state.products.map(productCard).join('');
    grid.querySelectorAll('[data-add]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-add');
        var p = productById(id);
        var have = state.cart[id]||0;
        state.cart[id] = have+1;
        saveCart();
        if(have+1 > p.stock_qty){
          toast(p.stock_qty<=0 ? 'Pre-ordered '+p.name+' — ships once restocked' : 'Added '+p.name+' to cart (part will be a pre-order)');
        } else {
          toast('Added '+p.name+' to cart');
        }
      });
    });
  }).catch(function(e){ $('app').innerHTML = errBox(e); });
}
function productCard(p){
  var cls = p.stock_qty<=0?'zero':(p.stock_qty<=3?'low':'ok');
  var stockText = p.stock_qty<=0 ? 'Out of stock — pre-order available' : (p.stock_qty<=3 ? 'Only '+p.stock_qty+' left' : p.stock_qty+' in stock');
  return '<div class="card">'+
    '<div class="card-media">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="">':'📦')+'</div>'+
    '<div class="card-body">'+
      '<div class="card-name">'+esc(p.name)+'</div>'+
      (p.description?'<div class="card-desc">'+esc(p.description)+'</div>':'<div class="card-desc"></div>')+
      '<div class="card-row"><span class="price">'+peso.format(p.price)+'</span><span class="stockline '+cls+'">'+stockText+'</span></div>'+
      '<button class="btn '+(p.stock_qty<=0?'btn-outline':'btn-primary')+' btn-block" data-add="'+p.id+'">'+(p.stock_qty<=0?'Pre-order':'Add to cart')+'</button>'+
    '</div></div>';
}

/* ---------------- cart drawer ---------------- */
function renderCartDrawer(){
  var body = $('cart-body');
  var ids = Object.keys(state.cart).filter(function(id){return state.cart[id]>0});
  if(!ids.length){
    body.innerHTML = '<p class="empty">Your cart is empty.</p>';
    $('cart-total').textContent = peso.format(0);
    $('checkout-btn').disabled = true;
    return;
  }
  var total = 0;
  body.innerHTML = ids.map(function(id){
    var p = productById(id); if(!p) return '';
    var qty = state.cart[id];
    var sub = p.price*qty; total += sub;
    var preorderQty = Math.max(0, qty - p.stock_qty);
    return '<div class="cart-line">'+
      '<div class="cart-line-thumb">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="">':'📦')+'</div>'+
      '<div class="cart-line-info"><div class="name">'+esc(p.name)+'</div><div class="sub">'+peso.format(p.price)+' each</div>'+
        (preorderQty>0?'<div class="preorder-tag">'+(preorderQty===qty?'Pre-order':'Pre-order '+preorderQty+' of '+qty)+'</div>':'')+
      '</div>'+
      '<div class="qty-stepper">'+
        '<button data-dec="'+id+'" aria-label="Decrease">−</button>'+
        '<input value="'+qty+'" readonly aria-label="Quantity">'+
        '<button data-inc="'+id+'" aria-label="Increase">+</button>'+
      '</div>'+
      '<div class="sub" style="min-width:64px;text-align:right">'+peso.format(sub)+'</div>'+
    '</div>';
  }).join('');
  $('cart-total').textContent = peso.format(total);
  $('checkout-btn').disabled = false;
  body.querySelectorAll('[data-inc]').forEach(function(b){b.addEventListener('click',function(){
    var id=b.getAttribute('data-inc');
    state.cart[id] = (state.cart[id]||0)+1; saveCart(); renderCartDrawer();
  })});
  body.querySelectorAll('[data-dec]').forEach(function(b){b.addEventListener('click',function(){
    var id=b.getAttribute('data-dec');
    state.cart[id] = Math.max(0,(state.cart[id]||0)-1);
    if(state.cart[id]===0) delete state.cart[id];
    saveCart(); renderCartDrawer();
  })});
}
function openCart(){ renderCartDrawer(); $('cart-drawer').hidden=false; $('drawer-scrim').hidden=false; }
function closeCart(){ $('cart-drawer').hidden=true; $('drawer-scrim').hidden=true; }
$('cart-btn').addEventListener('click', openCart);
$('cart-close').addEventListener('click', closeCart);
$('drawer-scrim').addEventListener('click', closeCart);
$('checkout-btn').addEventListener('click', function(){
  closeCart();
  if(!state.session){ location.hash='#/login'; return; }
  location.hash = '#/checkout';
});

/* ---------------- login / signup ---------------- */
function renderLogin(signup){
  var app = $('app');
  app.innerHTML =
    '<div class="auth-wrap">'+
    '<div class="card-section auth-card">'+
      '<div class="auth-mark">jT</div>'+
      '<h2 style="text-align:center">'+(signup?'Create an account':'Welcome back')+'</h2>'+
      '<p class="helper" style="text-align:center;margin:-4px 0 18px">'+(signup?'Sign up to order from jT Shop':'Sign in to continue shopping')+'</p>'+
      '<form id="auth-form" class="form-grid">'+
        (signup?'<label class="wide">Full name<input id="f-name" required autocomplete="name"></label>':'')+
        '<label class="wide">Email<input id="f-email" type="email" required autocomplete="email"></label>'+
        '<label class="wide">Password'+pwField('f-pass', signup?'new-password':'current-password')+'</label>'+
        (signup?'':'<div style="text-align:right;margin-top:-8px"><a href="#/forgot" style="font-size:13px;font-weight:600">Forgot password?</a></div>')+
        '<button class="btn btn-primary wide" type="submit">'+(signup?'Sign up':'Sign in')+'</button>'+
      '</form>'+
      '<p class="msg" id="auth-msg"></p>'+
      '<p class="helper" style="text-align:center">'+(signup?'Already have an account? <a href="#/login">Sign in</a>':'New here? <a href="#/signup">Create an account</a>')+'</p>'+
    '</div></div>';
  $('auth-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var email=$('f-email').value.trim(), pass=$('f-pass').value;
    var msg=$('auth-msg'); msg.textContent='Working…'; msg.className='msg';
    var task = signup
      ? sb.auth.signUp({email:email,password:pass,options:{data:{full_name:$('f-name').value.trim()}}})
      : sb.auth.signInWithPassword({email:email,password:pass});
    task.then(function(r){
      if(r.error){ msg.textContent=r.error.message; msg.className='msg err'; return; }
      if(signup && !r.data.session){
        showSignupSuccess(email);
        return;
      }
      location.hash = '#/';
    });
  });
}

function showSignupSuccess(email){
  var card = document.querySelector('.auth-card');
  if(!card) return;
  card.classList.add('auth-fade-out');
  setTimeout(function(){
    card.innerHTML =
      '<div class="auth-success">'+
        '<div class="success-check"><svg viewBox="0 0 52 52"><circle class="success-check-circle" cx="26" cy="26" r="24" fill="none"/><path class="success-check-mark" fill="none" d="M14.5 27l7 7 16-16"/></svg></div>'+
        '<h2 style="text-align:center">Account created!</h2>'+
        '<p class="helper" style="text-align:center">We sent a confirmation link to<br><strong>'+esc(email)+'</strong>.<br>Verify it, then sign in below.</p>'+
        '<a href="#/login" class="btn btn-primary wide" style="text-decoration:none;display:block;text-align:center;box-sizing:border-box">Go to sign in</a>'+
        '<p class="helper" style="text-align:center;margin-top:10px">Redirecting you automatically…</p>'+
      '</div>';
    card.classList.remove('auth-fade-out');
    card.classList.add('auth-fade-in');
  }, 200);
  setTimeout(function(){
    if(location.hash.replace(/^#/,'')==='/signup'){ location.hash = '#/login'; }
  }, 4500);
}

function renderForgot(){
  var app = $('app');
  app.innerHTML =
    '<div class="auth-wrap"><div class="card-section auth-card">'+
      '<div class="auth-mark">jT</div>'+
      '<h2 style="text-align:center">Reset your password</h2>'+
      '<p class="helper" style="text-align:center;margin:-4px 0 18px">We\'ll email you a link to choose a new one</p>'+
      '<form id="forgot-form" class="form-grid">'+
        '<label class="wide">Email<input id="fg-email" type="email" required autocomplete="email"></label>'+
        '<button class="btn btn-primary wide" type="submit">Send reset link</button>'+
      '</form>'+
      '<p class="msg" id="forgot-msg"></p>'+
      '<p class="helper" style="text-align:center"><a href="#/login">Back to sign in</a></p>'+
    '</div></div>';
  $('forgot-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg = $('forgot-msg'); msg.textContent='Sending…'; msg.className='msg';
    var email = $('fg-email').value.trim();
    // No hash of our own here: Supabase appends the recovery tokens as a
    // URL hash fragment, and a URL can only have one. We route to the
    // reset screen from the PASSWORD_RECOVERY auth event instead (below).
    var redirectTo = location.origin + location.pathname;
    sb.auth.resetPasswordForEmail(email, {redirectTo:redirectTo}).then(function(r){
      if(r.error){ msg.textContent=r.error.message; msg.className='msg err'; return; }
      msg.textContent='If an account exists for that email, a reset link is on its way.'; msg.className='msg ok';
    });
  });
}

function renderReset(){
  var app = $('app');
  if(!state.session){
    app.innerHTML = '<div class="auth-wrap"><div class="card-section auth-card">'+
      '<div class="auth-mark">jT</div>'+
      '<h2 style="text-align:center">Verifying your link…</h2>'+
      '<p class="helper" style="text-align:center">This only takes a moment. If nothing happens, the link may have expired — <a href="#/forgot">request a new one</a>.</p>'+
    '</div></div>';
    return;
  }
  app.innerHTML =
    '<div class="auth-wrap"><div class="card-section auth-card">'+
      '<div class="auth-mark">jT</div>'+
      '<h2 style="text-align:center">Set a new password</h2>'+
      '<p class="helper" style="text-align:center;margin:-4px 0 18px">Choose a new password for your account</p>'+
      '<form id="reset-form" class="form-grid">'+
        '<label class="wide">New password'+pwField('r-pass', 'new-password')+'</label>'+
        '<button class="btn btn-primary wide" type="submit">Update password</button>'+
      '</form>'+
      '<p class="msg" id="reset-msg"></p>'+
    '</div></div>';
  $('reset-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg = $('reset-msg'); msg.textContent='Updating…'; msg.className='msg';
    sb.auth.updateUser({password:$('r-pass').value}).then(function(r){
      if(r.error){ msg.textContent=r.error.message; msg.className='msg err'; return; }
      msg.textContent='Password updated — taking you to the shop…'; msg.className='msg ok';
      setTimeout(function(){ location.hash = '#/'; }, 1200);
    });
  });
}

/* ---------------- checkout ---------------- */
function renderCheckout(){
  var app = $('app');
  var ids = Object.keys(state.cart).filter(function(id){return state.cart[id]>0});
  if(!ids.length){ app.innerHTML = '<p class="empty">Your cart is empty. <a href="#/">Go shopping</a></p>'; return; }
  fetchDeliveryZones().then(function(zones){ renderCheckoutForm(ids, zones); }).catch(function(e){ app.innerHTML = errBox(e); });
}
function renderCheckoutForm(ids, zones){
  var app = $('app');
  var itemsTotal=0, anyPreorder=false;
  ids.forEach(function(id){
    var p=productById(id), qty=state.cart[id];
    itemsTotal += p.price*qty;
    if(qty > p.stock_qty) anyPreorder = true;
  });

  function zoneFee(name){
    var z = zones.find(function(x){return x.barangay===name});
    return (z && z.serviceable) ? Number(z.fee)||0 : 0;
  }
  var savedProfile = state.profile || {};
  var savedBarangay = zones.some(function(z){return z.barangay===savedProfile.barangay && z.serviceable}) ? savedProfile.barangay : '';
  var deliveryFee = zoneFee(savedBarangay);

  var barangayOptions = '<option value="">Select your barangay…</option>' + zones.map(function(z){
    var label = z.serviceable
      ? z.barangay+' ('+z.km_range+') — '+(Number(z.fee)>0?peso.format(z.fee):'Free')
      : z.barangay+' — Unserviceable';
    return '<option value="'+esc(z.barangay)+'"'+(z.serviceable?'':' disabled')+(z.barangay===savedBarangay?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');

  app.innerHTML =
    '<h1>Checkout</h1>'+
    '<div class="split">'+
      '<div class="card-section">'+
        '<h2>Delivery details</h2>'+
        '<form id="checkout-form" class="form-grid">'+
          '<label class="wide">Full address<textarea id="c-address" required placeholder="House/unit, street, barangay, city">'+esc(savedProfile.address||'')+'</textarea></label>'+
          '<label class="wide">Barangay<select id="c-barangay" required>'+barangayOptions+'</select></label>'+
          '<label class="wide">Contact number<input id="c-phone" required placeholder="09xx xxx xxxx" value="'+esc(savedProfile.phone||'')+'"></label>'+
          '<label class="wide">Payment method'+
            '<select id="c-payment">'+
              '<option value="cod">Cash on delivery</option>'+
              '<option value="online">GCash</option>'+
            '</select>'+
          '</label>'+
          '<div class="wide gcash-panel" id="gcash-panel" hidden>'+
            '<img src="gcash-qr.png" alt="GCash QR code — tap to enlarge" class="gcash-qr" id="gcash-qr-img">'+
            '<div class="helper" style="margin:4px 0 8px">Tap the QR to enlarge</div>'+
            '<p class="helper" style="margin:8px 0">Scan the QR above in your GCash app, send <strong id="gcash-amount">'+peso.format(itemsTotal+deliveryFee)+'</strong>, then enter the reference number from your GCash receipt below.</p>'+
            '<label class="wide">GCash reference number<input id="c-gcash-ref" placeholder="e.g. 1234567890123"></label>'+
          '</div>'+
          '<label class="wide">Notes (optional)<textarea id="c-notes" placeholder="Landmark, preferred delivery time, etc."></textarea></label>'+
          '<button class="btn btn-primary wide" type="submit">Place order</button>'+
        '</form>'+
        '<p class="msg" id="checkout-msg"></p>'+
      '</div>'+
      '<div class="card-section checkout-summary">'+
        '<h2>Order summary</h2>'+
        '<div id="summary-items"></div>'+
        '<div id="summary-pager"></div>'+
        '<div class="summary-footer">'+
          '<div class="cart-line"><div>Delivery fee</div><div id="delivery-fee-line">'+(savedBarangay?peso.format(deliveryFee):'—')+'</div></div>'+
          '<div class="cart-total" style="margin-top:10px"><span>Total</span><strong id="checkout-total">'+peso.format(itemsTotal+deliveryFee)+'</strong></div>'+
          (anyPreorder?'<p class="helper" style="margin-top:10px">Items marked <span class="preorder-tag">Pre-order</span> aren\'t in stock yet — we\'ll deliver those once restocked.</p>':'')+
        '</div>'+
      '</div>'+
    '</div>';

  var summaryPage = 1;
  var SUMMARY_PAGE_SIZE = 4;
  function renderSummaryItems(){
    var totalPages = Math.max(1, Math.ceil(ids.length/SUMMARY_PAGE_SIZE));
    summaryPage = Math.min(Math.max(1,summaryPage), totalPages);
    var start = (summaryPage-1)*SUMMARY_PAGE_SIZE;
    var pageIds = ids.slice(start, start+SUMMARY_PAGE_SIZE);
    $('summary-items').innerHTML = pageIds.map(function(id){
      var p=productById(id), qty=state.cart[id], sub=p.price*qty;
      var preorderQty = Math.max(0, qty - p.stock_qty);
      return '<div class="cart-line">'+
        '<div class="cart-line-thumb">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="">':'📦')+'</div>'+
        '<div class="cart-line-info"><div class="name">'+esc(p.name)+' × '+qty+'</div>'+
          (preorderQty>0?'<div class="preorder-tag">'+(preorderQty===qty?'Pre-order':preorderQty+' pre-order')+'</div>':'')+
        '</div>'+
        '<div class="sub" style="min-width:64px;text-align:right">'+peso.format(sub)+'</div>'+
      '</div>';
    }).join('');
    $('summary-pager').innerHTML = totalPages>1
      ? '<div class="pager">'+
          '<button type="button" class="btn btn-ghost btn-sm" id="summary-prev"'+(summaryPage<=1?' disabled':'')+'>&larr; Prev</button>'+
          '<span class="helper">Page '+summaryPage+' of '+totalPages+'</span>'+
          '<button type="button" class="btn btn-ghost btn-sm" id="summary-next"'+(summaryPage>=totalPages?' disabled':'')+'>Next &rarr;</button>'+
        '</div>'
      : '';
    var prevBtn=$('summary-prev'), nextBtn=$('summary-next');
    if(prevBtn) prevBtn.addEventListener('click', function(){ summaryPage--; renderSummaryItems(); });
    if(nextBtn) nextBtn.addEventListener('click', function(){ summaryPage++; renderSummaryItems(); });
  }
  renderSummaryItems();

  function updateTotals(){
    var fee = zoneFee($('c-barangay').value);
    $('delivery-fee-line').textContent = $('c-barangay').value ? peso.format(fee) : '—';
    var total = itemsTotal + fee;
    $('checkout-total').textContent = peso.format(total);
    var amt = $('gcash-amount'); if(amt) amt.textContent = peso.format(total);
  }
  $('c-barangay').addEventListener('change', updateTotals);
  $('c-payment').addEventListener('change', function(){
    $('gcash-panel').hidden = $('c-payment').value !== 'online';
  });
  $('gcash-qr-img').addEventListener('click', function(){ openImageLightbox('gcash-qr.png'); });
  $('checkout-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg=$('checkout-msg');
    var barangay = $('c-barangay').value;
    var zone = zones.find(function(z){return z.barangay===barangay});
    if(!barangay || !zone || !zone.serviceable){
      msg.textContent = 'Select a barangay we currently deliver to.'; msg.className='msg err';
      return;
    }
    var payment = $('c-payment').value;
    var gcashRef = $('c-gcash-ref') ? $('c-gcash-ref').value.trim() : '';
    if(payment==='online' && !gcashRef){
      msg.textContent='Enter your GCash reference number.'; msg.className='msg err';
      return;
    }
    msg.textContent='Placing your order…'; msg.className='msg';
    var items = ids.map(function(id){ return {product_id:id, qty: state.cart[id]}; });
    var addressVal = $('c-address').value.trim(), phoneVal = $('c-phone').value.trim();
    sb.rpc('shop_place_order', {
      p_deliver_to: addressVal,
      p_phone: phoneVal,
      p_payment_method: payment,
      p_notes: $('c-notes').value.trim() || null,
      p_items: items,
      p_payment_reference: payment==='online' ? gcashRef : null,
      p_barangay: barangay
    }).then(function(r){
      if(r.error){ msg.textContent = r.error.message.replace(/^.*?:\s*/,''); msg.className='msg err'; return; }
      state.cart = {}; saveCart();
      // keep the local profile cache in sync so the next checkout pre-fills instantly
      if(state.profile){ state.profile.address = addressVal; state.profile.phone = phoneVal; state.profile.barangay = barangay; }
      toast('Order placed!');
      location.hash = '#/orders';
    });
  });
}

/* ---------------- customer orders ---------------- */
function renderOrders(){
  var app = $('app');
  app.innerHTML = '<h1>My orders</h1><div id="orders-list"><p class="helper">Loading…</p></div>';
  sb.from('shop_orders').select('*, shop_order_items(*)').order('created_at',{ascending:false})
    .then(function(r){
      if(r.error){ $('orders-list').innerHTML = errBox(r.error); return; }
      var orders = r.data||[];
      if(!orders.length){ $('orders-list').innerHTML = '<p class="empty">No orders yet. <a href="#/">Start shopping</a></p>'; return; }
      $('orders-list').innerHTML = orders.map(orderCard.bind(null,false)).join('');
      $('orders-list').querySelectorAll('[data-cancel]').forEach(function(b){
        b.addEventListener('click', function(){
          if(!confirm('Cancel this order?')) return;
          sb.rpc('shop_cancel_order',{p_order_id:b.getAttribute('data-cancel')}).then(function(r){
            if(r.error){ toast(r.error.message); return; }
            toast('Order cancelled'); renderOrders();
          });
        });
      });
    });
}
function orderCard(adminView, o){
  var items = (o.shop_order_items||[]).map(function(i){
    return esc(i.name_snapshot)+' × '+i.qty+(i.preorder_qty>0?' <span class="preorder-tag">'+(i.preorder_qty===i.qty?'Pre-order':i.preorder_qty+' pre-order')+'</span>':'');
  }).join(', ');
  var when = new Date(o.created_at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return '<div class="order-card">'+
    '<div class="order-head">'+
      '<div><strong>'+peso.format(o.total)+'</strong> · <span class="helper">'+when+'</span></div>'+
      '<div><span class="pill '+o.status+'">'+o.status.replace(/_/g,' ')+'</span> <span class="pill '+o.payment_status+'">'+o.payment_status+'</span>'+(o.has_preorder?' <span class="pill preorder">Pre-order</span>':'')+'</div>'+
    '</div>'+
    '<div class="order-items">'+items+'</div>'+
    '<div class="order-items">Deliver to: '+esc(o.deliver_to)+(o.barangay?' ('+esc(o.barangay)+')':'')+' &middot; '+esc(o.phone)+(o.notes?' &middot; '+esc(o.notes):'')+'</div>'+
    (Number(o.delivery_fee)>0 ? '<div class="order-items">Delivery fee: '+peso.format(o.delivery_fee)+'</div>' : '')+
    (o.payment_method==='online' ? '<div class="order-items">Paid via GCash'+(o.payment_reference?' &middot; Ref #'+esc(o.payment_reference):'')+'</div>' : '')+
    (!adminView && o.status==='pending' ? '<div style="margin-top:10px"><button class="btn btn-danger btn-sm" data-cancel="'+o.id+'">Cancel order</button></div>' : '')+
  '</div>';
}

function errBox(e){ return '<p class="msg err">Something went wrong: '+esc(e.message||e)+'</p>'; }

/* ---------------- boot ---------------- */
function hidePageLoader(){
  var el = $('page-loader');
  if(!el) return;
  el.classList.add('hide');
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 400);
}
window.addEventListener('hashchange', route);
loadCart(); renderCartBadge();

// A password-reset link lands with Supabase's own tokens in the URL hash
// (e.g. #access_token=...&type=recovery), which isn't one of our routes.
// Show a neutral holding screen instead of "page not found" while
// Supabase parses it and fires PASSWORD_RECOVERY below.
var looksLikeAuthRedirect = /access_token=|type=recovery|error_description=/.test(location.hash);
if(looksLikeAuthRedirect){
  $('app').innerHTML = '<p class="helper" style="text-align:center;margin-top:40px">Verifying your link…</p>';
  hidePageLoader();
} else {
  sb.auth.getSession().then(function(r){
    state.session = r.data.session;
    return refreshProfile();
  }).then(function(){
    route();
    hidePageLoader();
  }).catch(function(){
    hidePageLoader();
  });
}
sb.auth.onAuthStateChange(function(event, session){
  state.session = session;
  if(event === 'PASSWORD_RECOVERY'){
    refreshProfile().then(function(){
      if(location.hash.replace(/^#/,'') === '/reset'){ route(); } else { location.hash = '/reset'; }
    });
    return;
  }
  refreshProfile().then(function(){
    updateHeader();
    if(event==='SIGNED_IN' || event==='SIGNED_OUT'){ route(); }
  });
});
})();
