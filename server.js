'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const session    = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt     = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const path       = require('path');
const mongoose   = require('mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  MONGOOSE MODELS
// ============================================================

// Reusable toJSON transform: expose _id as id, strip __v
const toJson = {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
  },
};

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: 200 },
  price:       { type: Number, required: true, min: 0 },
  category:    { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 2000, default: '' },
  image_url:   { type: String, maxlength: 2000, default: '' },
  in_stock:    { type: Boolean, default: true },
  featured:    { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON: toJson });

const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, maxlength: 100 },
  email:         { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String, required: true },
  role:          { type: String, default: 'customer' },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON: toJson });

const adminSchema = new mongoose.Schema({
  username:      { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON: toJson });

const orderSchema = new mongoose.Schema({
  order_number:      { type: String, required: true, unique: true },
  user_id:           { type: String, default: null },
  customer_name:     { type: String, required: true },
  customer_email:    { type: String, required: true },
  customer_phone:    { type: String, required: true },
  delivery_address:  { type: String, required: true },
  subtotal:          Number,
  delivery_fee:      Number,
  total:             Number,
  payment_method:    { type: String, enum: ['stripe', 'transfer'] },
  payment_status:    { type: String, default: 'pending' },
  order_status:      { type: String, default: 'pending' },
  stripe_session_id: { type: String, default: null },
  items: [{
    product_id:   String,
    product_name: String,
    price:        Number,
    quantity:     Number,
    _id:          false,
  }],
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON: toJson });

const settingsSchema = new mongoose.Schema({
  _key:          { type: String, default: 'global', unique: true },
  whatsapp:      { type: String, default: '+44' },
  instagram:     { type: String, default: '@eetashahairs' },
  bankName:      { type: String, default: '' },
  sortCode:      { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName:   { type: String, default: 'ee_tasha hairs' },
  currency:      { type: String, default: '£' },
  deliveryFee:   { type: String, default: '5.99' },
});

const Product  = mongoose.model('Product',  productSchema);
const User     = mongoose.model('User',     userSchema);
const Admin    = mongoose.model('Admin',    adminSchema);
const Order    = mongoose.model('Order',    orderSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// ============================================================
//  HELPERS
// ============================================================
function clean(str) { return String(str || '').replace(/[<>]/g, '').trim(); }

async function getSettings() {
  let s = await Settings.findOne({ _key: 'global' });
  if (!s) s = await Settings.create({ _key: 'global' });
  return s;
}

// ============================================================
//  SEED DEFAULT DATA (runs once on first boot)
// ============================================================
async function seedData() {
  // Ensure settings doc exists
  await Settings.findOneAndUpdate(
    { _key: 'global' }, {}, { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Default admin account (password: eetasha2024)
  if (!(await Admin.countDocuments())) {
    const hash = await bcrypt.hash('eetasha2024', 12);
    await Admin.create({ username: 'admin', password_hash: hash });
    console.log('  ✅ Admin account created  →  password: eetasha2024  (change this in the dashboard!)');
  }

  // Sample products
  if (!(await Product.countDocuments())) {
    await Product.insertMany([
      { name: 'Luxury HD Lace Frontal Wig',  price: 285, category: 'Wigs',     in_stock: true,  featured: true,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBT_acbnNJllCa-myvQXbTiAfGG1Ng-QqFbGAkiQs-N2gTLamTG-VBCqWdJxYoLxkEHflEoVFQEO1dNJ7tDEsxeMaI-fo6TsDC2elJ8qLlmjTXj_jIOcxcRzSNC0kF2ZsgbKen96SmIlF-3tdv4-rUDhn5AuTOyqyLkIA5DYLTlTyV68_uJmM-kaukOSoiFnar8gf2jS663m_7sqDHdtlHRRh97ebJC7ktW1AmDgPtNkxRfvLnB4XtTUF6AN4IujIMcVb-dpYiJgg',
        description: '100% Virgin Human Hair, 180% Density, pre-plucked hairline. HD Swiss Lace.' },
      { name: 'Brazilian Body Wave Bundle',   price: 148, category: 'Bundles',  in_stock: true,  featured: true,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCtFlFGnIJDEScExko8LZfFdetzllUe281nGmyY-_5mvrSwbeNkgPiogL9PDYqoUtYpx5L5S0HJL4veqzYtae3i1_10ziTvrN8pF-Ve4OBKpc97oPc_A_bZxSTAcPY7t_-hTRCktKceWAcVrNgCTsZistyHHHYdd7KBuCFBG76GwV7raWzJ2WLo0hO2ltxV3pEgy-KUGOCbcIO1PCB_icgqMJmBKNGuzYVPvDShIiXHqIDJO3Fvn6nZxQUoPzuqOommSKJKAm9Y-A',
        description: 'Premium Brazilian body wave, double drawn, natural colour. 12-30 inches.' },
      { name: 'Raw Indian Deep Curl',          price: 165, category: 'Bundles',  in_stock: true,  featured: true,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCXS7g1NieJeyr80RdjUm0BGQe6WnTY1Dx98Az0nawtHWwKH6JbViftriQhDH99-yLvdGwXPMddit-PO2rQbPUvy5mdRcneQIpje-tWqQJHSvTaXb4EI-ESQc8cEsuRjAUoQVshPtYz67j72oYe5akSCQXOCJSrINxy2JQtc-Q1X8DF3hpVk9qDYChMz8VcD995q1KWQaYp4sK7qup7Mnw8p0CtnpIs1bS4OPzumNiFLyaAfUU9XBFczNct9xDqZfbebcGdchIk4A',
        description: 'Single donor, unprocessed deep curl. Maintains pattern after wash.' },
      { name: 'HD Lace Frontal 13×6',          price: 95,  category: 'Frontals', in_stock: true,  featured: false,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBjYIxz7Nhuwi6BcC5A8ZS7EJCO4WlubBQxq5gtiBgN22miZsePfKJZIcDtpLSazPz3hUJFT_YUg5dyxo5Pob6pUKfVWhawRGrxMGdnCCULOXx35pay6D18QciCQoeDHDAaz-7ndrbCsA5euHU7sNaFIHewA2IQmNKmnHyUSfozZZw_he1ERTpS97HiV7bu5p-JClUPkNeLNLQdDAemXHadupzuSbcZttkUjx7F-1dDSB8ci69IWAiGgxSc5-CGH7KVtKGts52O7w',
        description: 'Invisible film HD lace frontal, ear to ear. Pre-plucked baby hairs.' },
      { name: 'Signature Silk Serum',          price: 28,  category: 'Care',     in_stock: true,  featured: false,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB79wd18no-0YUtYprOsVvZIO6iGvx6CdKe7zmDDT1kNnxZJQh_f-j-fxrYQbMfYP8PmaziHEYG1k2yNESLGXq_-D6LagCXBEriKrlBMIbUSTb5h0q3jhCP4jrDR4lyycagvPM6YlBLL4-waBNIlDSu-1L0P8aRQs82WLl3bXvfv0FFuLXLgL-7BU8phXWF3ADGn7KimEmiMoyB7CfJRiuuu6NdZ8YNIRy6oBBDcIo5qa83ZjUeyRb0_O2evC6jobdkC8dnYER9Qw',
        description: 'Nourish and protect your hair investment. Lightweight, anti-frizz formula.' },
      { name: 'Peruvian Silk Straight',        price: 175, category: 'Bundles',  in_stock: false, featured: false,
        image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD1AFjTua3D9DtI66qS0iNH0MNGooSA-7fp5UNKNgTxQrea-D0AeuqZFeHqd55-1JMf0mdqT3bfaIRPQmMAau-lMfowV2FKRIwQ44P1PuZ4t0IlSyTv_1oKah4e53WYUIDxQofv_uzavuFacOy5sSlvQYpZHp-RTbEgVHxJUPBjkuSlPZsOt5XlZILhkTssn9jGlhkvuwhjZyQvcMNUL3osyjqbbFk4264MGlD-2jS_4LElcgy4KHgwhz9gsPrCVAXdn_bh2hHpsQ',
        description: 'Double drawn, bone straight. Currently restocking from our supplier.' },
    ]);
    console.log('  ✅ Sample products seeded.');
  }
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

// ---- Sessions (stored in MongoDB so they survive Render restarts) ----
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/eetasha';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-this')) {
  console.warn('  ⚠  SESSION_SECRET is not set — update it before going live.');
}
app.use(session({
  secret:            process.env.SESSION_SECRET || 'et-fallback-secret',
  resave:            false,
  saveUninitialized: false,
  name:              'et.sid',
  store:             MongoStore.create({ mongoUrl: MONGODB_URI, ttl: 7 * 24 * 60 * 60, touchAfter: 24 * 3600 }),
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// ---- Rate limiters ----
const authLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: 'Too many attempts — please try again in 15 minutes.' } });
const generalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// Static files
app.use(express.static(path.join(__dirname)));

// ============================================================
//  VALIDATION HELPER
// ============================================================
function valid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ============================================================
//  ROUTE GUARDS
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
    if (await User.findOne({ email })) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({ name: clean(name), email, password_hash: hash });
    req.session.userId = user._id.toString();
    await req.session.save();
    const safe = user.toJSON();
    delete safe.password_hash;
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
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    req.session.userId = user._id.toString();
    await req.session.save();
    const safe = user.toJSON();
    delete safe.password_hash;
    res.json({ user: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.json({ user: null });
    const safe = user.toJSON();
    delete safe.password_hash;
    res.json({ user: safe });
  } catch {
    res.json({ user: null });
  }
});

// ============================================================
//  ADMIN AUTH
// ============================================================
app.post('/api/admin/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const admin = await Admin.findOne({ username: 'admin' });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });
    const ok = await bcrypt.compare(req.body.password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect admin password.' });
    req.session.adminId = admin._id.toString();
    await req.session.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', async (req, res) => {
  delete req.session.adminId;
  await req.session.save();
  res.json({ ok: true });
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
    const admin = await Admin.findById(req.session.adminId);
    const ok    = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password.' });
    admin.password_hash = await bcrypt.hash(newPassword, 12);
    await admin.save();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [productCount, customerCount, orders] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments(),
      Order.find({}, 'total order_status').lean(),
    ]);
    const revenue = orders.filter(o => o.order_status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
    const pending = orders.filter(o => o.order_status === 'pending').length;
    res.json({ products: productCount, orders: orders.length, revenue, pending, customers: customerCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ============================================================
//  PRODUCTS
// ============================================================
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products.map(p => p.toJSON()));
  } catch {
    res.status(500).json({ error: 'Failed to load products.' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await Product.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    res.json(p.toJSON());
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
});

app.post('/api/products', requireAdmin, [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 200 }),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required').isLength({ max: 100 }),
  body('description').optional().isLength({ max: 2000 }),
  body('image_url').optional({ checkFalsy: true }).isLength({ max: 2000 }),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { name, price, category, image_url, description, in_stock, featured } = req.body;
    const product = await Product.create({
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
    });
    res.status(201).json(product.toJSON());
  } catch (err) {
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

app.put('/api/products/:id', requireAdmin, [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 200 }),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('description').optional().isLength({ max: 2000 }),
  body('image_url').optional({ checkFalsy: true }).isLength({ max: 2000 }),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { name, price, category, image_url, description, in_stock, featured } = req.body;
    const product = await Product.findByIdAndUpdate(req.params.id, {
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
    }, { new: true });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json(product.toJSON());
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Product.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
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
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { customerName, customerEmail, customerPhone, deliveryAddress, items, paymentMethod } = req.body;
    const settings    = await getSettings();
    const deliveryFee = parseFloat(settings.deliveryFee) || 5.99;

    // Compute prices from DB — NEVER trust client-sent prices
    let subtotal = 0;
    const orderItems = [];
    for (const item of items) {
      let product = null;
      try { product = await Product.findById(item.productId); } catch { /* invalid id format */ }
      if (!product) return res.status(400).json({ error: 'One or more products were not found.' });
      if (!product.in_stock) return res.status(400).json({ error: `"${product.name}" is currently out of stock.` });
      const qty = parseInt(item.qty);
      subtotal += product.price * qty;
      orderItems.push({ product_id: product._id.toString(), product_name: product.name, price: product.price, quantity: qty });
    }

    const total       = Math.round((subtotal + deliveryFee) * 100) / 100;
    const count       = await Order.countDocuments();
    const orderNumber = 'ORD-' + String(count + 1001).padStart(5, '0');

    const order = await Order.create({
      order_number:     orderNumber,
      user_id:          req.session?.userId || null,
      customer_name:    clean(customerName),
      customer_email:   customerEmail,
      customer_phone:   clean(customerPhone),
      delivery_address: clean(deliveryAddress),
      subtotal:         Math.round(subtotal * 100) / 100,
      delivery_fee:     deliveryFee,
      total,
      payment_method:   paymentMethod,
      items:            orderItems,
    });

    res.status(201).json({ order: order.toJSON() });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

app.get('/api/orders/mine', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find({ user_id: req.session.userId }).sort({ createdAt: -1 });
    res.json(orders.map(o => o.toJSON()));
  } catch {
    res.status(500).json({ error: 'Failed to load orders.' });
  }
});

app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders.map(o => o.toJSON()));
  } catch {
    res.status(500).json({ error: 'Failed to load orders.' });
  }
});

