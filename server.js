'use strict';
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const path      = require('path');
const { createClient } = require('@supabase/supabase-js');
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app  = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// ============================================================
//  SUPABASE CLIENT  (server-side, service role — never exposed to client)
// ============================================================
const supabase = createClient(
  process.env.SUPABASE_URL        || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ============================================================
//  STRIPE
// ============================================================
const hasStripe = !!(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder'));
let stripe;
if (hasStripe) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ============================================================
//  HELPERS
// ============================================================
function clean(str) { return String(str || '').replace(/[<>]/g, '').trim(); }

const DEFAULT_DELIVERY_OPTIONS = [
  { id:'evri',          carrier:'Evri',       service:'Standard',   prices:{ uk:3.20,  europe:9.99,  world:13.99 }, days:{ uk:'2-4 days', europe:'5-8 days', world:'8-14 days'  }, minDays:{ uk:2, europe:5, world:8  }, active:true },
  { id:'royal-mail-48', carrier:'Royal Mail', service:'Tracked 48', prices:{ uk:3.40,  europe:12.99, world:16.99 }, days:{ uk:'2-3 days', europe:'5-7 days', world:'7-14 days'  }, minDays:{ uk:2, europe:5, world:7  }, active:true },
  { id:'royal-mail-24', carrier:'Royal Mail', service:'Tracked 24', prices:{ uk:4.19,  europe:14.99, world:18.99 }, days:{ uk:'1-2 days', europe:'5-7 days', world:'7-10 days'  }, minDays:{ uk:1, europe:5, world:7  }, active:true },
  { id:'dpd',           carrier:'DPD',        service:'Next Day',   prices:{ uk:7.99,  europe:15.99, world:24.99 }, days:{ uk:'Next day', europe:'3-5 days', world:'5-8 days'   }, minDays:{ uk:1, europe:3, world:5  }, active:true },
  { id:'dhl',           carrier:'DHL',        service:'Express',    prices:{ uk:9.99,  europe:19.99, world:29.99 }, days:{ uk:'1-2 days', europe:'2-3 days', world:'3-5 days'   }, minDays:{ uk:1, europe:2, world:3  }, active:true },
  { id:'ups',           carrier:'UPS',        service:'Express',    prices:{ uk:10.99, europe:22.99, world:34.99 }, days:{ uk:'1-2 days', europe:'2-3 days', world:'3-5 days'   }, minDays:{ uk:1, europe:2, world:3  }, active:true },
];
function valid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ============================================================
//  SEED / DEFAULTS  (runs once per cold start; idempotent)
// ============================================================
let _defaultsRun = false;
async function ensureDefaults() {
  if (_defaultsRun) return;
  _defaultsRun = true;
  try {
    // Seed delivery options if not set
    const { data: settData } = await supabase.from('settings').select('delivery_options').eq('id', 1).single();
    const needsDeliveryUpdate = !settData?.delivery_options?.length || !settData.delivery_options[0]?.minDays;
    if (needsDeliveryUpdate) {
      await supabase.from('settings').update({ delivery_options: DEFAULT_DELIVERY_OPTIONS }).eq('id', 1);
      console.log('  ✅ Delivery options seeded/updated with accurate prices.');
    }

    // Create product-images storage bucket if it doesn't exist
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.name === 'product-images')) {
      await supabase.storage.createBucket('product-images', { public: true });
      console.log('  ✅ Storage bucket "product-images" created.');
    }

    // Create admin account if none exists
    const { count: adminCount } = await supabase
      .from('admins').select('*', { count: 'exact', head: true });
    if (adminCount === 0) {
      const hash = await bcrypt.hash('eetasha2024', 12);
      await supabase.from('admins').insert({ username: 'admin', password_hash: hash });
      console.log('  ✅ Admin created  →  username: admin  password: eetasha2024  (change this!)');
    }

    // Seed sample products if none exist
    const { count: productCount } = await supabase
      .from('products').select('*', { count: 'exact', head: true });
    if (productCount === 0) {
      await supabase.from('products').insert([
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
          image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD1AFjTua3D9DtI66qS0iNH0MNGooSA-7fp5UNKNgTxQrea-D0AeuqZFeHqd55-1JMf0mdqT3bfaIRPQmMAau-1MfowV2FKRIwQ44P1PuZ4t0IlSyTv_1oKah4e53WYUIDxQofv_uzavuFacOy5sSlvQYpZHp-RTbEgVHxJUPBjkuSlPZsOt5XlZILhkTssn9jGlhkvuwhjZyQvcMNUL3osyjqbbFk4264MGlD-2jS_4LElcgy4KHgwhz9gsPrCVAXdn_bh2hHpsQ',
          description: 'Double drawn, bone straight. Currently restocking from our supplier.' },
      ]);
      console.log('  ✅ Sample products seeded.');
    }
  } catch (err) {
    console.error('ensureDefaults error:', err.message);
    _defaultsRun = false; // allow retry on next request
  }
}

