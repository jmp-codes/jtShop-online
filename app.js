(function(){
"use strict";
var sb = supabase.createClient(window.SHOP_CONFIG.supabaseUrl, window.SHOP_CONFIG.supabaseKey);
var peso = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
var $ = function(id){return document.getElementById(id)};
var esc = function(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML};

var state = {
  session: null,
  profile: null,       // {id, full_name, role, ...}
  products: [],         // active products (customer view)
  adminProducts: [],    // all products (admin view)
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
  if(hash==='/checkout') return requireAuth(renderCheckout);
  if(hash==='/orders') return requireAuth(renderOrders);
  if(hash==='/admin') return requireAdmin(renderAdmin);
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
      '<div class="hero"><h1>Baby care, delivered</h1><p>Everything in stock right now — order what you need, we confirm and deliver.</p></div>'+
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
        if(have >= p.stock_qty){ toast('Only '+p.stock_qty+' in stock.'); return; }
        state.cart[id] = have+1;
        saveCart();
        toast('Added '+p.name+' to cart');
      });
    });
  }).catch(function(e){ $('app').innerHTML = errBox(e); });
}
function productCard(p){
  var cls = p.stock_qty<=0?'zero':(p.stock_qty<=3?'low':'ok');
  var stockText = p.stock_qty<=0 ? 'Out of stock' : (p.stock_qty<=3 ? 'Only '+p.stock_qty+' left' : p.stock_qty+' in stock');
  return '<div class="card">'+
    '<div class="card-media">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="">':'🧴')+'</div>'+
    '<div class="card-body">'+
      '<div class="card-name">'+esc(p.name)+'</div>'+
      (p.description?'<div class="card-desc">'+esc(p.description)+'</div>':'<div class="card-desc"></div>')+
      '<div class="card-row"><span class="price">'+peso.format(p.price)+'</span><span class="stockline '+cls+'">'+stockText+'</span></div>'+
      '<button class="btn btn-primary btn-block" data-add="'+p.id+'" '+(p.stock_qty<=0?'disabled':'')+'>Add to cart</button>'+
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
    return '<div class="cart-line">'+
      '<div><div class="name">'+esc(p.name)+'</div><div class="sub">'+peso.format(p.price)+' each</div></div>'+
      '<div class="qty-stepper">'+
        '<button data-dec="'+id+'" aria-label="Decrease">−</button>'+
        '<input value="'+qty+'" readonly aria-label="Quantity">'+
        '<button data-inc="'+id+'" aria-label="Increase" '+(qty>=p.stock_qty?'disabled':'')+'>+</button>'+
      '</div>'+
      '<div class="sub" style="min-width:64px;text-align:right">'+peso.format(sub)+'</div>'+
    '</div>';
  }).join('');
  $('cart-total').textContent = peso.format(total);
  $('checkout-btn').disabled = false;
  body.querySelectorAll('[data-inc]').forEach(function(b){b.addEventListener('click',function(){
    var id=b.getAttribute('data-inc'), p=productById(id);
    if(state.cart[id]<p.stock_qty){ state.cart[id]++; saveCart(); renderCartDrawer(); }
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
    '<div class="card-section" style="max-width:420px;margin:0 auto">'+
      '<h2>'+(signup?'Create an account':'Sign in')+'</h2>'+
      (signup?'<label>Full name<input id="f-name" required></label><br>':'')+
      '<form id="auth-form" class="form-grid">'+
        (signup?'<label class="wide">Full name<input id="f-name" required></label>':'')+
        '<label class="wide">Email<input id="f-email" type="email" required autocomplete="email"></label>'+
        '<label class="wide">Password<input id="f-pass" type="password" required minlength="6" autocomplete="'+(signup?'new-password':'current-password')+'"></label>'+
        '<button class="btn btn-primary wide" type="submit">'+(signup?'Sign up':'Sign in')+'</button>'+
      '</form>'+
      '<p class="msg" id="auth-msg"></p>'+
      '<p class="helper">'+(signup?'Already have an account? <a href="#/login">Sign in</a>':'New here? <a href="#/signup">Create an account</a>')+'</p>'+
    '</div>';
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
        msg.textContent='Account created. Check your email to confirm, then sign in.'; msg.className='msg ok';
        return;
      }
      location.hash = '#/';
    });
  });
}

