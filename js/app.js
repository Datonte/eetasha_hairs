/* ============================================================
   ee_tasha hairs — Core Application Logic
   All data comes from the server API (no localStorage for data).
   Cart is the only thing stored locally (no sensitive data).
   ============================================================ */

// ============================================================
//  GLOBAL STATE  (populated by initApp())
// ============================================================
const State = {
  products: [],
  session:  null,   // logged-in customer { id, name, email, ... }
  settings: {
    whatsapp: '+447951828832', instagram: '@ee_tasha.hairs',
    currency: '£',  deliveryFee: 5.99,
    bankName: '', sortCode: '', accountNumber: '', accountName: 'ee_tasha hairs',
  },
};

// ============================================================
//  API WRAPPER  (thin fetch helper)
// ============================================================
const API = {
  async _req(method, url, data) {
    const opts = { method, headers: {} };
    // Attach Supabase JWT for authenticated requests
    if (window._supabase) {
      const { data: { session } } = await window._supabase.auth.getSession();
      if (session?.access_token) opts.headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    if (data !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    const res  = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  },
  get:    (url)        => API._req('GET',    url),
  post:   (url, data)  => API._req('POST',   url, data),
  put:    (url, data)  => API._req('PUT',    url, data),
  delete: (url)        => API._req('DELETE', url),
};

// ============================================================
//  INIT  (call once per page; safe to call multiple times)
// ============================================================
let _initPromise = null;
function initApp() {
  if (!_initPromise) _initPromise = _doInit();
  return _initPromise;
}
async function _doInit() {
  try {
    // Step 1: fetch config and initialise Supabase client
    const config = await API.get('/api/config').catch(() => ({}));
    if (config.supabaseUrl && config.supabaseAnonKey) {
      window._supabase = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    }

    // Step 2: session + products + settings in parallel
    const [sessionRes, productsRes, settingsRes] = await Promise.allSettled([
      window._supabase ? window._supabase.auth.getSession() : Promise.resolve(null),
      API.get('/api/products'),
      API.get('/api/settings'),
    ]);

    // Auth state comes from Supabase directly (no /api/auth/me needed)
    const supaUser = sessionRes.value?.data?.session?.user || null;
    State.session  = supaUser ? {
      id:         supaUser.id,
      name:       supaUser.user_metadata?.name || '',
      email:      supaUser.email,
      created_at: supaUser.created_at,
    } : null;

    State.products = (productsRes.status === 'fulfilled' && Array.isArray(productsRes.value)) ? productsRes.value : [];
    const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : null;
    if (settings && typeof settings === 'object') {
      State.settings = { ...State.settings, ...settings, deliveryFee: parseFloat(settings.deliveryFee) || 5.99 };
    }

    // Sync cart — remove items that no longer exist or are out of stock
    if (State.products.length > 0) {
      const before  = _getRawCart();
      const after   = before.filter(item => {
        const p = State.products.find(p => String(p.id) === String(item.productId));
        return p && p.in_stock;
      });
      if (after.length < before.length) {
        _saveRawCart(after);
        const removed = before.length - after.length;
        setTimeout(() => Toast.show(
          `${removed} item${removed > 1 ? 's were' : ' was'} removed from your cart — no longer available.`, 'info'
        ), 600);
      }
    }
  } catch (err) {
    console.warn('initApp error:', err.message);
  }
}

// ============================================================
//  STORE  (public interface for page scripts)
// ============================================================
const Store = {
  // ---- Products (in-memory after init) ----
  getProducts()  { return State.products; },
  getProduct(id) { return State.products.find(p => String(p.id) === String(id)); },

  // ---- Session (in-memory after init) ----
  getSession()   { return State.session; },

  // ---- Settings (in-memory after init) ----
  getSettings()  { return State.settings; },

  // ---- Cart (localStorage — no sensitive data) ----
  getCart()      { return _getRawCart(); },
  addToCart(productId, qty = 1) {
    const id   = String(productId);
    const cart = _getRawCart();
    const item = cart.find(i => i.productId === id);
    if (item) item.qty += qty; else cart.push({ productId: id, qty });
    _saveRawCart(cart);
    updateCartCount();
    Toast.show('Added to bag', 'success');
  },
  updateCartQty(productId, qty) {
    const id = String(productId);
    let cart  = _getRawCart();
    if (qty <= 0) cart = cart.filter(i => i.productId !== id);
    else          cart = cart.map(i => i.productId === id ? { ...i, qty } : i);
    _saveRawCart(cart);
    updateCartCount();
  },
  removeFromCart(productId) {
    const id = String(productId);
    _saveRawCart(_getRawCart().filter(i => i.productId !== id));
    updateCartCount();
  },
  clearCart() { _saveRawCart([]); updateCartCount(); },
  getCartTotal() {
    return _getRawCart().reduce((sum, item) => {
      const p = this.getProduct(item.productId);
      return sum + (p ? p.price * item.qty : 0);
    }, 0);
  },
};

function _getRawCart() {
  try { return JSON.parse(localStorage.getItem('et_cart')) || []; } catch { return []; }
}
function _saveRawCart(c) { localStorage.setItem('et_cart', JSON.stringify(c)); }

// ============================================================
//  CART UI
// ============================================================
function updateCartCount() {
  const count = _getRawCart().reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('.cart-count').forEach(el => { el.textContent = count || ''; });
}

function renderCartSidebar() {
  const cart      = Store.getCart();
  const container = document.getElementById('cartItems');
  const footer    = document.getElementById('cartFooter');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `<div class="cart-empty"><span class="material-symbols-outlined">shopping_bag</span><p>Your cart is empty</p></div>`;
    footer?.classList.add('hidden');
    return;
  }
  footer?.classList.remove('hidden');

  const { currency } = State.settings;
  container.innerHTML = cart.map(item => {
    const p = Store.getProduct(item.productId);
    if (!p) return '';
    return `
      <div class="cart-item">
        <img class="cart-item-img" src="${escHtml(p.image_url || '')}" alt="${escHtml(p.name)}" onerror="this.style.background='var(--gray-200)'">
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(p.name)}</div>
          <div class="cart-item-price">${currency}${p.price.toFixed(2)}</div>
          <div class="cart-item-qty">
            <button onclick="Store.updateCartQty('${p.id}', ${item.qty - 1}); renderCartSidebar();">−</button>
            <span>${item.qty}</span>
            <button onclick="Store.updateCartQty('${p.id}', ${item.qty + 1}); renderCartSidebar();">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="Store.removeFromCart('${p.id}'); renderCartSidebar();">
          <span class="material-symbols-outlined" style="font-size:18px">close</span>
        </button>
      </div>`;
  }).join('');

  const totalEl = document.getElementById('cartTotal');
  if (totalEl) totalEl.textContent = `${currency}${Store.getCartTotal().toFixed(2)}`;
}

function openCart()  {
  renderCartSidebar();
  document.getElementById('cartOverlay')?.classList.add('open');
  document.getElementById('cartSidebar')?.classList.add('open');
}
function closeCart() {
  document.getElementById('cartOverlay')?.classList.remove('open');
  document.getElementById('cartSidebar')?.classList.remove('open');
}

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================
const Toast = {
  show(message, type = 'info') {
    let box = document.querySelector('.toast-container');
    if (!box) { box = document.createElement('div'); box.className = 'toast-container'; document.body.appendChild(box); }
    const t    = document.createElement('div');
    t.className = `toast ${type}`;
    const icon  = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';
    t.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${icon}</span><span></span>`;
    t.querySelector('span:last-child').textContent = message;
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  },
};

// ============================================================
//  NAV
// ============================================================
function renderNav(activePage = '', opts = {}) {
  const nav  = document.getElementById('siteNav');
  if (!nav) return;
  const sess       = Store.getSession();
  const adminMode  = opts.adminMode || false;
  nav.innerHTML = `
    <nav class="nav">
      <div class="nav-inner">
        <a href="index.html" class="nav-brand">ee_tasha hairs</a>
        <div class="nav-links" id="navLinks">
          <a href="index.html" class="${activePage === 'home'    ? 'active' : ''}">Home</a>
          <a href="shop.html"  class="${activePage === 'shop'    ? 'active' : ''}">Shop</a>
          <a href="about.html" class="${activePage === 'about'   ? 'active' : ''}">About</a>
          <a href="account.html" class="${activePage === 'account' ? 'active' : ''}">${sess ? 'My Account' : 'Login'}</a>
        </div>
        <div class="nav-actions">
          ${!adminMode && sess ? `
          <button onclick="openChangePasswordModal()" aria-label="Change Password" title="Change Password" style="font-size:0.78rem;padding:6px 10px;border:1px solid var(--gold-dark);border-radius:6px;color:var(--gold-dark);background:none;cursor:pointer;font-family:inherit;">Password</button>
          <button onclick="navLogout()" aria-label="Sign Out" title="Sign Out" style="font-size:0.78rem;padding:6px 10px;border:1px solid var(--gray-300);border-radius:6px;color:var(--gray-600);background:none;cursor:pointer;font-family:inherit;">Sign Out</button>
          <button onclick="openCart()" aria-label="Cart">
            <span class="material-symbols-outlined">shopping_bag</span>
            <span class="cart-count"></span>
          </button>` : ''}
          ${!adminMode ? `<button class="nav-mobile-toggle" onclick="document.getElementById('navLinks').classList.toggle('open')" aria-label="Menu">
            <span class="material-symbols-outlined">menu</span>
          </button>` : ''}
        </div>
      </div>
    </nav>
    <div class="cart-overlay" id="cartOverlay" onclick="closeCart()"></div>
    <div class="cart-sidebar" id="cartSidebar">
      <div class="cart-header">
        <h2 class="serif">Your Bag</h2>
        <button onclick="closeCart()"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="cart-items" id="cartItems"></div>
      <div class="cart-footer" id="cartFooter">
        <div class="cart-total">
          <span class="cart-total-label">Total</span>
          <span class="cart-total-amount serif" id="cartTotal">£0.00</span>
        </div>
        <a href="delivery.html" class="btn btn-primary btn-full" onclick="closeCart()">Checkout</a>
      </div>
    </div>`;
  updateCartCount();
}

// ============================================================
//  NAV AUTH ACTIONS (available on all pages)
// ============================================================
async function navLogout() {
  if (window._supabase) await window._supabase.auth.signOut().catch(() => {});
  State.session = null;
  Toast.show('Signed out.', 'info');
  setTimeout(() => { window.location.href = 'index.html'; }, 800);
}

function openChangePasswordModal() {
  let modal = document.getElementById('_cpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = '_cpModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:32px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h2 style="margin:0 0 8px;font-family:var(--font-serif);">Change Password</h2>
        <p style="color:var(--gray-500);font-size:0.9rem;margin:0 0 20px;">Enter a new password for your account.</p>
        <form onsubmit="submitChangePassword(event)">
          <div class="form-group">
            <label class="form-label">New Password</label>
            <input type="password" class="form-input" id="_cpInput" placeholder="At least 8 characters" minlength="8" required autocomplete="new-password">
          </div>
          <div style="display:flex;gap:10px;margin-top:8px;">
            <button type="submit" class="btn btn-primary" id="_cpBtn" style="flex:1;">Update Password</button>
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('_cpModal').remove()">Cancel</button>
          </div>
        </form>
      </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('_cpInput')?.focus(), 50);
}

async function submitChangePassword(e) {
  e.preventDefault();
  const btn = document.getElementById('_cpBtn');
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const password = document.getElementById('_cpInput').value;
    const { error } = await window._supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    Toast.show('Password changed successfully.', 'success');
    document.getElementById('_cpModal').remove();
  } catch (err) {
    Toast.show(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Update Password';
  }
}

// ============================================================
//  FOOTER
// ============================================================
function renderFooter() {
  const footer = document.getElementById('siteFooter');
  if (!footer) return;
  const s = State.settings;
  footer.innerHTML = `
    <footer class="footer">
      <div class="container">
        <div class="footer-inner">
          <div>
            <div class="footer-brand">ee_tasha hairs</div>
            <p class="footer-desc">Premium luxury hair for the modern woman. Quality that speaks for itself.</p>
            <div class="social-links">
              ${s.instagram ? `<a href="https://instagram.com/${escHtml(s.instagram.replace('@',''))}" target="_blank" rel="noopener" title="Instagram"><span class="material-symbols-outlined" style="font-size:18px">photo_camera</span></a>` : ''}
              ${s.whatsapp  ? `<a href="https://wa.me/${s.whatsapp.replace(/[^0-9]/g,'')}" target="_blank" rel="noopener" title="WhatsApp"><span class="material-symbols-outlined" style="font-size:18px">chat</span></a>` : ''}
            </div>
          </div>
          <div>
            <h4>Quick Links</h4>
            <a href="shop.html">Shop All</a>
            <a href="about.html">About Us</a>
            <a href="account.html">My Account</a>
          </div>
          <div>
            <h4>Customer Care</h4>
            <a href="about.html#contact">Contact Us</a>
            ${s.whatsapp ? `<a href="https://wa.me/${s.whatsapp.replace(/[^0-9]/g,'')}" target="_blank" rel="noopener">WhatsApp Support</a>` : ''}
          </div>
        </div>
        <div class="footer-bottom">© ${new Date().getFullYear()} ee_tasha hairs. All rights reserved.</div>
      </div>
    </footer>`;
}

// ============================================================
//  PRODUCT CARD
// ============================================================
function productCardHTML(p) {
  const { currency } = State.settings;
  const desc = escHtml(p.description || '');
  return `
    <div class="product-card" ontouchstart="this.classList.toggle('desc-open')">
      <div class="product-card-img-wrap">
        <img class="product-card-img" src="${escHtml(p.image_url || '')}" alt="${escHtml(p.name)}" onerror="this.style.background='var(--gray-200)'" loading="lazy">
        ${desc ? `<div class="product-card-overlay"><p class="product-card-overlay-text">${desc}</p></div>` : ''}
      </div>
      <div class="product-card-body">
        <div class="product-card-category">${escHtml(p.category || 'Hair')}</div>
        <div class="product-card-name">${escHtml(p.name)}</div>
        <div class="product-card-price">${currency}${Number(p.price).toFixed(2)}</div>
        ${p.in_stock
          ? `<button class="btn btn-primary btn-sm btn-full" onclick="addToCartOrLogin('${p.id}')">Add to Bag</button>`
          : `<span class="product-card-stock stock-out">Out of Stock</span>`}
      </div>
    </div>`;
}

function addToCartOrLogin(productId) {
  if (!Store.getSession()) {
    window.location.href = 'account.html';
    return;
  }
  Store.addToCart(productId);
  openCart();
}

// ============================================================
//  HELPERS
// ============================================================
function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str || '')));
  return d.innerHTML;
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatCurrency(amount) {
  return `${State.settings.currency || '£'}${Number(amount).toFixed(2)}`;
}