// ============================================================
//  SECURITY MIDDLEWARE
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://js.stripe.com', 'https://cdn.jsdelivr.net'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc:  ["'self'", 'https://api.stripe.com', 'https://*.supabase.co'],
      frameSrc:    ['https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// ============================================================
//  ADMIN SESSION  (signed cookie — kept for admin only)
// ============================================================
const _sessSecret = process.env.SESSION_SECRET || 'et-fallback-secret';
function _sessSign(payload) {
  return payload + '.' + crypto.createHmac('sha256', _sessSecret).update(payload).digest('base64url');
}
function _sessUnsign(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload  = token.slice(0, i);
  const expected = _sessSign(payload);
  if (token.length !== expected.length) return null;
  let diff = 0;
  for (let j = 0; j < token.length; j++) diff |= token.charCodeAt(j) ^ expected.charCodeAt(j);
  return diff === 0 ? payload : null;
}
app.use(function sessionMiddleware(req, res, next) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const eq = c.indexOf('='); if (eq > 0) cookies[c.slice(0, eq).trim()] = c.slice(eq + 1).trim();
  });
  req.session = {};
  const token = cookies['et_sess'];
  if (token) {
    const payload = _sessUnsign(token);
    if (payload) { try { Object.assign(req.session, JSON.parse(Buffer.from(payload, 'base64url').toString())); } catch {} }
  }
  const origEnd = res.end.bind(res);
  res.end = function(...args) {
    if (!res.headersSent) {
      const sess   = req.session;
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      if (sess === null) {
        res.setHeader('Set-Cookie', 'et_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      } else if (Object.keys(sess).length > 0) {
        const p = Buffer.from(JSON.stringify(sess)).toString('base64url');
        res.setHeader('Set-Cookie', `et_sess=${_sessSign(p)}; Path=/; Max-Age=${7*24*3600}; HttpOnly; SameSite=Lax${secure}`);
      }
    }
    return origEnd.apply(this, args);
  };
  next();
});

// Run ensureDefaults on first API request (Vercel cold-start safe)
app.use('/api/', (req, res, next) => { ensureDefaults(); next(); });

// ============================================================
//  RATE LIMITERS
// ============================================================
const authLimiter    = rateLimit({ windowMs: 60*60*1000, max: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: 'Too many attempts — please try again in an hour.' } });
const generalLimiter = rateLimit({ windowMs: 60*60*1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests — please try again in an hour.' } });
app.use('/api/', generalLimiter);

// Static files (local dev only — Vercel serves these directly in production)
app.use(express.static(path.join(__dirname)));

// ============================================================
//  ROUTE GUARDS
// ============================================================

// Customer: validates Supabase JWT from Authorization header
async function requireUser(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.userId = user.id;
  next();
}

// Optionally attach userId if JWT present (guest checkout still works without it)
async function optionalUser(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) req.userId = user.id;
  }
  next();
}

// Admin: uses signed-cookie session (unchanged)
function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

