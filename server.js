'use strict';
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const session   = require('express-session');
const bcrypt    = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const path      = require('path');
const fs        = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  PURE-JS FILE DATABASE  (no native modules, no compilation)
//  Data is stored as JSON files in ./data/
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, def) {
  try {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) return def;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return def; }
}

// Atomic write: write to .tmp first, then rename (prevents corruption)
function writeJson(file, data) {
  const p   = path.join(DATA_DIR, file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// Auto-increment ID helper
function nextId(arr) {
  return arr.length > 0 ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1;
}

function now() { return new Date().toISOString(); }

// ---- Accessors ----
const DB = {
  // Products
  getProducts()     { return readJson('products.json', []); },
  saveProducts(p)   { writeJson('products.json', p); },

  // Users
  getUsers()        { return readJson('users.json', []); },
  saveUsers(u)      { writeJson('users.json', u); },

  // Orders
  getOrders()       { return readJson('orders.json', []); },
  saveOrders(o)     { writeJson('orders.json', o); },

  // Admin
  getAdmins()       { return readJson('admins.json', []); },
  saveAdmins(a)     { writeJson('admins.json', a); },

  // Settings
  getSettings()     { return readJson('settings.json', {}); },
  saveSettings(s)   { writeJson('settings.json', s); },
};

// ---- Seed default data if not present ----

// Default settings
if (!fs.existsSync(path.join(DATA_DIR, 'settings.json'))) {
  DB.saveSettings({
    whatsapp: '+44', instagram: '@eetashahairs',
    bankName: '', sortCode: '', accountNumber: '', accountName: 'ee_tasha hairs',
    currency: '£', deliveryFee: '5.99',
  });
}

// Default admin (password: eetasha2024)
if (!fs.existsSync(path.join(DATA_DIR, 'admins.json'))) {
  const hash = bcrypt.hashSync('eetasha2024', 12);
  DB.saveAdmins([{ id: 1, username: 'admin', password_hash: hash, created_at: now() }]);
  console.log('  ✅ Admin account created  →  password: eetasha2024  (change this in the dashboard!)');
}

// Seed products
if (!fs.existsSync(path.join(DATA_DIR, 'products.json'))) {
  DB.saveProducts([
    { id: 1, name: 'Luxury HD Lace Frontal Wig',  price: 285, category: 'Wigs',     in_stock: true, featured: true,  created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBT_acbnNJllCa-myvQXbTiAfGG1Ng-QqFbGAkiQs-N2gTLamTG-VBCqWdJxYoLxkEHflEoVFQEO1dNJ7tDEsxeMaI-fo6TsDC2elJ8qLlmjTXj_jIOcxcRzSNC0kF2ZsgbKen96SmIlF-3tdv4-rUDhn5AuTOyqyLkIA5DYLTlTyV68_uJmM-kaukOSoiFnar8gf2jS663m_7sqDHdtlHRRh97ebJC7ktW1AmDgPtNkxRfvLnB4XtTUF6AN4IujIMcVb-dpYiJgg',
      description: '100% Virgin Human Hair, 180% Density, pre-plucked hairline. HD Swiss Lace.' },
    { id: 2, name: 'Brazilian Body Wave Bundle',   price: 148, category: 'Bundles',  in_stock: true, featured: true,  created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCtFlFGnIJDEScExko8LZfFdetzllUe281nGmyY-_5mvrSwbeNkgPiogL9PDYqoUtYpx5L5S0HJL4veqzYtae3i1_10ziTvrN8pF-Ve4OBKpc97oPc_A_bZxSTAcPY7t_-hTRCktKceWAcVrNgCTsZistyHHHYdd7KBuCFBG76GwV7raWzJ2WLo0hO2ltxV3pEgy-KUGOCbcIO1PCB_icgqMJmBKNGuzYVPvDShIiXHqIDJO3Fvn6nZxQUoPzuqOommSKJKAm9Y-A',
      description: 'Premium Brazilian body wave, double drawn, natural colour. 12-30 inches.' },
    { id: 3, name: 'Raw Indian Deep Curl',          price: 165, category: 'Bundles',  in_stock: true, featured: true,  created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCXS7g1NieJeyr80RdjUm0BGQe6WnTY1Dx98Az0nawtHWwKH6JbViftriQhDH99-yLvdGwXPMddit-PO2rQbPUvy5mdRcneQIpje-tWqQJHSvTaXb4EI-ESQc8cEsuRjAUoQVshPtYz67j72oYe5akSCQXOCJSrINxy2JQtc-Q1X8DF3hpVk9qDYChMz8VcD995q1KWQaYp4sK7qup7Mnw8p0CtnpIs1bS4OPzumNiFLyaAfUU9XBFczNct9xDqZfbebcGdchIk4A',
      description: 'Single donor, unprocessed deep curl. Maintains pattern after wash.' },
    { id: 4, name: 'HD Lace Frontal 13×6',          price: 95,  category: 'Frontals', in_stock: true, featured: false, created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBjYIxz7Nhuwi6BcC5A8ZS7EJCO4WlubBQxq5gtiBgN22miZsePfKJZIcDtpLSazPz3hUJFT_YUg5dyxo5Pob6pUKfVWhawRGrxMGdnCCULOXx35pay6D18QciCQoeDHDAaz-7ndrbCsA5euHU7sNaFIHewA2IQmNKmnHyUSfozZZw_he1ERTpS97HiV7bu5p-JClUPkNeLNLQdDAemXHadupzuSbcZttkUjx7F-1dDSB8ci69IWAiGgxSc5-CGH7KVtKGts52O7w',
      description: 'Invisible film HD lace frontal, ear to ear. Pre-plucked baby hairs.' },
    { id: 5, name: 'Signature Silk Serum',          price: 28,  category: 'Care',     in_stock: true, featured: false, created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB79wd18no-0YUtYprOsVvZIO6iGvx6CdKe7zmDDT1kNnxZJQh_f-j-fxrYQbMfYP8PmaziHEYG1k2yNESLGXq_-D6LagCXBEriKrlBMIbUSTb5h0q3khCP4jrDR4lyycagvPM6YlBLL4-waBNIlDSu-1L0P8aRQs82WLl3bXvfv0FFuLXLgL-7BU8phXWF3ADGn7KimEmiMoyB7CfJRiuuu6NdZ8YNIRy6oBBDcIo5qa83ZjUeyRb0_O2evC6jobdkC8dnYER9Qw',
      description: 'Nourish and protect your hair investment. Lightweight, anti-frizz formula.' },
    { id: 6, name: 'Peruvian Silk Straight',        price: 175, category: 'Bundles',  in_stock: false, featured: false, created_at: now(),
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD1AFjTua3D9DtI66qS0iNH0MNGooSA-7fp5UNKNgTxQrea-D0AeuqZFeHqd55-1JMf0mdqT3bfaIRPQmMAau-lMfowV2FKRIwQ44P1PuZ4t0IlSyTv_1oKah4e53WYUIDxQofv_uzavuFacOy5sSlvQYpZHp-RTbEgVHxJUPBjkuSlPZsOt5XlZILhkTssn9jGlhkvuwhjZyQvcMNUL3osyjqbbFk4264MGlD-2jS_4LElcgy4KHgwhz9gsPrCVAXdn_bh2hHpsQ',
      description: 'Double drawn, bone straight. Currently restocking from our supplier.' },
  ]);
  console.log('  ✅ Sample products seeded.');
}

// ============================================================
//  STRIPE
// ============================================================
const hasStripe = !!(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder'));
let stripe;
if (hasStripe) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================
//  SECURITY MIDDLEWARE
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc:  ["'self'", 'https://api.stripe.com'],
      frameSrc:    ['https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// ---- Sessions ----
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-this')) {
  console.warn('  ⚠  SESSION_SECRET is not set in .env — please update it before going live.');
}
app.use(session({
  secret:            process.env.SESSION_SECRET || 'et-fallback-secret',
  resave:            false,
  saveUninitialized: false,
  name:              'et.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ---- Rate limiters ----
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts — please try again in 15 minutes.' },
});
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// Static files
app.use(express.static(path.join(__dirname)));

// ============================================================
//  HELPERS
// ============================================================
function valid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}
function clean(str) { return String(str || '').replace(/[<>]/g, '').trim(); }

// ============================================================
//  MIDDLEWARE: ROUTE GUARDS
// ============================================================
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Please log in to continue.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

// ============================================================
//  CUSTOMER AUTH
// ============================================================
app.post('/api/auth/register', authLimiter, [
  body('name').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Please enter a valid email address').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { name, email, password } = req.body;
    const users = DB.getUsers();
    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = { id: nextId(users), name: clean(name), email, password_hash: hash, role: 'customer', created_at: now() };
    DB.saveUsers([...users, user]);
    req.session.userId = user.id;
    req.session.save();
    const { password_hash, ...safe } = user;
    res.json({ user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { email, password } = req.body;
    const user = DB.getUsers().find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    req.session.userId = user.id;
    req.session.save();
    const { password_hash, ...safe } = user;
    res.json({ user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  const user = DB.getUsers().find(u => u.id === req.session.userId);
  if (!user) return res.json({ user: null });
  const { password_hash, ...safe } = user;
  res.json({ user: safe });
});

// ============================================================
//  ADMIN AUTH
// ============================================================
app.post('/api/admin/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const admin = DB.getAdmins().find(a => a.username === 'admin');
    if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });
    const ok = await bcrypt.compare(req.body.password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect admin password.' });
    req.session.adminId = admin.id;
    req.session.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  delete req.session.adminId;
  req.session.save(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  res.json({ isAdmin: !!req.session?.adminId });
});

app.post('/api/admin/change-password', requireAdmin, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  body('confirmPassword').notEmpty().withMessage('Please confirm your new password'),
], async (req, res) => {
  if (!valid(req, res)) return;
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  try {
    const admins = DB.getAdmins();
    const admin  = admins.find(a => a.id === req.session.adminId);
    const ok     = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password.' });
    const hash = await bcrypt.hash(newPassword, 12);
    DB.saveAdmins(admins.map(a => a.id === admin.id ? { ...a, password_hash: hash } : a));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const orders   = DB.getOrders();
  const products = DB.getProducts();
  const users    = DB.getUsers();
  const revenue  = orders.filter(o => o.order_status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
  const pending  = orders.filter(o => o.order_status === 'pending').length;
  res.json({ products: products.length, orders: orders.length, revenue, pending, customers: users.length });
});

// ============================================================
//  PRODUCTS
// ============================================================
app.get('/api/products', (req, res) => {
  const products = DB.getProducts().slice().reverse(); // newest first
  res.json(products);
});

app.get('/api/products/:id', [param('id').isInt()], (req, res) => {
  if (!valid(req, res)) return;
  const p = DB.getProducts().find(x => x.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  res.json(p);
});

app.post('/api/products', requireAdmin, [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 200 }),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required').isLength({ max: 100 }),
  body('description').optional().isLength({ max: 2000 }),
  body('image_url').optional({ checkFalsy: true }).isLength({ max: 2000 }),
], (req, res) => {
  if (!valid(req, res)) return;
  const { name, price, category, image_url, description, in_stock, featured } = req.body;
  const products = DB.getProducts();
  const product  = {
    id: nextId(products), name: clean(name), price: parseFloat(price),
    category: clean(category), image_url: clean(image_url || ''),
    description: clean(description || ''), in_stock: !!in_stock, featured: !!featured,
    created_at: now(),
  };
  DB.saveProducts([...products, product]);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdmin, [
  param('id').isInt(),
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 200 }),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('description').optional().isLength({ max: 2000 }),
  body('image_url').optional({ checkFalsy: true }).isLength({ max: 2000 }),
], (req, res) => {
  if (!valid(req, res)) return;
  const id       = parseInt(req.params.id);
  const products = DB.getProducts();
  const idx      = products.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found.' });
  const { name, price, category, image_url, description, in_stock, featured } = req.body;
  const updated  = {
    ...products[idx], name: clean(name), price: parseFloat(price),
    category: clean(category), image_url: clean(image_url || ''),
    description: clean(description || ''), in_stock: !!in_stock, featured: !!featured,
  };
  products[idx] = updated;
  DB.saveProducts(products);
  res.json(updated);
});

app.delete('/api/products/:id', requireAdmin, [param('id').isInt()], (req, res) => {
  if (!valid(req, res)) return;
  const id       = parseInt(req.params.id);
  const products = DB.getProducts();
  if (!products.find(x => x.id === id)) return res.status(404).json({ error: 'Product not found.' });
  DB.saveProducts(products.filter(x => x.id !== id));
  res.json({ ok: true });
});

// ============================================================
//  ORDERS
// ============================================================
app.post('/api/orders', [
  body('customerName').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('customerEmail').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('customerPhone').trim().notEmpty().withMessage('Phone number is required').isLength({ max: 30 }),
  body('deliveryAddress').trim().notEmpty().withMessage('Delivery address is required').isLength({ max: 500 }),
  body('items').isArray({ min: 1 }).withMessage('Your cart is empty'),
  body('items.*.productId').notEmpty().withMessage('Invalid product'),
  body('items.*.qty').isInt({ min: 1, max: 99 }).withMessage('Invalid quantity'),
  body('paymentMethod').isIn(['stripe', 'transfer']).withMessage('Invalid payment method'),
], (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { customerName, customerEmail, customerPhone, deliveryAddress, items, paymentMethod } = req.body;
    const settings    = DB.getSettings();
    const deliveryFee = parseFloat(settings.deliveryFee) || 5.99;
    const products    = DB.getProducts();

    // Compute prices from DB — NEVER trust client-sent prices
    let subtotal    = 0;
    const orderItems = [];
    for (const item of items) {
      const product = products.find(p => String(p.id) === String(item.productId));
      if (!product) return res.status(400).json({ error: 'One or more products were not found.' });
      if (!product.in_stock) return res.status(400).json({ error: `"${product.name}" is currently out of stock.` });
      const qty = parseInt(item.qty);
      subtotal += product.price * qty;
      orderItems.push({ product_id: product.id, product_name: product.name, price: product.price, quantity: qty });
    }

    const total       = Math.round((subtotal + deliveryFee) * 100) / 100;
    const orders      = DB.getOrders();
    const orderNumber = 'ORD-' + String(orders.length + 1001).padStart(5, '0');

    const order = {
      id: nextId(orders),
      order_number: orderNumber,
      user_id: req.session?.userId || null,
      customer_name: clean(customerName),
      customer_email: customerEmail,
      customer_phone: clean(customerPhone),
      delivery_address: clean(deliveryAddress),
      subtotal: Math.round(subtotal * 100) / 100,
      delivery_fee: deliveryFee,
      total,
      payment_method: paymentMethod,
      payment_status: 'pending',
      order_status: 'pending',
      stripe_session_id: null,
      items: orderItems,
      created_at: now(),
    };
    DB.saveOrders([...orders, order]);
    res.status(201).json({ order });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

app.get('/api/orders/mine', requireAuth, (req, res) => {
  const orders = DB.getOrders()
    .filter(o => o.user_id === req.session.userId)
    .slice().reverse();
  res.json(orders);
});

app.get('/api/orders', requireAdmin, (req, res) => {
  res.json(DB.getOrders().slice().reverse());
});

app.put('/api/orders/:id/status', requireAdmin, [
  param('id').isInt(),
  body('status').isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
], (req, res) => {
  if (!valid(req, res)) return;
  const id     = parseInt(req.params.id);
  const orders = DB.getOrders();
  const idx    = orders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
  orders[idx] = { ...orders[idx], order_status: req.body.status };
  DB.saveOrders(orders);
  res.json({ ok: true });
});

// ============================================================
//  SETTINGS
// ============================================================
app.get('/api/settings', (req, res) => {
  res.json(DB.getSettings());
});

app.put('/api/settings', requireAdmin, [
  body('deliveryFee').optional().isFloat({ min: 0 }).withMessage('Delivery fee must be a positive number'),
], (req, res) => {
  if (!valid(req, res)) return;
  const allowed  = ['whatsapp', 'instagram', 'bankName', 'sortCode', 'accountNumber', 'accountName', 'currency', 'deliveryFee'];
  const current  = DB.getSettings();
  const updates  = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = String(req.body[key]);
  }
  DB.saveSettings({ ...current, ...updates });
  res.json({ ok: true });
});

// ============================================================
//  STRIPE
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeEnabled: hasStripe });
});

app.post('/api/create-checkout-session', async (req, res) => {
  if (!hasStripe) return res.status(400).json({ error: 'Stripe is not configured. Add your keys to .env file.' });
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });
    const order = DB.getOrders().find(o => o.id === parseInt(orderId));
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const lineItems = (order.items || []).map(i => ({
      price_data: { currency: 'gbp', product_data: { name: i.product_name }, unit_amount: Math.round(i.price * 100) },
      quantity: i.quantity,
    }));
    if (order.delivery_fee > 0) {
      lineItems.push({ price_data: { currency: 'gbp', product_data: { name: 'Delivery' }, unit_amount: Math.round(order.delivery_fee * 100) }, quantity: 1 });
    }

    const sess = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url:  `${req.headers.origin}/checkout.html`,
      customer_email: order.customer_email,
      metadata: { orderId: String(order.id), orderNumber: order.order_number },
    });

    // Save session ID to order
    const orders = DB.getOrders();
    const idx    = orders.findIndex(o => o.id === order.id);
    if (idx !== -1) { orders[idx].stripe_session_id = sess.id; DB.saveOrders(orders); }

    res.json({ url: sess.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/verify-payment/:sessionId', async (req, res) => {
  if (!hasStripe) return res.json({ paid: false });
  try {
    const sess   = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (sess.payment_status === 'paid') {
      const orders = DB.getOrders();
      const idx    = orders.findIndex(o => o.stripe_session_id === req.params.sessionId);
      if (idx !== -1) {
        orders[idx].payment_status = 'paid';
        orders[idx].order_status   = 'confirmed';
        DB.saveOrders(orders);
      }
    }
    res.json({ paid: sess.payment_status === 'paid', orderId: sess.metadata?.orderId, orderNumber: sess.metadata?.orderNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

// ============================================================
//  START
// ============================================================
app.listen(PORT, () => {
  console.log(`\n  ✨ ee_tasha hairs  →  http://localhost:${PORT}\n`);
  console.log(`  📁 Data stored in: ${DATA_DIR}\n`);
  if (!hasStripe) console.log('  ⚠  Stripe NOT configured — add keys to .env to enable card payments.\n');
  else            console.log('  ✅ Stripe connected.\n');
});
