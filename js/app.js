/* ============================================================
   eetashacollection — Core Application Logic
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
    whatsapp: '+447951828832', instagram: '@eetashacollection',
    currency: '£',  deliveryFee: 5.99,
    bankName: '', sortCode: '', accountNumber: '', accountName: 'eetashacollection',
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
// Safety net — if page-ready was never added (e.g. JS error), reveal after 1.5s
setTimeout(() => document.body.classList.add('page-ready'), 1500);
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
  addToCart(productId, qty = 1, variant = null) {
    const id  = String(productId);
    const vk  = variant?.key || null;
    const cart = _getRawCart();
    const item = cart.find(i => i.productId === id && i.variantKey === vk);
    if (item) { item.qty += qty; }
    else { cart.push({ productId: id, variantKey: vk, variantLabel: variant?.label || null, variantPrice: variant?.price ?? null, qty }); }
    _saveRawCart(cart);
    updateCartCount();
    Toast.show('Added to bag', 'success');
  },
  updateCartQty(productId, qty, variantKey = null) {
    const id = String(productId);
    const vk = variantKey || null;
    let cart = _getRawCart();
    if (qty <= 0) cart = cart.filter(i => !(i.productId === id && i.variantKey === vk));
    else          cart = cart.map(i => (i.productId === id && i.variantKey === vk) ? { ...i, qty } : i);
    _saveRawCart(cart);
    updateCartCount();
  },
  removeFromCart(productId, variantKey = null) {
    const id = String(productId);
    const vk = variantKey || null;
    _saveRawCart(_getRawCart().filter(i => !(i.productId === id && i.variantKey === vk)));
    updateCartCount();
  },
  clearCart() { _saveRawCart([]); updateCartCount(); },
  getCartTotal() {
    return _getRawCart().reduce((sum, item) => {
      const p = this.getProduct(item.productId);
      const price = item.variantPrice ?? (p ? productPrice(p) : 0);
      return sum + (price * item.qty);
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
    const unitPrice = item.variantPrice ?? productPrice(p);
    const vk = item.variantKey ? JSON.stringify(item.variantKey) : 'null';
    return `
      <div class="cart-item">
        <img class="cart-item-img" src="${escHtml(p.image_url || '/images/placeholder.svg')}" alt="${escHtml(p.name)}" onerror="this.onerror=null;this.src='/images/placeholder.svg'">
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(p.name)}</div>
          ${item.variantLabel ? `<div style="font-size:0.72rem;color:var(--gray-500);margin-bottom:2px;">${escHtml(item.variantLabel)}</div>` : ''}
          <div class="cart-item-price">${currency}${unitPrice.toFixed(2)}</div>
          <div class="cart-item-qty">
            <button onclick="Store.updateCartQty('${p.id}', ${item.qty - 1}, ${vk}); renderCartSidebar();">−</button>
            <span>${item.qty}</span>
            <button onclick="Store.updateCartQty('${p.id}', ${item.qty + 1}, ${vk}); renderCartSidebar();">+</button>
          </div>
        </div>
        <button class="cart-item-remove" onclick="Store.removeFromCart('${p.id}', ${vk}); renderCartSidebar();">
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
        <a href="/" class="nav-brand">eetashacollection</a>
        <div class="nav-links" id="navLinks">
          <a href="/" class="${activePage === 'home'    ? 'active' : ''}">Home</a>
          <a href="/shop"  class="${activePage === 'shop'    ? 'active' : ''}">Shop</a>
          <a href="/about" class="${activePage === 'about'   ? 'active' : ''}">About</a>
          <a href="/account" class="${activePage === 'account' ? 'active' : ''}">${sess ? 'My Account' : 'Login'}</a>
        </div>
        <div class="nav-actions">
          ${!adminMode && sess ? `
          <button onclick="openChangePasswordModal()" aria-label="Change Password" title="Change Password" style="font-size:0.78rem;padding:6px 10px;border:1px solid var(--gold-dark);border-radius:6px;color:var(--gold-dark);background:none;cursor:pointer;font-family:inherit;">Password</button>
          <button onclick="navLogout()" aria-label="Sign Out" title="Sign Out" style="font-size:0.78rem;padding:6px 10px;border:1px solid var(--gray-300);border-radius:6px;color:var(--gray-600);background:none;cursor:pointer;font-family:inherit;">Sign Out</button>` : ''}
          ${!adminMode ? `
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
        <a href="/delivery" class="btn btn-primary btn-full" onclick="closeCart()">Checkout</a>
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
  setTimeout(() => { window.location.href = '/'; }, 800);
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
//  BRAND LOGOS  (Instagram & WhatsApp shapes from Simple Icons, CC0 licence)
//  Drawn in currentColor so they match whatever button they sit in.
// ============================================================
const BRAND_ICON_PATHS = {
  instagram: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
  whatsapp:  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
};
function brandIcon(name, size = 18) {
  const d = BRAND_ICON_PATHS[name];
  return d ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style="flex-shrink:0;vertical-align:middle;"><path d="${d}"/></svg>` : '';
}
// Replace any <span data-brand-icon="instagram|whatsapp"> placeholders on the page
function hydrateBrandIcons(root = document) {
  root.querySelectorAll('[data-brand-icon]').forEach(el => {
    el.outerHTML = brandIcon(el.dataset.brandIcon, Number(el.dataset.size) || 18);
  });
}
// Instagram + WhatsApp links from Admin → Settings
function socialLinks(whatsappMessage = '') {
  const s = State.settings || {};
  const handle = String(s.instagram || '').trim().replace(/^@/, '');
  const wa = String(s.whatsapp || '').replace(/[^0-9]/g, '');
  return {
    handle,
    igUrl: handle ? `https://instagram.com/${encodeURIComponent(handle)}` : '',
    waUrl: wa ? `https://wa.me/${wa}${whatsappMessage ? `?text=${encodeURIComponent(whatsappMessage)}` : ''}` : '',
  };
}
// One-line version under "Add to Bag" in the option pickers
function pickerSocialLine(productName = '') {
  const l = socialLinks(productName ? `Hi! I have a question about the ${productName}.` : '');
  if (!l.igUrl && !l.waUrl) return '';
  return `<p class="picker-social">Not sure?
    ${l.igUrl ? `See more photos &amp; videos on <a href="${l.igUrl}" target="_blank" rel="noopener">Instagram</a>` : ''}${l.igUrl && l.waUrl ? ', or ' : ''}
    ${l.waUrl ? `ask us on <a href="${l.waUrl}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${l.igUrl ? ' or Instagram' : ''}.</p>`;
}

// "See more on Instagram / message us" section, used on the home, shop and product pages
function socialCtaHTML({ productName = '' } = {}) {
  const l = socialLinks(productName ? `Hi! I have a question about the ${productName}.` : 'Hi! I have a question about your hair.');
  if (!l.igUrl && !l.waUrl) return '';
  return `
    <div class="social-cta">
      <div class="social-cta-text">
        <h3 class="serif">${productName ? 'Want to see more?' : 'See it before you buy'}</h3>
        <p>For more pictures and videos${productName ? ' of this hair' : ' of our hair'}, check out our Instagram.
           Not sure what to choose, or have a question? Message us on WhatsApp or Instagram and we'll help.</p>
      </div>
      <div class="social-cta-buttons">
        ${l.igUrl ? `<a href="${l.igUrl}" target="_blank" rel="noopener" class="btn btn-instagram">${brandIcon('instagram', 18)}<span>See more on Instagram</span></a>` : ''}
        ${l.waUrl ? `<a href="${l.waUrl}" target="_blank" rel="noopener" class="btn btn-whatsapp">${brandIcon('whatsapp', 18)}<span>Message us on WhatsApp</span></a>` : ''}
      </div>
      ${l.handle ? `<div class="social-cta-handle">@${escHtml(l.handle)}</div>` : ''}
    </div>`;
}

// ============================================================
//  FOOTER
// ============================================================
function renderFooter() {
  const footer = document.getElementById('siteFooter');
  if (!footer) return;
  const s = State.settings;
  const l = socialLinks();
  footer.innerHTML = `
    <footer class="footer">
      <div class="container">
        <div class="footer-inner">
          <div>
            <div class="footer-brand">eetashacollection</div>
            <p class="footer-desc">Premium luxury hair for the modern woman. Quality that speaks for itself.</p>
            <div class="social-links">
              ${l.igUrl ? `<a href="${l.igUrl}" target="_blank" rel="noopener" title="Instagram" aria-label="Instagram">${brandIcon('instagram', 18)}</a>` : ''}
              ${l.waUrl ? `<a href="${l.waUrl}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">${brandIcon('whatsapp', 18)}</a>` : ''}
            </div>
            ${l.igUrl ? `<p class="footer-desc" style="margin-top:12px;">More photos &amp; videos on Instagram <a href="${l.igUrl}" target="_blank" rel="noopener" style="display:inline;color:var(--gold-light);">@${escHtml(l.handle)}</a></p>` : ''}
          </div>
          <div>
            <h4>Quick Links</h4>
            <a href="/shop">Shop All</a>
            <a href="/about">About Us</a>
            <a href="/account">My Account</a>
          </div>
          <div>
            <h4>Customer Care</h4>
            <a href="/about#contact">Contact Us</a>
            <a href="/returns">Returns &amp; Refunds</a>
            <a href="/returns#delivery">Delivery</a>
            ${l.waUrl ? `<a href="${l.waUrl}" target="_blank" rel="noopener">WhatsApp Support</a>` : ''}
            ${l.igUrl ? `<a href="${l.igUrl}" target="_blank" rel="noopener">Instagram</a>` : ''}
          </div>
        </div>
        <div class="footer-bottom">© ${new Date().getFullYear()} eetashacollection. All rights reserved.</div>
      </div>
    </footer>`;
  hydrateBrandIcons();   // swap any logo placeholders on the page (About, checkout…)
}

// ============================================================
//  PRODUCT CARD
// ============================================================
// Sale: whole-percent off, to the penny — must match applySale() in js/pricing.js
function salePercent(p) {
  const n = Math.round(Number(p?.details?.salePercent));
  return Number.isFinite(n) && n > 0 && n <= 90 ? n : 0;
}
function salePrice(p, price) {
  const pct = salePercent(p);
  return pct ? Math.round(Number(price) * (100 - pct)) / 100 : Number(price);
}
function productPrice(p) { return salePrice(p, p.price); }
// "Ready to ship" / "Made to order" — must match dispatchInfo() in server.js
function dispatchInfo(p) {
  const d = p?.details || {};
  const mode = d.dispatch || (p?.variants?.variant_type === 'built' && p.variants.kind === 'unit' ? 'made' : null);
  if (mode === 'ready') return { mode, title: 'Ready to ship', text: 'Dispatched in 1–2 working days' };
  if (mode === 'made')  return { mode, title: 'Made to order', text: `Dispatched in ${d.madeDays || '5–10'} working days` };
  return null;
}
// Price with the old price crossed out when the product is on sale
function priceWithSaleHTML(p, original) {
  const { currency } = State.settings;
  const now = salePrice(p, original);
  return `${currency}${now.toFixed(2)}${salePercent(p) ? ` <s class="price-was">${currency}${Number(original).toFixed(2)}</s>` : ''}`;
}
function payInThreeHTML() {
  return State.settings.payInThree ? `<p class="pay-in-3">Or pay in 3 interest-free instalments with Klarna</p>` : '';
}

function productCardHTML(p) {
  const { currency } = State.settings;
  const desc = escHtml(p.description || '');
  const isBuilt = p.variants?.variant_type === 'built';
  const hasVariants = isBuilt || (p.variants?.enabled && p.variants?.prices && Object.keys(p.variants.prices).length > 0);
  const minPrice = isBuilt
    ? (p.fromPrice ?? null)
    : hasVariants ? Math.min(...Object.values(p.variants.prices)) : p.price;
  const priceDisplay = minPrice === null
    ? `<span style="font-size:0.8rem;color:var(--gray-400);">Price on request</span>`
    : hasVariants
      ? `<span style="font-size:0.7rem;font-weight:500;color:var(--gray-400);">from </span>${priceWithSaleHTML(p, minPrice)}`
      : priceWithSaleHTML(p, p.price);
  const pct = salePercent(p);
  const dispatch = p.in_stock ? dispatchInfo(p) : null;

  let btn = '';
  if (!p.in_stock) {
    btn = `<span class="product-card-stock stock-out">Out of stock – coming back soon</span>`;
  } else if (hasVariants) {
    btn = `<button class="btn btn-primary btn-sm btn-full" onclick="openVariantModal('${p.id}')">Select Options</button>`;
  } else {
    btn = `<button class="btn btn-primary btn-sm btn-full" onclick="addToCartOrLogin('${p.id}')">Add to Bag</button>`;
  }

  return `
    <div class="product-card" ontouchstart="this.classList.toggle('desc-open')">
      <a class="product-card-img-wrap" href="${productUrl(p)}" style="display:block;">
        <img class="product-card-img" src="${escHtml(p.image_url || '/images/placeholder.svg')}" alt="${escHtml(p.name)}" onerror="this.onerror=null;this.src='/images/placeholder.svg'" loading="lazy">
        ${pct ? `<span class="sale-badge sale-badge-card">${pct}% off</span>` : ''}
        ${desc ? `<div class="product-card-overlay"><p class="product-card-overlay-text">${desc}</p></div>` : ''}
      </a>
      <div class="product-card-body">
        <div class="product-card-category">${escHtml(p.category || 'Hair')}</div>
        <a class="product-card-name" href="${productUrl(p)}" style="display:block;">${escHtml(p.name)}</a>
        <div class="product-card-price">${priceDisplay}</div>
        ${dispatch ? `<div class="dispatch-tag dispatch-${dispatch.mode}">${dispatch.title}</div>` : ''}
        ${btn}
      </div>
    </div>`;
}

// Must match productPath() in server.js
function productUrl(p) {
  const slug = String(p.name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';
  return `/product/${slug}-${encodeURIComponent(p.id)}`;
}

function addToCartOrLogin(productId) {
  Store.addToCart(productId);
  openCart();
}

function promptLogin() {
  Toast.show('Please sign in to add items to your bag.', 'info');
  setTimeout(() => { window.location.href = '/account'; }, 1200);
}

// ============================================================
//  COLOUR CATALOGUE  (50 colours from the colour chart)
// ============================================================
const COLOUR_CATALOGUE = [
  // ── Natural ──────────────────────────────────────────────
  { code: '1B',      bg: '#0d0d0d',                                        tier: 'Natural (1B)'  },
  // ── Colours 1-6# ─────────────────────────────────────────
  { code: '1',       bg: '#050505',                                        tier: 'Colours 1-6#'  },
  { code: '2',       bg: '#180800',                                        tier: 'Colours 1-6#'  },
  { code: '4',       bg: '#3a1a08',                                        tier: 'Colours 1-6#'  },
  { code: '6',       bg: '#6b3820',                                        tier: 'Colours 1-6#'  },
  // ── Other Colours — solid tones ──────────────────────────
  { code: '8',       bg: '#8b5e3c',                                        tier: 'Other Colours' },
  { code: '10',      bg: '#a67c52',                                        tier: 'Other Colours' },
  { code: '12',      bg: '#c49a6c',                                        tier: 'Other Colours' },
  { code: '14',      bg: '#d4a96a',                                        tier: 'Other Colours' },
  { code: '16',      bg: '#e8c49a',                                        tier: 'Other Colours' },
  { code: '18',      bg: '#d4c4a0',                                        tier: 'Other Colours' },
  { code: '22',      bg: '#e8d5b0',                                        tier: 'Other Colours' },
  { code: '24',      bg: '#e8c878',                                        tier: 'Other Colours' },
  { code: '27',      bg: '#c49632',                                        tier: 'Other Colours' },
  { code: '30',      bg: '#8b3a08',                                        tier: 'Other Colours' },
  { code: '33',      bg: '#6b1a08',                                        tier: 'Other Colours' },
  { code: '34',      bg: '#8b2808',                                        tier: 'Other Colours' },
  { code: '44',      bg: '#4a0818',                                        tier: 'Other Colours' },
  { code: '51',      bg: '#9a9aaa',                                        tier: 'Other Colours' },
  { code: '99J',     bg: '#6b0828',                                        tier: 'Other Colours' },
  { code: '144',     bg: '#e0c820',                                        tier: 'Other Colours' },
  { code: '280',     bg: '#8b7820',                                        tier: 'Other Colours' },
  { code: '350',     bg: '#c04020',                                        tier: 'Other Colours' },
  { code: '613',     bg: '#f0e8c0',                                        tier: 'Other Colours' },
  { code: '1010',    bg: '#7a6858',                                        tier: 'Other Colours' },
  { code: 'BUG',     bg: '#3a0818',                                        tier: 'Other Colours' },
  { code: 'RED',     bg: '#cc0000',                                        tier: 'Other Colours' },
  { code: 'H-RED',   bg: '#ee1111',                                        tier: 'Other Colours' },
  { code: 'PURPLE',  bg: '#6600cc',                                        tier: 'Other Colours' },
  { code: 'BLUE',    bg: '#0033cc',                                        tier: 'Other Colours' },
  { code: 'P66',     bg: '#9a4a8a',                                        tier: 'Other Colours' },
  // ── Other Colours — ombre / blends (gradients) ───────────
  { code: '3T1B-350', bg: 'linear-gradient(135deg,#0d0d0d 33%,#c04020)',  tier: 'Other Colours' },
  { code: '3T4-27',   bg: 'linear-gradient(135deg,#3a1a08 33%,#c49632)',  tier: 'Other Colours' },
  { code: '3T4-30',   bg: 'linear-gradient(135deg,#3a1a08 33%,#8b3a08)',  tier: 'Other Colours' },
  { code: 'F1B30',    bg: 'linear-gradient(135deg,#0d0d0d 50%,#8b3a08)',  tier: 'Other Colours' },
  { code: 'F1B-350',  bg: 'linear-gradient(135deg,#0d0d0d 50%,#c04020)',  tier: 'Other Colours' },
  { code: 'F4-27',    bg: 'linear-gradient(135deg,#3a1a08 50%,#c49632)',  tier: 'Other Colours' },
  { code: 'F4-30',    bg: 'linear-gradient(135deg,#3a1a08 50%,#8b3a08)',  tier: 'Other Colours' },
  { code: 'F4-273',   bg: 'linear-gradient(135deg,#3a1a08 50%,#8b5e3c)',  tier: 'Other Colours' },
  { code: 'F4-33',    bg: 'linear-gradient(135deg,#3a1a08 50%,#6b1a08)',  tier: 'Other Colours' },
  { code: 'F6-613',   bg: 'linear-gradient(135deg,#6b3820 50%,#f0e8c0)',  tier: 'Other Colours' },
  { code: 'F18-22',   bg: 'linear-gradient(135deg,#d4c4a0 50%,#e8d5b0)',  tier: 'Other Colours' },
  { code: 'F27-613',  bg: 'linear-gradient(135deg,#c49632 50%,#f0e8c0)',  tier: 'Other Colours' },
  { code: 'F3044',    bg: 'linear-gradient(135deg,#8b3a08 50%,#c49a6c)',  tier: 'Other Colours' },
  { code: 'F3304',    bg: 'linear-gradient(135deg,#8b3a08 50%,#c49632)',  tier: 'Other Colours' },
  { code: 'T1B-27',   bg: 'linear-gradient(180deg,#0d0d0d 50%,#c49632)',  tier: 'Other Colours' },
  { code: 'T1B30',    bg: 'linear-gradient(180deg,#0d0d0d 50%,#8b3a08)',  tier: 'Other Colours' },
  { code: 'T1B33',    bg: 'linear-gradient(180deg,#0d0d0d 50%,#6b1a08)',  tier: 'Other Colours' },
  { code: 'T1B99J',   bg: 'linear-gradient(180deg,#0d0d0d 50%,#6b0828)',  tier: 'Other Colours' },
  { code: 'TIB-BUG',  bg: 'linear-gradient(180deg,#0d0d0d 50%,#3a0818)',  tier: 'Other Colours' },
];

// Maps a colour code to its pricing tier
function colourTier(code) {
  const c = COLOUR_CATALOGUE.find(x => x.code === code);
  return c ? c.tier : 'Other Colours';
}

// Resolves v.colours (may be old tier-names or new colour codes) → filtered COLOUR_CATALOGUE entries
function resolveColourCodes(v) {
  const cols = v.colours || [];
  if (!cols.length) return COLOUR_CATALOGUE; // no restriction = show all 50
  const TIERS = ['Natural (1B)', 'Colours 1-6#', 'Other Colours'];
  const isOldFormat = cols.some(c => TIERS.includes(c));
  if (isOldFormat) return COLOUR_CATALOGUE.filter(x => cols.includes(x.tier));
  return COLOUR_CATALOGUE.filter(x => cols.includes(x.code));
}

// ============================================================
//  VARIANT SELECTION MODAL
// ============================================================
// ============================================================
//  OPTION PICKER FOR PRODUCTS PRICED FROM THE PRICING SETTINGS
//  The server sends selling prices only (never costs). Every choice shows
//  its price straight away, and options that can't be bought are hidden.
// ============================================================
// Must match colourGroup() in js/pricing.js — 0 natural, 1 #2–#18, 2 #24/#613/blondes/fashion
function colourGroupIndex(code) {
  const c = String(code || '').toUpperCase().trim();
  if (c === '1B' || c === '1') return 0;
  if (/^(2|4|6|8|10|12|14|16|18)$/.test(c)) return 1;
  return 2;
}
const COLOUR_GROUP_TITLES = ['Natural', 'Colours #2–#18', '#613, blondes & fashion colours'];
const FINISH_LABELS = {
  loose:      'Bundles + closure/frontal (loose)',
  wig:        'Made into a wig',
  customised: 'Customised wig, straight',
  styled:     'Customised wig, styled (body wave, curls)',
};
const _priceTables = {};

async function openBuiltPicker(p) {
  const { currency } = State.settings;
  const cfg = p.variants;
  document.getElementById('_variantModal')?.remove();
  const modal = document.createElement('div');
  modal.id = '_variantModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;padding:24px 20px 28px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
        <img src="${escHtml(p.image_url || '/images/placeholder.svg')}" alt="" style="width:56px;height:64px;object-fit:cover;border-radius:8px;background:var(--gray-100);" onerror="this.onerror=null;this.src='/images/placeholder.svg'">
        <div style="flex:1;"><div style="font-weight:700;">${escHtml(p.name)}</div><div style="font-size:0.8rem;color:var(--gray-400);">${escHtml(p.category || '')}</div></div>
        <button data-close style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--gray-400);padding:4px;">✕</button>
      </div>
      <div id="bpBody"><p style="text-align:center;color:var(--gray-400);padding:30px 0;">Loading prices…</p></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.remove(); });

  let table;
  try { table = _priceTables[p.id] || (_priceTables[p.id] = await API.get(`/api/products/${encodeURIComponent(p.id)}/prices`)); }
  catch (err) { modal.querySelector('#bpBody').innerHTML = `<p style="text-align:center;color:var(--gray-500);padding:30px 0;">${escHtml(err.message)}</p>`; return; }

  const o = table.options;
  const allowedColours = cfg.colourMode === 'fixed' ? [] :
    (cfg.colours?.length ? COLOUR_CATALOGUE.filter(c => cfg.colours.includes(c.code)) : COLOUR_CATALOGUE)
      .filter(c => o.colourGroups.length > 0);
  // colour group name → index in the price table
  const groupPos = gi => o.colourGroups.indexOf(['Natural colour', 'Colour #2–#18', 'Colour #24 / #613 / #60 / Ash'][gi]);

  const capSizes  = cfg.capSizes || [];
  const laceTypes = table.kind === 'bundles' ? [] : (cfg.laceTypes || []);
  const s = { li: 0, bi: 0, lai: 0, ti: 0, colour: null, fi: 0, cap: capSizes.includes('M') ? 'M' : capSizes[0] || null, laceType: laceTypes[0] || null };
  // Prices in the table are before any sale; the customer sees (and pays) the sale price
  const priceAt = (li, bi, lai, ti, gpos, fi) => { const v = table.prices?.[li]?.[bi]?.[lai]?.[ti]?.[gpos]?.[fi]; return v === null || v === undefined ? null : salePrice(p, v); };
  const gposOf = () => cfg.colourMode === 'fixed' ? 0 : groupPos(colourGroupIndex(s.colour));
  const anyPrice = arr => Array.isArray(arr) ? arr.some(anyPrice) : arr !== null && arr !== undefined;
  const current = () => priceAt(s.li, s.bi, s.lai, s.ti, gposOf(), s.fi);

  // Sensible starting choices so a price shows straight away
  const startIdx = (list, wanted) => Math.max(0, list.indexOf(wanted));
  s.li  = startIdx(o.lengths, 20);
  s.bi  = startIdx(o.bundleCounts, 3);
  s.lai = startIdx(o.laces, '13x4');
  if (cfg.colourMode !== 'fixed') s.colour = (allowedColours.find(c => c.code === '1B') || allowedColours[0])?.code || '1B';

  // Keep every choice valid: if a choice has no price, move to the nearest one that does
  function repair() {
    const okLen = li => anyPrice(table.prices[li]);
    if (!okLen(s.li)) s.li = o.lengths.findIndex((_, i) => okLen(i));
    const okB = bi => anyPrice(table.prices[s.li]?.[bi]);
    if (!okB(s.bi)) s.bi = o.bundleCounts.findIndex((_, i) => okB(i));
    const okL = lai => anyPrice(table.prices[s.li]?.[s.bi]?.[lai]);
    if (!okL(s.lai)) s.lai = o.laces.findIndex((_, i) => okL(i));
    const okT = ti => anyPrice(table.prices[s.li]?.[s.bi]?.[s.lai]?.[ti]);
    if (!okT(s.ti)) s.ti = o.textures.findIndex((_, i) => okT(i));
    if (cfg.colourMode !== 'fixed' && groupPos(colourGroupIndex(s.colour)) < 0) s.colour = allowedColours.find(c => groupPos(colourGroupIndex(c.code)) >= 0)?.code || s.colour;
    if (current() === null) { const fi = o.finishes.findIndex((_, i) => priceAt(s.li, s.bi, s.lai, s.ti, gposOf(), i) !== null); if (fi >= 0) s.fi = fi; }
  }

  const money = v => `${currency}${Number(v).toFixed(2)}`;
  // Options with no price (not sold, or switched off in the admin) are simply not shown
  const btn = (label, selected, onclick, disabled, sub) => disabled ? '' :
    `<button class="variant-opt-btn${selected ? ' selected' : ''}" ${disabled ? 'disabled' : ''} onclick="${onclick}" style="display:inline-flex;flex-direction:column;align-items:center;line-height:1.2;">${label}${sub ? `<span style="font-size:0.66rem;font-weight:500;opacity:0.75;margin-top:2px;">${sub}</span>` : ''}</button>`;
  const lowest = arr => { let m = null; (function walk(a) { if (Array.isArray(a)) a.forEach(walk); else if (a !== null && a !== undefined) m = m === null ? a : Math.min(m, a); })(arr); return m; };

  function render() {
    repair();
    const step = (n, title, html) => `<div style="margin-bottom:16px;"><div class="variant-step-label">${n}. ${title}</div><div class="variant-opts-row">${html}</div></div>`;
    let n = 1, html = '';
    const isLace = table.kind === 'lace', isBundles = table.kind === 'bundles', isUnit = table.kind === 'unit';

    html += step(n++, isLace ? 'Length of hair' : 'Length', o.lengths.map((l, i) => {
      let from = lowest(table.prices[i]);
      if (from !== null) from = salePrice(p, from);
      return btn(`${l}"`, i === s.li, `_bp.set('li',${i})`, from === null, from !== null ? `from ${currency}${Math.round(from)}` : '');
    }).join(''));

    if (isBundles && o.bundleCounts.length > 6) {
      // Lots of choices (e.g. 1–40 bundles): a − / + counter instead of a wall of buttons
      const qty = o.bundleCounts[s.bi], total = current();
      const canDown = o.bundleCounts.slice(0, s.bi).some((_, i) => anyPrice(table.prices[s.li]?.[i]));
      const canUp   = o.bundleCounts.slice(s.bi + 1).some((_, i) => anyPrice(table.prices[s.li]?.[s.bi + 1 + i]));
      html += `<div style="margin-bottom:16px;"><div class="variant-step-label">${n++}. Number of bundles</div>
        <div class="bp-stepper">
          <button type="button" onclick="_bp.step(-1)" ${canDown ? '' : 'disabled'} aria-label="One less bundle">−</button>
          <input type="number" inputmode="numeric" min="${o.bundleCounts[0]}" max="${o.bundleCounts[o.bundleCounts.length - 1]}" value="${qty}" onchange="_bp.qty(this.value)" aria-label="Number of bundles">
          <button type="button" onclick="_bp.step(1)" ${canUp ? '' : 'disabled'} aria-label="One more bundle">+</button>
          ${total !== null ? `<span class="bp-each">${money(total / qty)} per bundle</span>` : ''}
        </div>
        <div style="font-size:0.72rem;color:var(--gray-400);margin-top:6px;">${qty} bundle${qty > 1 ? 's' : ''} = ${qty * 100}g · choose ${o.bundleCounts[0]}–${o.bundleCounts[o.bundleCounts.length - 1]} bundles</div></div>`;
    } else if (!isLace && o.bundleCounts.length > 1) {
      html += step(n++, isBundles ? 'Number of bundles' : 'Bundles', o.bundleCounts.map((b, i) =>
        btn(`${b} bundle${b > 1 ? 's' : ''}`, i === s.bi, `_bp.set('bi',${i})`, !anyPrice(table.prices[s.li]?.[i]), `${b * 100}g`)).join(''));
    }
    if (!isBundles) {
      html += step(n++, isLace ? 'Closure / frontal size' : 'Closure or frontal', o.laces.map((la, i) => {
        const v = lowest(table.prices[s.li]?.[s.bi]?.[i]);
        return btn(la, i === s.lai, `_bp.set('lai',${i})`, v === null, la.startsWith('13') ? 'frontal' : 'closure');
      }).join(''));
    }
    if (laceTypes.length) {
      html += step(n++, 'Lace type', laceTypes.map(t => btn(escHtml(t), t === s.laceType, `_bp.pick('laceType','${t}')`, false, t === 'HD' ? 'melts into all skin tones' : 'stronger, light–medium skin')).join(''));
    }
    if (o.textures.length > 1) {
      html += step(n++, 'Texture', o.textures.map((t, i) => {
        const v = priceAt(s.li, s.bi, s.lai, i, gposOf(), s.fi), base = lowest(o.textures.map((_, j) => priceAt(s.li, s.bi, s.lai, j, gposOf(), s.fi)));
        return btn(escHtml(t), i === s.ti, `_bp.set('ti',${i})`, v === null, v !== null && base !== null && v > base ? `+${currency}${Math.round(v - base)}` : '');
      }).join(''));
    }

    if (cfg.colourMode === 'fixed') {
      html += `<div style="margin-bottom:16px;"><div class="variant-step-label">${n++}. Colour</div><div style="font-weight:600;">${escHtml(cfg.fixedColour?.name || '')}</div></div>`;
    } else {
      const base = priceAt(s.li, s.bi, s.lai, s.ti, groupPos(0) >= 0 ? groupPos(0) : 0, s.fi);
      html += `<div style="margin-bottom:16px;"><div class="variant-step-label">${n++}. Colour</div>` +
        [0, 1, 2].map(gi => {
          const cols = allowedColours.filter(c => colourGroupIndex(c.code) === gi);
          if (!cols.length || groupPos(gi) < 0) return '';
          const v = priceAt(s.li, s.bi, s.lai, s.ti, groupPos(gi), s.fi);
          const extra = v !== null && base !== null && v > base ? ` <span style="color:var(--gold-dark);">+${currency}${Math.round(v - base)}</span>` : '';
          return `<div style="font-size:0.75rem;color:var(--gray-500);margin:8px 0 6px;">${COLOUR_GROUP_TITLES[gi]}${extra}</div>
            <div class="colour-swatch-grid">${cols.map(c => `
              <span class="colour-swatch-wrap" onclick="_bp.colour('${c.code.replace(/'/g, "\\'")}')">
                <span class="colour-swatch-chip${s.colour === c.code ? ' selected' : ''}" style="background:${c.bg};"></span>
                <span class="colour-swatch-label">${escHtml(c.code)}</span>
              </span>`).join('')}</div>`;
        }).join('') + `</div>`;
    }

    if (isUnit) {
      html += `<div style="margin-bottom:16px;"><div class="variant-step-label">${n++}. How would you like it?</div>` +
        o.finishes.map((f, i) => {
          const v = priceAt(s.li, s.bi, s.lai, s.ti, gposOf(), i);
          if (v === null) return '';
          return `<label style="display:flex;align-items:center;gap:10px;padding:11px 12px;margin-bottom:6px;border:1.5px solid ${i === s.fi ? 'var(--gold-dark)' : 'var(--gray-200)'};border-radius:var(--radius);cursor:pointer;background:${i === s.fi ? 'var(--gold-bg)' : '#fff'};">
            <input type="radio" name="bpFinish" ${i === s.fi ? 'checked' : ''} onchange="_bp.set('fi',${i})" style="accent-color:var(--gold-dark);">
            <span style="flex:1;font-size:0.88rem;">${escHtml(FINISH_LABELS[f] || f)}</span>
            <strong style="color:var(--gold-dark);">${money(v)}</strong>
          </label>`;
        }).join('') + `</div>`;
    }

    // Cap size: only when the hair is made into a wig
    if (needsCap()) {
      html += step(n++, 'Cap size', capSizes.map(c => btn({ S: 'Small', M: 'Medium', L: 'Large' }[c], c === s.cap, `_bp.pick('cap','${c}')`, false, { S: '21"', M: '22" · most people', L: '23"' }[c])).join(''));
    }

    const price = current();
    const raw = table.prices?.[s.li]?.[s.bi]?.[s.lai]?.[s.ti]?.[gposOf()]?.[s.fi];
    const dispatch = dispatchInfo(p);
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:6px 0 4px;">
        <span style="font-size:0.85rem;color:var(--gray-500);">Price${salePercent(p) ? ` <span class="sale-badge">${salePercent(p)}% off</span>` : ''}</span>
        <span style="font-family:var(--font-head);font-size:1.4rem;color:var(--gold-dark);font-weight:700;">${price !== null ? `${salePercent(p) ? `<s class="price-was">${money(raw)}</s> ` : ''}${money(price)}` : '—'}</span>
      </div>
      ${payInThreeHTML()}
      ${dispatch ? `<p class="picker-dispatch"><strong>${dispatch.title}</strong> · ${escHtml(dispatch.text)}</p>` : ''}
      <button class="btn btn-primary btn-full" style="margin-top:10px;" ${price === null ? 'disabled' : ''} onclick="_bp.add()">Add to Bag</button>
      <p class="picker-guide-link"><a href="${productUrl(p)}#guides" onclick="document.getElementById('_variantModal')?.remove()">Length, lace &amp; cap size guide</a></p>
      ${pickerSocialLine(p.name)}`;
    modal.querySelector('#bpBody').innerHTML = html;
  }

  function needsCap() { return table.kind === 'unit' && capSizes.length > 0 && o.finishes[s.fi] !== 'loose'; }

  // Same wording as quoteBuilt() in js/pricing.js (the server's version goes on the order)
  function label() {
    const len = o.lengths[s.li], la = o.laces[s.lai], b = o.bundleCounts[s.bi];
    return [
      `${len}"`,
      table.kind === 'lace' ? null : `${b} bundle${b > 1 ? 's' : ''} (${b * 100}g)`,
      table.kind === 'bundles' ? null : `${table.kind === 'lace' ? '' : `${Math.min(len, 28)}" `}${la}${laceTypes.length ? ` ${s.laceType}` : ''} ${la.startsWith('13') ? 'frontal' : 'closure'}`.trim(),
      o.textures[s.ti],
      cfg.colourMode === 'fixed' ? cfg.fixedColour?.name : s.colour,
      table.kind === 'unit' ? FINISH_LABELS[o.finishes[s.fi]] : null,
      needsCap() ? { S: 'Small cap (21")', M: 'Medium cap (22")', L: 'Large cap (23")' }[s.cap] : null,
    ].filter(Boolean).join(' · ');
  }

  window._bp = {
    set(k, v) { s[k] = v; render(); },
    pick(k, v) { s[k] = v; render(); },
    colour(c) { s.colour = c; render(); },
    // − / + bundle counter: move to the next count that has a price
    step(dir) {
      for (let i = s.bi + dir; i >= 0 && i < o.bundleCounts.length; i += dir) {
        if (anyPrice(table.prices[s.li]?.[i])) { s.bi = i; break; }
      }
      render();
    },
    // Typed a number: use it if available, otherwise the nearest count that is
    qty(val) {
      const want = Math.round(Number(val));
      const ok = o.bundleCounts.map((b, i) => ({ b, i })).filter(x => anyPrice(table.prices[s.li]?.[x.i]));
      if (ok.length) s.bi = ok.reduce((best, x) => Math.abs(x.b - want) < Math.abs(best.b - want) ? x : best).i;
      render();
    },
    add() {
      const price = current();
      if (price === null) return;
      const key = ['B', o.lengths[s.li], table.kind === 'lace' ? 0 : o.bundleCounts[s.bi], table.kind === 'bundles' ? '-' : o.laces[s.lai],
                   o.textures[s.ti], cfg.colourMode === 'fixed' ? '-' : s.colour, table.kind === 'unit' ? o.finishes[s.fi] : '-',
                   needsCap() ? s.cap : '-', laceTypes.length ? s.laceType : '-'].join('|');
      Store.addToCart(p.id, 1, { key, label: label(), price });
      modal.remove();
      openCart();
    },
  };
  render();
}

function openVariantModal(productId) {
  const p = Store.getProduct(productId);
  if (p?.variants?.variant_type === 'built') return openBuiltPicker(p);
  if (!p || !p.variants?.enabled) return;
  const v = p.variants;
  const { currency } = State.settings;
  const vtype = v.variant_type || 'bundle'; // bundle | wig | big-wig | closure | frontal

  // ── Shared state ──────────────────────────────────────────────
  let selInches = null, selBundles = null, selColour = null, selLace = null;
  let selAttachment = null, selHairType = null;
  let selStyling = false;   // optional wig styling service
  const stylingFee  = Number(State.settings.wigStylingFee) || 10;
  const canStyle    = vtype === 'wig' || vtype === 'big-wig';

  // Only options that have a price and haven't been switched off in the admin are shown
  const offKeys  = new Set(v.unavailable || []);
  const liveKeys = Object.keys(v.prices || {}).filter(k => k && !offKeys.has(k) && v.prices[k] !== null && v.prices[k] !== '' && isFinite(Number(v.prices[k])));
  const hasKey   = prefix => liveKeys.some(k => k === String(prefix) || k.startsWith(prefix + '-'));

  const laceSizes   = v.lace_sizes || [];
  const inchList    = (v.inches || []).slice().sort((a,b) => a-b);
  const colourList  = v.colours || [];

  function bundleOpts(i) { return i >= 30 ? [3,4,5] : [3,4]; }

  // ── Key + label builders per type ────────────────────────────
  function buildKey() {
    // For bundles, price is stored by tier — map the chosen colour to its tier for lookup
    if (vtype === 'bundle')  return (selInches && selBundles && selColour) ? `${selInches}-${selBundles}-${colourTier(selColour)}` : null;
    if (vtype === 'wig' || vtype === 'big-wig') {
      if (!selInches || !selLace) return null;
      const hasHair   = (v.hair_types || []).length > 0;
      const hasAttach = (v.attachment_types || []).length > 0;
      if (!hasHair) return `${selInches}-${selLace}`; // backward compat
      // attachment doesn't affect price — only used in label for fulfilment
      if (selLace === '2x6' && hasAttach && !selAttachment) return null;
      if (!selHairType) return null;
      return `${selInches}-${selLace}-${selHairType}`;
    }
    if (vtype === 'closure' || vtype === 'frontal') return (selLace && selInches) ? `${selLace}-${selInches}` : null;
    return null;
  }
  function buildLabel() {
    if (vtype === 'bundle')  return `${selInches}" · ${selBundles} Bundle${selBundles>1?'s':''} (${selBundles * 100}g) · ${selColour}`;
    if (vtype === 'wig' || vtype === 'big-wig') {
      const parts = [`${selInches}" · ${selLace} HD Lace`];
      if (selAttachment) parts.push(selAttachment);
      if (selHairType)   parts.push(selHairType);
      if (selColour)     parts.push(selColour);
      return parts.join(' · ');
    }
    if (vtype === 'closure' || vtype === 'frontal') return `${selLace} · ${selInches}" Hair · ${selColour}`;
    return '';
  }
  function currentPrice() {
    const k = buildKey();
    const raw = k !== null ? (v.prices?.[k] ?? null) : null;
    return raw === null || raw === '' ? null : salePrice(p, raw);   // the server applies the same sale
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const price = currentPrice();
    if (!liveKeys.length) {
      modal.querySelector('#vmStep1Btns').innerHTML = `<p style="font-size:0.85rem;color:var(--gray-500);">This item can't be ordered online right now — message us on WhatsApp or Instagram and we'll help.</p>`;
      modal.querySelector('#vmAddBtn').disabled = true;
      return;
    }

    // Step 1 — always inches (bundle/wig/big-wig) OR lace size (closure/frontal)
    if (vtype === 'closure' || vtype === 'frontal') {
      modal.querySelector('#vmStep1Btns').innerHTML = laceSizes.filter(ls => hasKey(ls)).map(ls =>
        `<button class="variant-opt-btn${selLace===ls?' selected':''}" onclick="_vmSel1('${ls}')">${ls}</button>`
      ).join('');
      const s2 = modal.querySelector('#vmStep2Wrap');
      if (selLace) {
        s2.style.display = '';
        modal.querySelector('#vmStep2Btns').innerHTML = inchList.filter(i => hasKey(`${selLace}-${i}`)).map(i =>
          `<button class="variant-opt-btn${selInches===i?' selected':''}" onclick="_vmSel2(${i})">${i}"</button>`
        ).join('');
      } else { s2.style.display = 'none'; }
    } else {
      // inches first
      modal.querySelector('#vmStep1Btns').innerHTML = inchList.filter(i => hasKey(i)).map(i =>
        `<button class="variant-opt-btn${selInches===i?' selected':''}" onclick="_vmSel1(${i})">${i}"</button>`
      ).join('');

      const s2 = modal.querySelector('#vmStep2Wrap');
      if (selInches) {
        s2.style.display = '';
        if (vtype === 'bundle') {
          modal.querySelector('#vmStep2Btns').innerHTML = bundleOpts(selInches).filter(b => hasKey(`${selInches}-${b}`)).map(b =>
            `<button class="variant-opt-btn${selBundles===b?' selected':''}" onclick="_vmSel2(${b})">${b} Bundles <span style="font-size:0.7rem;opacity:0.75;">(${b * 100}g)</span></button>`
          ).join('');
        } else {
          // wig / big-wig → lace sizes
          modal.querySelector('#vmStep2Btns').innerHTML = laceSizes.filter(ls => hasKey(`${selInches}-${ls}`)).map(ls =>
            `<button class="variant-opt-btn${selLace===ls?' selected':''}" onclick="_vmSel2('${ls}')">${ls}</button>`
          ).join('');
        }
      } else { s2.style.display = 'none'; }
    }

    // Step 2b — attachment type (wigs, 2x6 lace only)
    const hasAttach = (v.attachment_types || []).length > 0;
    const hasHair   = (v.hair_types || []).length > 0;
    const s2b = modal.querySelector('#vmStep2bWrap');
    const show2b = (vtype === 'wig' || vtype === 'big-wig') && selLace === '2x6' && hasAttach;
    if (show2b) {
      s2b.style.display = '';
      modal.querySelector('#vmStep2bBtns').innerHTML = (v.attachment_types || []).map(a =>
        `<button class="variant-opt-btn${selAttachment===a?' selected':''}" onclick="_vmSel2b('${a}')">${a}</button>`
      ).join('');
    } else { s2b.style.display = 'none'; }

    // Step 2c — hair type (wigs, all lace sizes)
    const s2c = modal.querySelector('#vmStep2cWrap');
    const attachResolved = !show2b || selAttachment;
    const show2c = (vtype === 'wig' || vtype === 'big-wig') && selLace && hasHair && attachResolved;
    if (show2c) {
      s2c.style.display = '';
      modal.querySelector('#vmStep2cBtns').innerHTML = (v.hair_types || []).filter(h => hasKey(`${selInches}-${selLace}-${h}`)).map(h =>
        `<button class="variant-opt-btn${selHairType===h?' selected':''}" onclick="_vmSel2c('${h}')">${h}</button>`
      ).join('');
    } else { s2c.style.display = 'none'; }

    // Step 3 — colour swatches (all product types, shown after all prior steps complete)
    const s3 = modal.querySelector('#vmStep3Wrap');
    const wigReady = selLace && (!hasHair || selHairType) && (!show2b || selAttachment);
    const showColour = (vtype === 'bundle' && selBundles)
      || ((vtype === 'wig' || vtype === 'big-wig') && wigReady)
      || ((vtype === 'closure' || vtype === 'frontal') && selInches);
    if (showColour) {
      s3.style.display = '';
      // Bundles are priced by colour group, so hide colours whose group is switched off for this length/bundles
      const availableCols = resolveColourCodes(v).filter(c => vtype !== 'bundle' || hasKey(`${selInches}-${selBundles}-${colourTier(c.code)}`));
      modal.querySelector('#vmStep3Btns').innerHTML = availableCols.map(c =>
        `<span class="colour-swatch-wrap" onclick="_vmSel3('${c.code.replace(/'/g,"\\'")}')">
           <span class="colour-swatch-chip${selColour===c.code?' selected':''}" style="background:${c.bg};"></span>
           <span class="colour-swatch-label">${escHtml(c.code)}</span>
         </span>`
      ).join('');
    } else { s3.style.display = 'none'; }

    // Optional styling (wigs only) — shown once the colour is chosen
    const sStyle = modal.querySelector('#vmStylingWrap');
    if (sStyle) sStyle.style.display = (canStyle && selColour) ? '' : 'none';

    const total = price !== null ? price + (canStyle && selStyling ? stylingFee : 0) : null;
    modal.querySelector('#vmPrice').textContent = total !== null ? `${currency}${total.toFixed(2)}` : '—';
    const saleTag = modal.querySelector('#vmSale');
    if (saleTag) saleTag.textContent = salePercent(p) ? `${salePercent(p)}% off` : '';
    modal.querySelector('#vmAddBtn').disabled = price === null || !selColour;
  }

  // ── Step labels per type ──────────────────────────────────────
  const isClosureFrontal = vtype === 'closure' || vtype === 'frontal';
  const isWigType        = vtype === 'wig' || vtype === 'big-wig';
  const hasAttachOpt     = isWigType && (v.attachment_types || []).length > 0;
  const hasHairOpt       = isWigType && (v.hair_types || []).length > 0;
  const step1Label = isClosureFrontal ? '1. Choose Lace Size' : '1. Choose Inches';
  const step2Label = vtype === 'bundle' ? '2. Choose Bundles'
                   : isClosureFrontal   ? '2. Choose Hair Length'
                   :                     '2. Choose Lace Size';
  // Dynamic step numbers for new wig steps
  let stepN = 3;
  const step2bLabel = `${hasAttachOpt ? stepN++ : stepN}. Choose Attachment`;
  const step2cLabel = `${hasHairOpt ? stepN++ : stepN}. Choose Hair Type`;
  const step3Label  = `${stepN}. Choose Colour`;

  // ── Build modal HTML ──────────────────────────────────────────
  document.getElementById('_variantModal')?.remove();
  const modal = document.createElement('div');
  modal.id = '_variantModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;padding:0;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;padding:24px 20px 32px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <img src="${escHtml(p.image_url||'')}" alt="" style="width:56px;height:64px;object-fit:cover;border-radius:8px;background:var(--gray-100);" onerror="this.onerror=null;this.src='/images/placeholder.svg'">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1rem;">${escHtml(p.name)}</div>
          <div style="font-size:0.8rem;color:var(--gray-400);">${escHtml(p.category||'')}</div>
        </div>
        <button onclick="document.getElementById('_variantModal').remove()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--gray-400);padding:4px;">✕</button>
      </div>

      <div style="margin-bottom:18px;">
        <div class="variant-step-label">${step1Label}</div>
        <div id="vmStep1Btns" class="variant-opts-row"></div>
      </div>

      <div id="vmStep2Wrap" style="margin-bottom:18px;display:none;">
        <div class="variant-step-label">${step2Label}</div>
        <div id="vmStep2Btns" class="variant-opts-row"></div>
      </div>

      <div id="vmStep2bWrap" style="margin-bottom:18px;display:none;">
        <div class="variant-step-label">${step2bLabel}</div>
        <div id="vmStep2bBtns" class="variant-opts-row"></div>
      </div>

      <div id="vmStep2cWrap" style="margin-bottom:18px;display:none;">
        <div class="variant-step-label">${step2cLabel}</div>
        <div id="vmStep2cBtns" class="variant-opts-row"></div>
      </div>

      <div id="vmStep3Wrap" style="margin-bottom:20px;display:none;">
        <div class="variant-step-label">${step3Label}</div>
        <div id="vmStep3Btns" class="colour-swatch-grid"></div>
      </div>

      ${canStyle ? `
      <div id="vmStylingWrap" style="margin-bottom:20px;display:none;">
        <label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1.5px solid var(--gray-200);border-radius:var(--radius);cursor:pointer;">
          <input type="checkbox" id="vmStyling" onchange="_vmStyling(this.checked)" style="width:18px;height:18px;accent-color:var(--gold-dark);">
          <span style="flex:1;font-size:0.88rem;"><strong>Add styling</strong><br><span style="color:var(--gray-500);font-size:0.78rem;">Curls, layers or a sleek finish, ready to wear</span></span>
          <span style="font-weight:700;color:var(--gold-dark);">+${currency}${stylingFee.toFixed(2)}</span>
        </label>
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:0.85rem;color:var(--gray-500);">Price ${salePercent(p) ? `<span class="sale-badge" id="vmSale"></span>` : ''}</span>
        <span id="vmPrice" style="font-family:var(--font-head);font-size:1.3rem;color:var(--gold-dark);font-weight:700;">—</span>
      </div>
      ${payInThreeHTML()}
      ${dispatchInfo(p) ? `<p class="picker-dispatch"><strong>${dispatchInfo(p).title}</strong> · ${escHtml(dispatchInfo(p).text)}</p>` : ''}

      <button id="vmAddBtn" disabled class="btn btn-primary btn-full" style="margin-top:12px;" onclick="_vmAddToCart('${productId}')">Add to Bag</button>
      <p class="picker-guide-link"><a href="${productUrl(p)}#guides" onclick="document.getElementById('_variantModal')?.remove()">Length, lace &amp; cap size guide</a></p>
      ${pickerSocialLine(p.name)}
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  // Selection handlers — step 1
  window._vmSel1 = (val) => {
    if (isClosureFrontal) { selLace = val; selInches = null; }
    else                  { selInches = (typeof val === 'number') ? val : parseInt(val); selBundles = null; selColour = null; selLace = null; }
    render();
  };
  // Selection handlers — step 2
  window._vmSel2 = (val) => {
    if (vtype === 'bundle')          { selBundles = (typeof val === 'number') ? val : parseInt(val); selColour = null; }
    else if (isClosureFrontal)       { selInches  = (typeof val === 'number') ? val : parseInt(val); selColour = null; }
    else                             { selLace = val; selAttachment = null; selHairType = null; selColour = null; } // wig — reset all downstream
    render();
  };
  // Selection handlers — step 2b (attachment) and 2c (hair type)
  window._vmSel2b = (val) => { selAttachment = val; selHairType = null; selColour = null; render(); };
  window._vmSel2c = (val) => { selHairType = val; selColour = null; render(); };
  // Selection handlers — step 3 (colour)
  window._vmSel3 = (c) => { selColour = c; render(); };

  window._vmStyling = (on) => { selStyling = !!on; render(); };

  window._vmAddToCart = (pid) => {
    const price = currentPrice();
    const key   = buildKey();
    if (price === null || !key) return;
    const styled = canStyle && selStyling;
    // Styling travels on the cart line as "<key>|styled"; the server adds the fee itself
    Store.addToCart(pid, 1, {
      key:   styled ? `${key}|styled` : key,
      label: styled ? `${buildLabel()} · Styled` : buildLabel(),
      price: styled ? price + stylingFee : price,
    });
    modal.remove();
    openCart();
  };

  render();
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