// ============================================================
//  ADMIN AUTH
// ============================================================
app.post('/api/admin/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { data: admin } = await supabase.from('admins').select('*').eq('username', 'admin').single();
    if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });
    const ok = await bcrypt.compare(req.body.password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect admin password.' });
    req.session.adminId = admin.id;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  delete req.session.adminId;
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ isAdmin: !!req.session?.adminId });
});

app.post('/api/admin/change-password', requireAdmin, authLimiter, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  body('confirmPassword').notEmpty().withMessage('Please confirm your new password'),
], async (req, res) => {
  if (!valid(req, res)) return;
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  try {
    const { data: admin } = await supabase.from('admins').select('*').eq('id', req.session.adminId).single();
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    const ok = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password.' });
    const hash = await bcrypt.hash(newPassword, 12);
    await supabase.from('admins').update({ password_hash: hash }).eq('id', req.session.adminId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

app.post('/api/admin/upload-image', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    const ext      = req.file.originalname.split('.').pop().toLowerCase();
    const allowed  = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (!allowed.includes(ext)) return res.status(400).json({ error: 'Only jpg, png, webp or gif allowed.' });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from('product-images')
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(filename);
    res.json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [
      { count: productCount },
      { count: orderCount },
      { data: orders },
      { data: authData },
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('orders').select('total, order_status'),
      supabase.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const revenue  = (orders || []).filter(o => o.order_status !== 'cancelled').reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const pending  = (orders || []).filter(o => o.order_status === 'pending').length;
    const customers = authData?.users?.length || 0;
    res.json({ products: productCount || 0, orders: orderCount || 0, revenue, pending, customers });
  } catch {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ============================================================
//  PRODUCTS
// ============================================================
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load products.' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Product not found.' });
    res.json(data);
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
    const { data, error } = await supabase.from('products').insert({
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch {
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
    const { data, error } = await supabase.from('products').update({
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
    }).eq('id', req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: 'Product not found.' });
    res.json(data);
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
});

// ============================================================
//  ORDERS
// ============================================================
app.post('/api/orders', optionalUser, [
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
    const { customerName, customerEmail, customerPhone, deliveryAddress, items, paymentMethod, deliveryCarrierId, deliveryRegion } = req.body;

    // Get delivery fee — use selected carrier if provided, else fall back to flat fee
    const { data: settings } = await supabase.from('settings').select('delivery_fee, delivery_options').eq('id', 1).single();
    let deliveryFee     = parseFloat(settings?.delivery_fee) || 5.99;
    let deliveryCarrier = '';
    if (deliveryCarrierId && deliveryRegion) {
      const opts    = settings?.delivery_options || [];
      const region  = ['uk','europe','world'].includes(deliveryRegion) ? deliveryRegion : 'uk';
      const carrier = opts.find(o => o.id === deliveryCarrierId && o.active);
      if (carrier && carrier.prices?.[region] !== undefined) {
        deliveryFee     = carrier.prices[region];
        deliveryCarrier = `${carrier.carrier} ${carrier.service} (${region.toUpperCase()})`;
      }
    }

    // Compute prices from DB — NEVER trust client-sent prices
    let subtotal   = 0;
    const orderItems = [];
    for (const item of items) {
      const { data: product } = await supabase.from('products').select('*').eq('id', item.productId).single();
      if (!product) return res.status(400).json({ error: 'One or more products were not found.' });
      if (!product.in_stock) return res.status(400).json({ error: `"${product.name}" is currently out of stock.` });
      const qty = parseInt(item.qty);
      subtotal += product.price * qty;
      orderItems.push({ product_id: product.id, product_name: product.name, price: product.price, quantity: qty });
    }

    const total = Math.round((subtotal + deliveryFee) * 100) / 100;

    // Generate order number
    const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    const orderNumber = 'ORD-' + String((count || 0) + 1001).padStart(5, '0');

    const { data: order, error } = await supabase.from('orders').insert({
      order_number:     orderNumber,
      user_id:          req.userId || null,
      customer_name:    clean(customerName),
      customer_email:   customerEmail,
      customer_phone:   clean(customerPhone),
      delivery_address: clean(deliveryAddress),
      subtotal:         Math.round(subtotal * 100) / 100,
      delivery_fee:     deliveryFee,
      delivery_carrier: deliveryCarrier,
      total,
      payment_method:   paymentMethod,
      items:            orderItems,
    }).select().single();

    if (error) throw error;
    res.status(201).json({ order });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: 'Failed to create order. Please try again.' });
  }
});

