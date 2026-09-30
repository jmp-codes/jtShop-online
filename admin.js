(function(){
"use strict";
var sb = supabase.createClient(window.SHOP_CONFIG.supabaseUrl, window.SHOP_CONFIG.supabaseKey);
var peso = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
var peso0 = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:0});
var $ = function(id){return document.getElementById(id)};
var esc = function(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML};
var statuses=['pending','confirmed','preparing','out_for_delivery','completed','cancelled'];

var toastTimer=null;
function toast(msg){ var t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.hidden=true},2600); }
function errBox(e){ return '<p class="msg err">Something went wrong: '+esc(e.message||e)+'</p>'; }
function friendlyDbError(e){
  if(e && e.code==='23505') return 'A product with that name already exists.';
  return (e && e.message) || String(e);
}

/* ---------------- modal ---------------- */
function openModal(title, bodyHtml){
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal').hidden = false;
  $('modal-scrim').hidden = false;
}
function closeModal(){
  $('modal').hidden = true;
  $('modal-scrim').hidden = true;
  $('modal-body').innerHTML = '';
}
document.addEventListener('DOMContentLoaded', function(){
  var mc = $('modal-close'), ms = $('modal-scrim');
  if(mc) mc.addEventListener('click', closeModal);
  if(ms) ms.addEventListener('click', closeModal);
});
document.addEventListener('keydown', function(ev){ if(ev.key==='Escape') closeModal(); });

var products = [];
var orders = [];
var activity = [];

function loadAll(){
  return Promise.all([
    sb.from('shop_products').select('*').order('name'),
    sb.from('shop_orders').select('*, shop_order_items(*), shop_profiles(full_name)').order('created_at',{ascending:false}),
    sb.from('shop_activity_log').select('*, shop_profiles!shop_activity_log_actor_profile_fkey(full_name)').order('created_at',{ascending:false}).limit(300)
  ]).then(function(r){
    if(r[0].error) throw r[0].error;
    if(r[1].error) throw r[1].error;
    products = r[0].data||[];
    orders = r[1].data||[];
    activity = (r[2] && !r[2].error) ? (r[2].data||[]) : [];
  });
}
function logActivity(action, details){
  sb.from('shop_activity_log').insert({action:action, details:details||{}}).then(function(){});
}

/* ---------------- gate + boot ---------------- */
function hidePageLoader(){
  var el = $('page-loader');
  if(!el) return;
  el.classList.add('hide');
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 400);
}
function boot(){
  sb.auth.getSession().then(function(r){
    var session = r.data.session;
    if(!session){
      $('app').innerHTML = '<p class="empty">Sign in with an admin account to view this page. <a href="index.html#/login">Sign in</a></p>';
      hidePageLoader();
      return;
    }
    sb.from('shop_profiles').select('*').eq('id',session.user.id).single().then(function(r){
      var profile = r.data;
      $('acct').innerHTML = esc((profile&&profile.full_name) || session.user.email)+' &middot; <button class="linklike" id="signout-btn">Sign out</button>';
      var sob=$('signout-btn'); if(sob) sob.addEventListener('click', function(){ sb.auth.signOut().then(function(){ location.href='index.html'; }); });
      if(!profile || profile.role!=='admin'){
        $('app').innerHTML = '<p class="empty">This account is not an admin. <a href="index.html">Back to shop</a></p>';
        hidePageLoader();
        return;
      }
      initTabs();
    });
  }).catch(function(){ hidePageLoader(); });
}
function initTabs(){
  document.querySelectorAll('.tabs button').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});
      b.classList.add('active');
      showTab(b.getAttribute('data-tab'));
    });
  });
  showTab('dashboard');
}
var currentTab = 'dashboard';
function showTab(tab){
  currentTab = tab;
  var body = $('admin-body');
  body.innerHTML = '<p class="helper">Loading…</p>';
  loadAll().then(function(){
    if(tab==='dashboard') renderDashboard(body);
    else if(tab==='orders') renderOrders(body);
    else if(tab==='activity') renderActivityLog(body);
    else renderProducts(body);
    hidePageLoader();
  }).catch(function(e){ body.innerHTML = errBox(e); hidePageLoader(); });
}
var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){
    var body = $('admin-body');
    if(!body) return;
    if(currentTab==='orders') renderOrders(body);
    else if(currentTab==='activity') renderActivityLog(body);
  }, 200);
});

