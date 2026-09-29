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

function loadAll(){
  return Promise.all([
    sb.from('shop_products').select('*').order('name'),
    sb.from('shop_orders').select('*, shop_order_items(*), shop_profiles(full_name)').order('created_at',{ascending:false})
  ]).then(function(r){
    if(r[0].error) throw r[0].error;
    if(r[1].error) throw r[1].error;
    products = r[0].data||[];
    orders = r[1].data||[];
  });
}

/* ---------------- gate + boot ---------------- */
function boot(){
  sb.auth.getSession().then(function(r){
    var session = r.data.session;
    if(!session){
      $('app').innerHTML = '<p class="empty">Sign in with an admin account to view this page. <a href="index.html#/login">Sign in</a></p>';
      return;
    }
    sb.from('shop_profiles').select('*').eq('id',session.user.id).single().then(function(r){
      var profile = r.data;
      $('acct').innerHTML = esc((profile&&profile.full_name) || session.user.email)+' &middot; <button class="linklike" id="signout-btn">Sign out</button>';
      var sob=$('signout-btn'); if(sob) sob.addEventListener('click', function(){ sb.auth.signOut().then(function(){ location.href='index.html'; }); });
      if(!profile || profile.role!=='admin'){
        $('app').innerHTML = '<p class="empty">This account is not an admin. <a href="index.html">Back to shop</a></p>';
        return;
      }
      initTabs();
    });
  });
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
function showTab(tab){
  var body = $('admin-body');
  body.innerHTML = '<p class="helper">Loading…</p>';
  loadAll().then(function(){
    if(tab==='dashboard') renderDashboard(body);
    else if(tab==='orders') renderOrders(body);
    else renderProducts(body);
  }).catch(function(e){ body.innerHTML = errBox(e); });
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
function renderOrders(body){
  if(!orders.length){ body.innerHTML='<p class="empty">No orders yet.</p>'; return; }
  body.innerHTML = orders.map(function(o){
    var items = (o.shop_order_items||[]).map(function(i){ return esc(i.name_snapshot)+' × '+i.qty+' ('+peso.format(i.subtotal)+')'; }).join('<br>');
    var buyer = (o.shop_profiles && o.shop_profiles.full_name) || 'Customer';
    return '<div class="order-card">'+
      '<div class="order-head"><div><strong>'+esc(buyer)+'</strong> · '+peso.format(o.total)+' · <span class="helper">'+new Date(o.created_at).toLocaleString('en-PH')+'</span></div></div>'+
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
    '</colgroup><thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Active</th><th></th></tr></thead><tbody id="prod-body"></tbody></table></div>';
  $('prod-body').innerHTML = products.map(function(p){
    return '<tr data-row="'+p.id+'">'+
      '<td><input class="prod-input" value="'+esc(p.name)+'" data-f="name" title="'+esc(p.name)+'" disabled></td>'+
      '<td><input class="prod-input" type="number" step="0.01" value="'+p.price+'" data-f="price" disabled></td>'+
      '<td><input class="prod-input" type="number" step="1" value="'+p.stock_qty+'" data-f="stock_qty" disabled></td>'+
      '<td style="text-align:center"><input type="checkbox" data-f="active" '+(p.active?'checked':'')+' disabled></td>'+
      '<td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="'+p.id+'">Edit</button></td>'+
    '</tr>';
  }).join('');
  $('prod-body').querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){ enterEditMode(btn.getAttribute('data-edit')); });
  });
  $('open-add-product').addEventListener('click', openAddProductModal);
}
function enterEditMode(id){
  var row = $('prod-body').querySelector('[data-row="'+id+'"]');
  if(!row) return;
  row.classList.add('editing');
  row.querySelectorAll('input').forEach(function(inp){ inp.disabled = false; });
  var nameInput = row.querySelector('[data-f=name]');
  nameInput.focus();
  nameInput.select();
  var cell = row.querySelector('.row-actions');
  cell.innerHTML =
    '<div class="row-actions-btns">'+
      '<button class="btn btn-ghost btn-sm" data-cancel="'+id+'">Cancel</button>'+
      '<button class="btn btn-primary btn-sm" data-save="'+id+'">Save</button>'+
    '</div>';
  cell.querySelector('[data-cancel]').addEventListener('click', function(){ exitEditMode(id); });
  cell.querySelector('[data-save]').addEventListener('click', function(){ saveRow(id); });
}
function exitEditMode(id){
  var row = $('prod-body').querySelector('[data-row="'+id+'"]');
  if(!row) return;
  var local = products.find(function(x){return x.id===id});
  row.classList.remove('editing');
  row.querySelectorAll('input').forEach(function(inp){
    var f = inp.getAttribute('data-f');
    if(local){ if(f==='active') inp.checked = !!local.active; else inp.value = local[f]; }
    inp.disabled = true;
  });
  var cell = row.querySelector('.row-actions');
  cell.innerHTML = '<button class="btn btn-ghost btn-sm" data-edit="'+id+'">Edit</button>';
  cell.querySelector('[data-edit]').addEventListener('click', function(){ enterEditMode(id); });
}
function saveRow(id){
  var row = $('prod-body').querySelector('[data-row="'+id+'"]');
  if(!row) return;
  var name = row.querySelector('[data-f=name]').value.trim();
  if(!name){ toast('Product name can\'t be empty.'); return; }
  if(nameTaken(name, id)){ toast('Another product is already named "'+name+'".'); return; }
  var patch = {
    name: name,
    price: parseFloat(row.querySelector('[data-f=price]').value)||0,
    stock_qty: parseInt(row.querySelector('[data-f=stock_qty]').value,10)||0,
    active: row.querySelector('[data-f=active]').checked
  };
  var saveBtn = row.querySelector('[data-save]');
  if(saveBtn) saveBtn.disabled = true;
  sb.from('shop_products').update(patch).eq('id',id).then(function(r){
    if(saveBtn) saveBtn.disabled = false;
    if(r.error){ toast(friendlyDbError(r.error)); return; }
    var local = products.find(function(x){return x.id===id});
    if(local) Object.assign(local, patch);
    toast('Saved');
    exitEditMode(id);
  });
}
function openAddProductModal(){
  openModal('Add a product',
    '<form id="new-product" class="form-grid">'+
      '<label class="wide">Name<input id="np-name" required autofocus></label>'+
      '<label class="wide">Description<input id="np-desc"></label>'+
      '<label>Price (₱)<input id="np-price" type="number" min="0" step="0.01" required></label>'+
      '<label>Starting stock<input id="np-stock" type="number" min="0" step="1" value="0" required></label>'+
      '<label class="wide">Image URL (optional)<input id="np-image"></label>'+
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
      closeModal();
      showTab('products');
    });
  });
}

boot();
})();
