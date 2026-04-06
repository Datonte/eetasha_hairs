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
    whatsapp: '+44', instagram: '@eetashahairs',
    currency: '£',  deliveryFee: 5.99,
    bankName: '', sortCode: '', accountNumber: '', accountName: 'ee_tasha hairs',
  },
};

// ============================================================
//  API WRAPPER  (thin fetch helper)
// ============================================================
const API = {
  async _req(method, url, data) {
    const opts = { method, credentials: 'include', headers: {} };
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
    const [productsRes, authRes, settingsRes] = await Promise.allSettled([
      API.get('/api/products'),
      API.get('/api/auth/me'),
      API.get('/api/settings'),
    ]);
    State.products = (productsRes.status === 'fulfilled' && Array.isArray(productsRes.value)) ? productsRes.value : [];
    State.session  = (authRes.status === 'fulfilled' ? authRes.value?.user : null) || null;
    const settings = settingsRes.status === 'fulfilled' ? settingsRes.value : null;
    if (settings && typeof settings === 'object') {
      State.settings = { ...State.settings, ...settings, deliveryFee: parseFloat(settings.deliveryFee) || 5.99 };
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
function renderNav(activePage = '') {
  const nav  = document.getElementById('siteNav');
  if (!nav) return;
  const sess = Store.getSession();
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
          ${sess ? `<button onclick="openCart()" aria-label="Cart">
            <span class="material-symbols-outlined">shopping_bag</span>
            <span class="cart-count"></span>
          </button>` : ''}
          <button class="nav-mobile-toggle" onclick="document.getElementById('navLinks').classList.toggle('open')" aria-label="Menu">
            <span class="material-symbols-outlined">menu</span>
          </button>
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
        <a href="checkout.html" class="btn btn-primary btn-full" onclick="closeCart()">Checkout</a>
      </div>
    </div>`;
  updateCartCount();
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
  return `
    <div class="product-card">
      <img class="product-card-img" src="${escHtml(p.image_url || '')}" alt="${escHtml(p.name)}" onerror="this.style.background='var(--gray-200)'" loading="lazy">
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