/* ---------------- checkout ---------------- */
function renderCheckout(){
  var app = $('app');
  var ids = Object.keys(state.cart).filter(function(id){return state.cart[id]>0});
  if(!ids.length){ app.innerHTML = '<p class="empty">Your cart is empty. <a href="#/">Go shopping</a></p>'; return; }
  var total=0, lines = ids.map(function(id){
    var p=productById(id), qty=state.cart[id], sub=p.price*qty; total+=sub;
    return '<div class="cart-line"><div class="name">'+esc(p.name)+' × '+qty+'</div><div>'+peso.format(sub)+'</div></div>';
  }).join('');
  app.innerHTML =
    '<h1>Checkout</h1>'+
    '<div class="split">'+
      '<div class="card-section">'+
        '<h2>Delivery details</h2>'+
        '<form id="checkout-form" class="form-grid">'+
          '<label class="wide">Full address<textarea id="c-address" required placeholder="House/unit, street, barangay, city"></textarea></label>'+
          '<label class="wide">Contact number<input id="c-phone" required placeholder="09xx xxx xxxx"></label>'+
          '<label class="wide">Payment method'+
            '<select id="c-payment">'+
              '<option value="cod">Cash on delivery</option>'+
              '<option value="online" disabled>Online payment — coming soon</option>'+
            '</select>'+
          '</label>'+
          '<label class="wide">Notes (optional)<textarea id="c-notes" placeholder="Landmark, preferred delivery time, etc."></textarea></label>'+
          '<button class="btn btn-primary wide" type="submit">Place order</button>'+
        '</form>'+
        '<p class="msg" id="checkout-msg"></p>'+
      '</div>'+
      '<div class="card-section">'+
        '<h2>Order summary</h2>'+lines+
        '<div class="cart-total" style="margin-top:10px"><span>Total</span><strong>'+peso.format(total)+'</strong></div>'+
      '</div>'+
    '</div>';
  $('checkout-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg=$('checkout-msg'); msg.textContent='Placing your order…'; msg.className='msg';
    var items = ids.map(function(id){ return {product_id:id, qty: state.cart[id]}; });
    sb.rpc('shop_place_order', {
      p_deliver_to: $('c-address').value.trim(),
      p_phone: $('c-phone').value.trim(),
      p_payment_method: $('c-payment').value,
      p_notes: $('c-notes').value.trim() || null,
      p_items: items
    }).then(function(r){
      if(r.error){ msg.textContent = r.error.message.replace(/^.*?:\s*/,''); msg.className='msg err'; return; }
      state.cart = {}; saveCart();
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
  var items = (o.shop_order_items||[]).map(function(i){ return esc(i.name_snapshot)+' × '+i.qty; }).join(', ');
  var when = new Date(o.created_at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return '<div class="order-card">'+
    '<div class="order-head">'+
      '<div><strong>'+peso.format(o.total)+'</strong> · <span class="helper">'+when+'</span></div>'+
      '<div><span class="pill '+o.status+'">'+o.status.replace(/_/g,' ')+'</span> <span class="pill '+o.payment_status+'">'+o.payment_status+'</span></div>'+
    '</div>'+
    '<div class="order-items">'+esc(items)+'</div>'+
    '<div class="order-items">Deliver to: '+esc(o.deliver_to)+' &middot; '+esc(o.phone)+(o.notes?' &middot; '+esc(o.notes):'')+'</div>'+
    (!adminView && o.status==='pending' ? '<div style="margin-top:10px"><button class="btn btn-danger btn-sm" data-cancel="'+o.id+'">Cancel order</button></div>' : '')+
  '</div>';
}

/* ---------------- admin ---------------- */
function renderAdmin(){
  var app = $('app');
  app.innerHTML =
    '<h1>Admin</h1>'+
    '<div class="tabs"><button data-tab="orders" class="active">Orders</button><button data-tab="products">Products</button></div>'+
    '<div id="admin-body"></div>';
  app.querySelectorAll('.tabs button').forEach(function(b){
    b.addEventListener('click', function(){
      app.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});
      b.classList.add('active');
      b.getAttribute('data-tab')==='orders' ? adminOrders() : adminProducts();
    });
  });
  adminOrders();
}
function adminOrders(){
  var body = $('admin-body');
  body.innerHTML = '<p class="helper">Loading…</p>';
  sb.from('shop_orders').select('*, shop_order_items(*), shop_profiles(full_name)').order('created_at',{ascending:false})
    .then(function(r){
      if(r.error){ body.innerHTML = errBox(r.error); return; }
      var orders = r.data||[];
      if(!orders.length){ body.innerHTML='<p class="empty">No orders yet.</p>'; return; }
      var statuses=['pending','confirmed','preparing','out_for_delivery','completed','cancelled'];
      body.innerHTML = orders.map(function(o){
        var items = (o.shop_order_items||[]).map(function(i){ return esc(i.name_snapshot)+' × '+i.qty+' ('+peso.format(i.subtotal)+')'; }).join('<br>');
        var buyer = (o.shop_profiles && o.shop_profiles.full_name) || 'Customer';
        return '<div class="order-card">'+
          '<div class="order-head"><div><strong>'+esc(buyer)+'</strong> · '+peso.format(o.total)+' · <span class="helper">'+new Date(o.created_at).toLocaleString('en-PH')+'</span></div>'+
          '<div>'+peso.format(o.total)+'</div></div>'+
          '<div class="order-items">'+items+'</div>'+
          '<div class="order-items">Deliver to: '+esc(o.deliver_to)+' &middot; '+esc(o.phone)+(o.notes?' &middot; Note: '+esc(o.notes):'')+' &middot; '+o.payment_method.toUpperCase()+'</div>'+
          '<div class="form-grid" style="margin-top:10px;max-width:420px">'+
            '<label>Status<select data-status="'+o.id+'">'+statuses.map(function(s){return '<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+s.replace(/_/g,' ')+'</option>'}).join('')+'</select></label>'+
            '<label>Payment<select data-payment="'+o.id+'"><option value="unpaid"'+(o.payment_status==='unpaid'?' selected':'')+'>Unpaid</option><option value="paid"'+(o.payment_status==='paid'?' selected':'')+'>Paid</option><option value="refunded"'+(o.payment_status==='refunded'?' selected':'')+'>Refunded</option></select></label>'+
          '</div>'+
        '</div>';
      }).join('');
      body.querySelectorAll('[data-status]').forEach(function(sel){
        sel.addEventListener('change', function(){
          var id=sel.getAttribute('data-status'), val=sel.value;
          var task = val==='cancelled' ? sb.rpc('shop_cancel_order',{p_order_id:id}) : sb.from('shop_orders').update({status:val}).eq('id',id);
          task.then(function(r){ if(r.error){ toast(r.error.message); } else { toast('Order updated'); } });
        });
      });
      body.querySelectorAll('[data-payment]').forEach(function(sel){
        sel.addEventListener('change', function(){
          sb.from('shop_orders').update({payment_status:sel.value}).eq('id',sel.getAttribute('data-payment')).then(function(r){
            if(r.error) toast(r.error.message); else toast('Payment status updated');
          });
        });
      });
    });
}
function adminProducts(){
  var body = $('admin-body');
  body.innerHTML = '<p class="helper">Loading…</p>';
  fetchAdminProducts().then(function(){
    body.innerHTML =
      '<div class="card-section">'+
        '<h2>Add a product</h2>'+
        '<form id="new-product" class="form-grid">'+
          '<label class="wide">Name<input id="np-name" required></label>'+
          '<label class="wide">Description<input id="np-desc"></label>'+
          '<label>Price (₱)<input id="np-price" type="number" min="0" step="0.01" required></label>'+
          '<label>Cost (₱)<input id="np-cost" type="number" min="0" step="0.01" value="0"></label>'+
          '<label>Starting stock<input id="np-stock" type="number" min="0" step="1" value="0" required></label>'+
          '<label class="wide">Image URL (optional)<input id="np-image"></label>'+
          '<button class="btn btn-primary wide" type="submit">Add product</button>'+
        '</form><p class="msg" id="np-msg"></p>'+
      '</div>'+
      '<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Price</th><th>Cost</th><th>Stock</th><th>Active</th><th></th></tr></thead><tbody id="prod-body"></tbody></table></div>';
    $('prod-body').innerHTML = state.adminProducts.map(function(p){
      return '<tr data-row="'+p.id+'">'+
        '<td><input value="'+esc(p.name)+'" data-f="name" style="min-width:200px"></td>'+
        '<td><input type="number" step="0.01" value="'+p.price+'" data-f="price" style="width:90px"></td>'+
        '<td><input type="number" step="0.01" value="'+p.cost+'" data-f="cost" style="width:90px"></td>'+
        '<td><input type="number" step="1" value="'+p.stock_qty+'" data-f="stock_qty" style="width:70px"></td>'+
        '<td><input type="checkbox" data-f="active" '+(p.active?'checked':'')+'></td>'+
        '<td><button class="btn btn-ghost btn-sm" data-save="'+p.id+'">Save</button></td>'+
      '</tr>';
    }).join('');
    $('prod-body').querySelectorAll('[data-save]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-save');
        var row = $('prod-body').querySelector('[data-row="'+id+'"]');
        var patch = {
          name: row.querySelector('[data-f=name]').value.trim(),
          price: parseFloat(row.querySelector('[data-f=price]').value)||0,
          cost: parseFloat(row.querySelector('[data-f=cost]').value)||0,
          stock_qty: parseInt(row.querySelector('[data-f=stock_qty]').value,10)||0,
          active: row.querySelector('[data-f=active]').checked
        };
        sb.from('shop_products').update(patch).eq('id',id).then(function(r){
          if(r.error) toast(r.error.message); else toast('Saved');
        });
      });
    });
    $('new-product').addEventListener('submit', function(ev){
      ev.preventDefault();
      var msg=$('np-msg');
      var row = {
        name: $('np-name').value.trim(),
        description: $('np-desc').value.trim()||null,
        price: parseFloat($('np-price').value),
        cost: parseFloat($('np-cost').value)||0,
        stock_qty: parseInt($('np-stock').value,10)||0,
        image_url: $('np-image').value.trim()||null
      };
      if(!row.name||!(row.price>=0)){ msg.textContent='Enter a name and a price.'; msg.className='msg err'; return; }
      sb.from('shop_products').insert(row).then(function(r){
        if(r.error){ msg.textContent=r.error.message; msg.className='msg err'; return; }
        msg.textContent='Added.'; msg.className='msg ok';
        ['np-name','np-desc','np-price','np-cost','np-stock','np-image'].forEach(function(id){$(id).value=id==='np-stock'||id==='np-cost'?'0':''});
        adminProducts();
      });
    });
  }).catch(function(e){ body.innerHTML = errBox(e); });
}

function errBox(e){ return '<p class="msg err">Something went wrong: '+esc(e.message||e)+'</p>'; }

/* ---------------- boot ---------------- */
window.addEventListener('hashchange', route);
loadCart(); renderCartBadge();

sb.auth.getSession().then(function(r){
  state.session = r.data.session;
  return refreshProfile();
}).then(function(){
  route();
});
sb.auth.onAuthStateChange(function(event, session){
  state.session = session;
  refreshProfile().then(function(){
    updateHeader();
    if(event==='SIGNED_IN' || event==='SIGNED_OUT'){ route(); }
  });
});
})();