app.get('/api/orders/mine', requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('*').eq('user_id', req.userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load orders.' });
  }
});

app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load orders.' });
  }
});

app.put('/api/orders/:id/status', requireAdmin, [
  body('status').isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { error } = await supabase.from('orders').update({ order_status: req.body.status }).eq('id', req.params.id);
    if (error) return res.status(404).json({ error: 'Order not found.' });
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
    const { data } = await supabase.from('settings').select('*').eq('id', 1).single();
    if (!data) return res.json({});
    // Map snake_case DB fields → camelCase for the client (same shape as before)
    res.json({
      whatsapp:        data.whatsapp,
      instagram:       data.instagram,
      bankName:        data.bank_name,
      sortCode:        data.sort_code,
      accountNumber:   data.account_number,
      accountName:     data.account_name,
      currency:        data.currency,
      deliveryFee:     data.delivery_fee,
      deliveryOptions: data.delivery_options || [],
    });
  } catch {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

app.put('/api/settings', requireAdmin, [
  body('deliveryFee').optional().isFloat({ min: 0 }).withMessage('Delivery fee must be a positive number'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    // Map camelCase from client → snake_case for DB
    const allowed = {
      whatsapp:      'whatsapp',
      instagram:     'instagram',
      bankName:      'bank_name',
      sortCode:      'sort_code',
      accountNumber: 'account_number',
      accountName:   'account_name',
      currency:      'currency',
      deliveryFee:   'delivery_fee',
    };
    const updates = {};
    for (const [clientKey, dbKey] of Object.entries(allowed)) {
      if (req.body[clientKey] !== undefined) updates[dbKey] = String(req.body[clientKey]);
    }
    if (req.body.deliveryOptions !== undefined) updates['delivery_options'] = req.body.deliveryOptions;
    await supabase.from('settings').update(updates).eq('id', 1);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// ============================================================
//  CONFIG  (public keys for client-side SDKs)
// ============================================================
app.get('/api/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    stripeEnabled:        hasStripe,
    supabaseUrl:          process.env.SUPABASE_URL       || '',
    supabaseAnonKey:      process.env.SUPABASE_ANON_KEY  || '',
  });
});

// ============================================================
//  STRIPE
// ============================================================
app.post('/api/create-checkout-session', async (req, res) => {
  if (!hasStripe) return res.status(400).json({ error: 'Stripe is not configured.' });
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'Order ID required.' });
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
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
      line_items:           lineItems,
      mode:                 'payment',
      success_url: `${req.headers.origin}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url:  `${req.headers.origin}/checkout.html`,
      customer_email: order.customer_email,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    });

    await supabase.from('orders').update({ stripe_session_id: sess.id }).eq('id', orderId);
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
      await supabase.from('orders')
        .update({ payment_status: 'paid', order_status: 'confirmed' })
        .eq('stripe_session_id', req.params.sessionId);
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
//  EXPORT FOR VERCEL  /  LISTEN LOCALLY
// ============================================================
module.exports = app;

if (require.main === module) {
  ensureDefaults().then(() => {
    app.listen(PORT, () => {
      console.log(`\n  ✨ ee_tasha hairs  →  http://localhost:${PORT}\n`);
      if (!hasStripe) console.log('  ⚠  Stripe NOT configured — add STRIPE_SECRET_KEY to .env\n');
      else            console.log('  ✅ Stripe connected.\n');
    });
  }).catch(err => { console.error('  ❌ Startup failed:', err.message); process.exit(1); });
}