/* ---------------- pagination ---------------- */
function computePageSize(rowHeight, reservedHeight, min, max){
  var h = (window.innerHeight||800) - reservedHeight;
  var n = Math.floor(h/rowHeight);
  return Math.max(min, Math.min(max, n||min));
}
function paginate(arr, page, pageSize){
  var totalPages = Math.max(1, Math.ceil(arr.length/pageSize));
  page = Math.min(Math.max(1,page||1), totalPages);
  var start = (page-1)*pageSize;
  return {items: arr.slice(start, start+pageSize), page: page, totalPages: totalPages};
}
function pagerHtml(page, totalPages, idPrefix){
  if(totalPages<=1) return '';
  return '<div class="pager">'+
    '<button class="btn btn-ghost btn-sm" id="'+idPrefix+'-prev"'+(page<=1?' disabled':'')+'>&larr; Prev</button>'+
    '<span class="helper">Page '+page+' of '+totalPages+'</span>'+
    '<button class="btn btn-ghost btn-sm" id="'+idPrefix+'-next"'+(page>=totalPages?' disabled':'')+'>Next &rarr;</button>'+
  '</div>';
}

/* ---------------- dashboard ---------------- */
function renderDashboard(body){
  var live = orders.filter(function(o){ return o.status!=='cancelled'; });
  var unitsInStock = products.reduce(function(a,p){return a+p.stock_qty},0);
  var stockValue = products.reduce(function(a,p){return a+p.stock_qty*p.price},0);
  var lowStock = products.filter(function(p){return p.active && p.stock_qty>0 && p.stock_qty<=3});
  var outOfStock = products.filter(function(p){return p.active && p.stock_qty<=0});
  var revenue = live.reduce(function(a,o){return a+Number(o.total)},0);
  var collected = live.filter(function(o){return o.payment_status==='paid'}).reduce(function(a,o){return a+Number(o.total)},0);
  var COMMISSION_RATE = 0.2; // ₱200 commission for every ₱1,000 sold
  var commission = revenue * COMMISSION_RATE;
  var sold = {}; // name -> units
  live.forEach(function(o){
    (o.shop_order_items||[]).forEach(function(i){
      sold[i.name_snapshot] = (sold[i.name_snapshot]||0) + i.qty;
    });
  });
  var todayKey = new Date().toDateString();
  var todayOrders = live.filter(function(o){return new Date(o.created_at).toDateString()===todayKey});
  var todayRevenue = todayOrders.reduce(function(a,o){return a+Number(o.total)},0);
  var byStatus = {};
  statuses.forEach(function(s){byStatus[s]=0});
  orders.forEach(function(o){byStatus[o.status]=(byStatus[o.status]||0)+1});
  var topSelling = Object.keys(sold).map(function(n){return {name:n, qty:sold[n]}}).sort(function(a,b){return b.qty-a.qty}).slice(0,5);

  body.innerHTML =
    '<div class="stat-grid">'+
      '<div class="stat-tile accent"><span class="l">Total revenue</span><span class="v">'+peso0.format(revenue)+'</span><span class="s">'+live.length+' orders, excludes cancelled</span></div>'+
      '<div class="stat-tile"><span class="l">Your commission</span><span class="v">'+peso0.format(commission)+'</span><span class="s">₱200 per ₱1,000 sold (20%)</span></div>'+
      '<div class="stat-tile"><span class="l">Collected</span><span class="v">'+peso0.format(collected)+'</span><span class="s">'+peso0.format(revenue-collected)+' still unpaid</span></div>'+
      '<div class="stat-tile"><span class="l">Today</span><span class="v">'+peso0.format(todayRevenue)+'</span><span class="s">'+todayOrders.length+' order'+(todayOrders.length===1?'':'s')+' today</span></div>'+
    '</div>'+
    '<div class="stat-grid">'+
      '<div class="stat-tile"><span class="l">Units in stock</span><span class="v">'+unitsInStock.toLocaleString('en-PH')+'</span><span class="s">across '+products.length+' products</span></div>'+
      '<div class="stat-tile"><span class="l">Stock value</span><span class="v">'+peso0.format(stockValue)+'</span><span class="s">at price</span></div>'+
      '<div class="stat-tile"><span class="l">Low stock</span><span class="v" style="color:var(--warn)">'+lowStock.length+'</span><span class="s">3 or fewer left</span></div>'+
      '<div class="stat-tile"><span class="l">Out of stock</span><span class="v" style="color:var(--bad)">'+outOfStock.length+'</span><span class="s">needs restock</span></div>'+
    '</div>'+
    '<div class="two-col">'+
      '<div class="card-section">'+
        '<h2>Orders by status</h2>'+
        '<ul class="rank-list">'+statuses.map(function(s){return '<li><span><span class="pill '+s+'">'+s.replace(/_/g,' ')+'</span></span><span>'+byStatus[s]+'</span></li>'}).join('')+'</ul>'+
      '</div>'+
      '<div class="card-section">'+
        '<h2>Best sellers</h2>'+
        (topSelling.length
          ? '<ul class="rank-list">'+topSelling.map(function(t,i){return '<li><span><span class="n">'+(i+1)+'.</span>'+esc(t.name)+'</span><span>'+t.qty+' sold</span></li>'}).join('')+'</ul>'
          : '<p class="helper">No sales yet.</p>')+
      '</div>'+
    '</div>'+
    (lowStock.length||outOfStock.length ?
      '<div class="card-section">'+
        '<h2>Needs attention</h2>'+
        '<ul class="rank-list">'+
          outOfStock.map(function(p){return '<li><span>'+esc(p.name)+'</span><span class="pill zero-pill" style="background:var(--bad-soft);color:var(--bad)">Out of stock</span></li>'}).join('')+
          lowStock.map(function(p){return '<li><span>'+esc(p.name)+'</span><span class="pill" style="background:var(--warn-soft);color:var(--warn)">'+p.stock_qty+' left</span></li>'}).join('')+
        '</ul>'+
      '</div>' : '');
}