app.put('/api/orders/:id/status', requireAdmin, [
  body('status').isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { order_status: req.body.status });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Order not found.' });
  }
});

// ============================================================
//  SETTINGS
// ============================================================
app.get('/api/settings', async (req, res) => {
  try {
    const s = await getSettings();
    const obj = s.toObject();
    delete obj._id; delete obj.__v; delete obj._key;
    res.json(obj);
  } catch {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

app.put('/api/settings', requireAdmin, [
  body('deliveryFee').optional().isFloat({ min: 0 }).withMessage('Delivery fee must be a positive number'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const allowed = ['whatsapp', 'instagram', 'bankName', 'sortCode', 'accountNumber', 'accountName', 'currency', 'deliveryFee'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = String(req.body[key]);
    }
    await Settings.findOneAndUpdate({ _key: 'global' }, updates, { upsert: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
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
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const lineItems = (order.items || []).map(i => ({
      price_data: { currency: 'gbp', product_data: { name: i.product_name }, unit_amount: Math.round(i.price * 100) },
      quantity: i.quantity,
    }));
    if (order.delivery_fee > 0) {
      lineItems.push({
        price_data: { currency: 'gbp', product_data: { name: 'Delivery' }, unit_amount: Math.round(order.delivery_fee * 100) },
        quantity: 1,
      });
    }

    const sess = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${order._id}`,
      cancel_url:  `${req.headers.origin}/checkout.html`,
      customer_email: order.customer_email,
      metadata: { orderId: order._id.toString(), orderNumber: order.order_number },
    });

    order.stripe_session_id = sess.id;
    await order.save();

    res.json({ url: sess.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/verify-payment/:sessionId', async (req, res) => {
  if (!hasStripe) return res.json({ paid: false });
  try {
    const sess = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (sess.payment_status === 'paid') {
      await Order.findOneAndUpdate(
        { stripe_session_id: req.params.sessionId },
        { payment_status: 'paid', order_status: 'confirmed' }
      );
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
//  CONNECT TO MONGODB, THEN START SERVER
// ============================================================
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('  ✅ MongoDB connected');
    await seedData();
    app.listen(PORT, () => {
      console.log(`\n  ✨ ee_tasha hairs  →  http://localhost:${PORT}\n`);
      if (!hasStripe) console.log('  ⚠  Stripe NOT configured — add STRIPE_SECRET_KEY to .env\n');
      else            console.log('  ✅ Stripe connected.\n');
    });
  })
  .catch(err => {
    console.error('  ❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