/* ---------------- orders ---------------- */
var ORDER_FILTERS = [
  {key:'all', label:'All'},
  {key:'walk_in', label:'Walk-in Purchase'},
  {key:'online', label:'Online Orders'},
  {key:'cod', label:'Reservations'}
];
var ordersFilter = 'all';
var ordersPage = 1;
function renderOrders(body){
  var counts = {all: orders.length, walk_in:0, online:0, cod:0};
  orders.forEach(function(o){ if(counts[o.payment_method]!==undefined) counts[o.payment_method]++; });
  if(!ORDER_FILTERS.some(function(f){return f.key===ordersFilter})) ordersFilter='all';

  var topbar = '<div class="admin-topbar" style="margin-bottom:14px">'+
      '<h2 style="margin:0">Orders &middot; '+orders.length+'</h2>'+
      '<button class="btn btn-primary" id="open-walkin-sale">+ Record walk-in sale</button>'+
    '</div>';
  var subtabs = '<div class="subtabs">'+ORDER_FILTERS.map(function(f){
    return '<button class="subtab-btn'+(ordersFilter===f.key?' active':'')+'" data-filter="'+f.key+'">'+f.label+' <span class="count">'+counts[f.key]+'</span></button>';
  }).join('')+'</div>';

  body.innerHTML = topbar + subtabs + '<div id="order-list"></div>';
  $('open-walkin-sale').addEventListener('click', openWalkinSaleModal);
  body.querySelectorAll('.subtab-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var f = btn.getAttribute('data-filter');
      if(f!==ordersFilter) ordersPage = 1;
      ordersFilter = f;
      renderOrders(body);
    });
  });

  var list = $('order-list');
  var filtered = ordersFilter==='all' ? orders : orders.filter(function(o){ return o.payment_method===ordersFilter; });
  if(!filtered.length){ list.innerHTML = '<p class="empty">No orders in this category yet.</p>'; return; }

  // fit as many order cards as the screen height allows
  var pageSize = computePageSize(105, 400, 3, 20);
  var pr = paginate(filtered, ordersPage, pageSize);
  ordersPage = pr.page;

  list.innerHTML = pr.items.map(function(o){
    var items = (o.shop_order_items||[]).map(function(i){ return esc(i.name_snapshot)+' × '+i.qty+' ('+peso.format(i.subtotal)+')'; }).join('<br>');
    var isWalkin = o.payment_method==='walk_in';
    var buyer = isWalkin ? 'Walk-in sale' : ((o.shop_profiles && o.shop_profiles.full_name) || 'Customer');
    var meta = isWalkin
      ? (o.notes ? 'Note: '+esc(o.notes) : 'In-person sale')
      : 'Deliver to: '+esc(o.deliver_to)+' &middot; '+esc(o.phone)+(o.notes?' &middot; Note: '+esc(o.notes):'')+' &middot; '+o.payment_method.toUpperCase();
    return '<div class="order-card">'+
      '<div class="order-main">'+
        '<div class="order-head"><div><strong>'+esc(buyer)+'</strong>'+(isWalkin?' <span class="pill" style="background:var(--accent-soft);color:var(--accent)">Walk-in</span>':'')+' · '+peso.format(o.total)+' · <span class="helper">'+new Date(o.created_at).toLocaleString('en-PH')+'</span></div></div>'+
        '<div class="order-items">'+items+'</div>'+
        '<div class="order-items">'+meta+'</div>'+
      '</div>'+
      '<div class="order-controls">'+
        '<label>Status<select data-status="'+o.id+'">'+statuses.map(function(s){return '<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+s.replace(/_/g,' ')+'</option>'}).join('')+'</select></label>'+
        '<label>Payment<select data-payment="'+o.id+'"><option value="unpaid"'+(o.payment_status==='unpaid'?' selected':'')+'>Unpaid</option><option value="paid"'+(o.payment_status==='paid'?' selected':'')+'>Paid</option><option value="refunded"'+(o.payment_status==='refunded'?' selected':'')+'>Refunded</option></select></label>'+
      '</div>'+
    '</div>';
  }).join('') + pagerHtml(pr.page, pr.totalPages, 'orders');

  var prevBtn = $('orders-prev'), nextBtn = $('orders-next');
  if(prevBtn) prevBtn.addEventListener('click', function(){ ordersPage--; renderOrders(body); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ ordersPage++; renderOrders(body); });

  list.querySelectorAll('[data-status]').forEach(function(sel){
    sel.addEventListener('change', function(){
      var id=sel.getAttribute('data-status'), val=sel.value;
      var task = val==='cancelled' ? sb.rpc('shop_cancel_order',{p_order_id:id}) : sb.from('shop_orders').update({status:val}).eq('id',id);
      task.then(function(r){
        if(r.error){ toast(r.error.message); return; }
        toast('Order updated');
        if(val!=='cancelled') logActivity('order_status_changed', {order_id:id, status:val});
      });
    });
  });
  list.querySelectorAll('[data-payment]').forEach(function(sel){
    sel.addEventListener('change', function(){
      var id = sel.getAttribute('data-payment'), val = sel.value;
      sb.from('shop_orders').update({payment_status:val}).eq('id',id).then(function(r){
        if(r.error){ toast(r.error.message); return; }
        toast('Payment status updated');
        logActivity('order_payment_changed', {order_id:id, payment_status:val});
      });
    });
  });
}

/* ---------------- products / inventory ---------------- */
function nameTaken(name, excludeId){
  var key = name.trim().toLowerCase();
  return products.some(function(p){ return p.id!==excludeId && p.name.trim().toLowerCase()===key; });
}
function renderProducts(body){
  body.innerHTML =
    '<div class="admin-topbar" style="margin-bottom:14px">'+
      '<h2 style="margin:0">Inventory &middot; '+products.length+' product'+(products.length===1?'':'s')+'</h2>'+
      '<button class="btn btn-primary" id="open-add-product">+ Add product</button>'+
    '</div>'+
    '<div class="tbl-wrap"><table class="prod-table"><colgroup>'+
      '<col class="col-name"><col class="col-num"><col class="col-num"><col class="col-active"><col class="col-save">'+
    '</colgroup><thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead><tbody id="prod-body"></tbody></table></div>';
  $('prod-body').innerHTML = products.map(function(p){
    var thumb = p.image_url
      ? '<img src="'+esc(p.image_url)+'" alt="" class="prod-thumb" onerror="this.style.visibility=\'hidden\'">'
      : '<div class="prod-thumb prod-thumb-empty"></div>';
    return '<tr data-row="'+p.id+'">'+
      '<td><div class="prod-name-cell">'+thumb+
        '<div><strong>'+esc(p.name)+'</strong>'+(p.description?'<div class="helper" style="font-weight:400">'+esc(p.description)+'</div>':'')+'</div>'+
      '</div></td>'+
      '<td>'+peso.format(p.price)+'</td>'+
      '<td>'+p.stock_qty.toLocaleString('en-PH')+'</td>'+
      '<td style="text-align:center"><input type="checkbox" data-active="'+p.id+'" '+(p.active?'checked':'')+'></td>'+
      '<td class="row-actions"><div class="row-actions-btns">'+
        '<button class="btn btn-ghost btn-sm" data-stock="'+p.id+'">+ Stock</button>'+
        '<button class="btn btn-ghost btn-sm" data-edit2="'+p.id+'">Edit</button>'+
      '</div></td>'+
    '</tr>';
  }).join('');
  $('prod-body').querySelectorAll('[data-edit2]').forEach(function(btn){
    btn.addEventListener('click', function(){ openEditProductModal(btn.getAttribute('data-edit2')); });
  });
  $('prod-body').querySelectorAll('[data-stock]').forEach(function(btn){
    btn.addEventListener('click', function(){ openAddStockModal(btn.getAttribute('data-stock')); });
  });
  $('prod-body').querySelectorAll('[data-active]').forEach(function(cb){
    cb.addEventListener('change', function(){
      var id = cb.getAttribute('data-active');
      var val = cb.checked;
      cb.disabled = true;
      sb.from('shop_products').update({active:val}).eq('id',id).then(function(r){
        cb.disabled = false;
        if(r.error){ toast(r.error.message); cb.checked = !val; return; }
        var local = products.find(function(x){return x.id===id});
        if(local) local.active = val;
        toast(val ? 'Product activated' : 'Product deactivated');
        logActivity('product_updated', {name: local?local.name:'', changes: 'active → '+val});
      });
    });
  });
  $('open-add-product').addEventListener('click', openAddProductModal);
}
function openAddProductModal(){
  openModal('Add a product',
    '<form id="new-product" class="form-grid">'+
      '<label class="wide">Name<input id="np-name" required autofocus></label>'+
      '<label class="wide">Description<input id="np-desc"></label>'+
      '<label>Price (₱)<input id="np-price" type="number" min="0" step="0.01" required></label>'+
      '<label>Starting stock<input id="np-stock" type="number" min="0" step="1" value="0" required></label>'+
      '<label class="wide">Image URL (optional)<input id="np-image" placeholder="https://…"></label>'+
      '<div class="wide" style="display:flex;gap:10px;justify-content:flex-end">'+
        '<button type="button" class="btn btn-ghost" id="np-cancel">Cancel</button>'+
        '<button class="btn btn-primary" type="submit">Add product</button>'+
      '</div>'+
    '</form><p class="msg" id="np-msg"></p>'
  );
  $('np-cancel').addEventListener('click', closeModal);
  $('np-name').focus();
  $('new-product').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg=$('np-msg');
    var row = {
      name: $('np-name').value.trim(),
      description: $('np-desc').value.trim()||null,
      price: parseFloat($('np-price').value),
      stock_qty: parseInt($('np-stock').value,10)||0,
      image_url: $('np-image').value.trim()||null
    };
    if(!row.name||!(row.price>=0)){ msg.textContent='Enter a name and a price.'; msg.className='msg err'; return; }
    if(nameTaken(row.name, null)){ msg.textContent='A product named "'+row.name+'" already exists.'; msg.className='msg err'; return; }
    var submitBtn = ev.target.querySelector('button[type=submit]'); submitBtn.disabled = true;
    sb.from('shop_products').insert(row).then(function(r){
      submitBtn.disabled = false;
      if(r.error){ msg.textContent=friendlyDbError(r.error); msg.className='msg err'; return; }
      toast('Product added');
      logActivity('product_added', {name: row.name});
      closeModal();
      showTab('products');
    });
  });
}
function openEditProductModal(id){
  var p = products.find(function(x){return x.id===id});
  if(!p) return;
  openModal('Edit product',
    '<form id="edit-product" class="form-grid">'+
      '<label class="wide">Name<input id="ep-name" value="'+esc(p.name)+'" required autofocus></label>'+
      '<label class="wide">Description<input id="ep-desc" value="'+esc(p.description||'')+'"></label>'+
      '<label>Price (₱)<input id="ep-price" type="number" min="0" step="0.01" value="'+p.price+'" required></label>'+
      '<label class="wide">Image URL<input id="ep-image" value="'+esc(p.image_url||'')+'" placeholder="https://…"></label>'+
      (p.image_url ? '<div class="wide" style="margin-top:-8px"><img src="'+esc(p.image_url)+'" alt="" class="prod-preview" onerror="this.style.display=\'none\'"></div>' : '')+
      '<label class="wide" style="flex-direction:row;align-items:center;gap:8px">'+
        '<input type="checkbox" id="ep-active" '+(p.active?'checked':'')+' style="width:auto;min-height:auto"> <span>Active (visible to customers)</span>'+
      '</label>'+
      '<p class="helper wide" style="margin:2px 0 0">Current stock: <strong>'+p.stock_qty+'</strong> — use "+ Stock" on the Inventory row to add stock (keeps a history).</p>'+
      '<div class="wide" style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">'+
        '<button type="button" class="btn btn-ghost" id="ep-cancel">Cancel</button>'+
        '<button class="btn btn-primary" type="submit">Save changes</button>'+
      '</div>'+
    '</form><p class="msg" id="ep-msg"></p>'
  );
  $('ep-cancel').addEventListener('click', closeModal);
  $('ep-image').addEventListener('input', function(){
    // live-refresh the preview as the URL changes
    var existing = document.querySelector('#modal-body .prod-preview');
    var url = $('ep-image').value.trim();
    if(existing){ existing.src = url; existing.style.display = url ? '' : 'none'; }
  });
  $('edit-product').addEventListener('submit', function(ev){
    ev.preventDefault();
    var msg=$('ep-msg');
    var name = $('ep-name').value.trim();
    if(!name){ msg.textContent='Enter a product name.'; msg.className='msg err'; return; }
    if(nameTaken(name, id)){ msg.textContent='Another product is already named "'+name+'".'; msg.className='msg err'; return; }
    var patch = {
      name: name,
      description: $('ep-desc').value.trim()||null,
      price: parseFloat($('ep-price').value)||0,
      image_url: $('ep-image').value.trim()||null,
      active: $('ep-active').checked
    };
    var submitBtn = ev.target.querySelector('button[type=submit]'); submitBtn.disabled = true;
    sb.from('shop_products').update(patch).eq('id',id).then(function(r){
      submitBtn.disabled = false;
      if(r.error){ msg.textContent=friendlyDbError(r.error); msg.className='msg err'; return; }
      Object.assign(p, patch);
      toast('Product updated');
      logActivity('product_updated', {name: patch.name});
      closeModal();
      showTab('products');
    });
  });
}
function openAddStockModal(id){
  var p = products.find(function(x){return x.id===id});
  if(!p) return;
  openModal('Add stock — '+p.name,
    '<p class="helper" style="margin-top:0">Current stock: <strong>'+p.stock_qty+'</strong></p>'+
    '<label>Quantity to add<input id="as-qty" type="number" min="1" step="1" value="1" required autofocus></label>'+
    '<label style="margin-top:10px">Reason / note (optional)<input id="as-reason" placeholder="e.g. Restock from supplier"></label>'+
    '<p class="msg" id="as-msg"></p>'+
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">'+
      '<button type="button" class="btn btn-ghost" id="as-cancel">Cancel</button>'+
      '<button type="button" class="btn btn-primary" id="as-submit">Add stock</button>'+
    '</div>'
  );
  $('as-cancel').addEventListener('click', closeModal);
  $('as-submit').addEventListener('click', function(){
    var msg = $('as-msg');
    var qty = parseInt($('as-qty').value,10);
    if(!qty || qty<=0){ msg.textContent='Enter a quantity greater than 0.'; msg.className='msg err'; return; }
    var reason = $('as-reason').value.trim() || null;
    var btn = $('as-submit');
    btn.disabled = true;
    sb.rpc('shop_add_stock', {p_product_id:id, p_qty:qty, p_reason:reason}).then(function(r){
      btn.disabled = false;
      if(r.error){ msg.textContent = r.error.message; msg.className='msg err'; return; }
      toast('Stock updated: +'+qty);
      closeModal();
      showTab('products');
    });
  });
}

/* ---------------- activity log ---------------- */
var ACTIVITY_LABELS = {
  stock_added: 'Stock added',
  order_placed: 'Order placed',
  order_cancelled: 'Order cancelled',
  walkin_sale_recorded: 'Walk-in sale recorded',
  product_added: 'Product added',
  product_updated: 'Product updated',
  order_status_changed: 'Order status changed',
  order_payment_changed: 'Payment status changed'
};
function activityLabel(a){ return ACTIVITY_LABELS[a.action] || a.action; }
function activityDetails(a){
  var d = a.details||{};
  switch(a.action){
    case 'stock_added':
      return esc(d.product_name||'')+': +'+d.qty_added+' &rarr; '+d.new_stock+' in stock'+(d.reason?' — '+esc(d.reason):'');
    case 'order_placed':
      return 'Order #'+String(d.order_id||'').slice(0,8)+' &middot; '+peso.format(d.total||0)+' &middot; '+esc((d.payment_method||'').toUpperCase());
    case 'order_cancelled':
      return 'Order #'+String(d.order_id||'').slice(0,8);
    case 'walkin_sale_recorded':
      return peso.format(d.total||0)+(d.note?' — '+esc(d.note):'');
    case 'product_added':
      return esc(d.name||'');
    case 'product_updated':
      return esc(d.name||'')+(d.changes?' ('+esc(d.changes)+')':'');
    case 'order_status_changed':
      return 'Order #'+String(d.order_id||'').slice(0,8)+' &rarr; '+esc((d.status||'').replace(/_/g,' '));
    case 'order_payment_changed':
      return 'Order #'+String(d.order_id||'').slice(0,8)+' &rarr; '+esc(d.payment_status||'');
    default:
      return esc(JSON.stringify(d));
  }
}
var activityPage = 1;
function renderActivityLog(body){
  var topbar = '<div class="admin-topbar" style="margin-bottom:14px">'+
      '<h2 style="margin:0">Activity Log &middot; '+activity.length+'</h2>'+
    '</div>';
  if(!activity.length){ body.innerHTML = topbar+'<p class="empty">No activity recorded yet.</p>'; return; }

  var pageSize = computePageSize(46, 340, 6, 60);
  var pr = paginate(activity, activityPage, pageSize);
  activityPage = pr.page;

  body.innerHTML = topbar +
    '<div class="tbl-wrap"><table class="activity-table"><thead><tr><th>Time</th><th>By</th><th>Action</th><th>Details</th></tr></thead><tbody>'+
    pr.items.map(function(a){
      var who = (a.shop_profiles && a.shop_profiles.full_name) || (a.actor ? 'User' : 'System');
      return '<tr>'+
        '<td class="helper">'+new Date(a.created_at).toLocaleString('en-PH')+'</td>'+
        '<td>'+esc(who)+'</td>'+
        '<td><strong>'+esc(activityLabel(a))+'</strong></td>'+
        '<td class="helper">'+activityDetails(a)+'</td>'+
      '</tr>';
    }).join('') +
    '</tbody></table></div>' + pagerHtml(pr.page, pr.totalPages, 'activity');

  var prevBtn = $('activity-prev'), nextBtn = $('activity-next');
  if(prevBtn) prevBtn.addEventListener('click', function(){ activityPage--; renderActivityLog(body); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ activityPage++; renderActivityLog(body); });
}

/* ---------------- walk-in sale ---------------- */
var walkinRowSeq = 0;
var walkinLabelMap = {}; // display label -> product, rebuilt each time the modal opens
function walkinProductLabel(p){
  return p.name+' — '+peso.format(p.price)+' ('+p.stock_qty+' in stock)'+(p.active?'':' [inactive]');
}
function walkinRowHtml(){
  var rid = 'wr'+(++walkinRowSeq);
  return '<div class="walkin-row" data-wrow="'+rid+'">'+
    '<div style="display:flex;gap:8px;align-items:flex-end">'+
      '<label style="flex:1;margin:0">'+(walkinRowSeq===1?'Product':'')+
        '<input class="wr-product prod-input" list="wk-product-datalist" placeholder="Type to search products…" autocomplete="off"></label>'+
      '<label style="width:90px;margin:0">'+(walkinRowSeq===1?'Qty':'')+'<input class="wr-qty prod-input" type="number" min="1" step="1" value="1"></label>'+
      '<button type="button" class="btn btn-ghost btn-sm wr-remove" style="margin-bottom:1px">✕</button>'+
    '</div>'+
    '<div class="wr-hint helper">Start typing a product name…</div>'+
  '</div>';
}
function openWalkinSaleModal(){
  walkinRowSeq = 0;
  if(!products.length){ toast('Add a product to Inventory first.'); return; }
  walkinLabelMap = {};
  var datalistOptions = products.map(function(p){
    var label = walkinProductLabel(p);
    walkinLabelMap[label] = p;
    return '<option value="'+esc(label)+'">';
  }).join('');
  openModal('Record a walk-in sale',
    '<p class="helper" style="margin-top:0">For sales made in person — deducts stock and counts toward revenue and your commission, same as an online order.</p>'+
    '<datalist id="wk-product-datalist">'+datalistOptions+'</datalist>'+
    '<div id="walkin-rows">'+walkinRowHtml()+'</div>'+
    '<button type="button" class="btn btn-ghost btn-sm" id="wr-add">+ Add another item</button>'+
    '<label style="margin-top:14px">Note (optional)<input id="wk-note" placeholder="e.g. customer name"></label>'+
    '<label class="wide" style="margin-top:10px;flex-direction:row;align-items:center;gap:8px">'+
      '<input type="checkbox" id="wk-paid" checked style="width:auto;min-height:auto"> <span>Payment received</span>'+
    '</label>'+
    '<p class="msg" id="wk-msg"></p>'+
    '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">'+
      '<button type="button" class="btn btn-ghost" id="wk-cancel">Cancel</button>'+
      '<button type="button" class="btn btn-primary" id="wk-submit">Record sale</button>'+
    '</div>'
  );
  $('wr-add').addEventListener('click', function(){
    $('walkin-rows').insertAdjacentHTML('beforeend', walkinRowHtml());
    bindWalkinRowRemove();
    bindWalkinRowInput();
  });
  bindWalkinRowRemove();
  bindWalkinRowInput();
  $('wk-cancel').addEventListener('click', closeModal);
  $('wk-submit').addEventListener('click', submitWalkinSale);
}
function bindWalkinRowRemove(){
  document.querySelectorAll('.wr-remove').forEach(function(btn){
    btn.onclick = function(){
      var rows = document.querySelectorAll('.walkin-row');
      if(rows.length<=1){ toast('At least one item is needed.'); return; }
      btn.closest('.walkin-row').remove();
    };
  });
}
function bindWalkinRowInput(){
  document.querySelectorAll('.wr-product').forEach(function(input){
    if(input.dataset.bound) return;
    input.dataset.bound = '1';
    input.addEventListener('input', function(){ updateWalkinRowHint(input); });
  });
}
function updateWalkinRowHint(input){
  var row = input.closest('.walkin-row');
  var hint = row.querySelector('.wr-hint');
  var val = input.value.trim();
  if(!val){
    input.removeAttribute('data-pid');
    hint.textContent = 'Start typing a product name…';
    hint.style.color = '';
    return;
  }
  var p = walkinLabelMap[val];
  if(p){
    input.setAttribute('data-pid', p.id);
    hint.textContent = '✓ '+p.name+' — '+p.stock_qty+' in stock';
    hint.style.color = 'var(--ok)';
  } else {
    input.removeAttribute('data-pid');
    hint.textContent = 'Keep typing or choose a suggestion from the list';
    hint.style.color = 'var(--muted)';
  }
}
function submitWalkinSale(){
  var msg = $('wk-msg');
  var items = [];
  var bad = false;
  document.querySelectorAll('.walkin-row').forEach(function(row){
    var input = row.querySelector('.wr-product');
    var pid = input.getAttribute('data-pid');
    var qty = parseInt(row.querySelector('.wr-qty').value,10);
    if(!input.value.trim()) return;
    if(!pid){ bad = 'match'; return; }
    if(!qty || qty<=0){ bad = bad || 'qty'; return; }
    items.push({product_id: pid, qty: qty});
  });
  if(bad==='match'){ msg.textContent='Pick a product from the suggestions for each item.'; msg.className='msg err'; return; }
  if(bad==='qty'){ msg.textContent='Quantities must be at least 1.'; msg.className='msg err'; return; }
  if(!items.length){ msg.textContent='Type a product name and pick a match.'; msg.className='msg err'; return; }
  var note = $('wk-note').value.trim() || null;
  var paid = $('wk-paid').checked;
  var btn = $('wk-submit');
  btn.disabled = true;
  sb.rpc('shop_record_walkin_sale', {p_items: items, p_notes: note, p_paid: paid}).then(function(r){
    btn.disabled = false;
    if(r.error){ msg.textContent = r.error.message; msg.className='msg err'; return; }
    toast('Walk-in sale recorded');
    closeModal();
    showTab('orders');
  });
}

boot();
})();
