'use strict';
require('dotenv').config();

// Strip stray whitespace/newlines from secrets pasted into the hosting dashboard —
// a trailing "\n" on a key makes every Supabase/Stripe request fail.
for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY',
                 'STRIPE_PUBLISHABLE_KEY', 'RESEND_API_KEY', 'SESSION_SECRET', 'ADMIN_INITIAL_PASSWORD',
                 'PUBLIC_SITE_URL', 'NODE_ENV']) {
  if (typeof process.env[k] === 'string') process.env[k] = process.env[k].trim();
}

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
//  RESEND EMAIL
// ============================================================
const hasResend = !!process.env.RESEND_API_KEY;
let resendClient;
if (hasResend) {
  const { Resend } = require('resend');
  resendClient = new Resend(process.env.RESEND_API_KEY);
}

function escEmail(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendOrderConfirmationEmail(order) {
  if (!hasResend) return;
  try {
    // Fetch contact details from settings
    const { data: settings } = await supabase.from('settings').select('whatsapp, instagram').eq('id', 1).single();
    order.whatsapp  = settings?.whatsapp  || '';
    order.instagram = settings?.instagram || '@eetashacollection';

    const itemsHtml = (order.items || []).map(i => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0ede8;font-size:14px;">${escEmail(i.product_name)}${i.variant_label ? `<br><span style="color:#9b8860;font-size:12px;">${escEmail(i.variant_label)}</span>` : ''}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ede8;text-align:center;font-size:14px;">×${i.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0ede8;text-align:right;font-size:14px;">£${(i.price * i.quantity).toFixed(2)}</td>
      </tr>`).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:Georgia,serif;">
  <div style="max-width:580px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#1a1a1a;padding:32px;text-align:center;">
      <h1 style="margin:0;color:#c9a84c;font-size:22px;letter-spacing:2px;text-transform:uppercase;">eetashacollection</h1>
      <p style="margin:8px 0 0;color:#999;font-size:13px;font-family:Arial,sans-serif;">Luxury Hair Collection</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">
      <h2 style="margin:0 0 6px;color:#1a1a1a;font-size:20px;">Order Confirmed! 🎉</h2>
      <p style="margin:0 0 24px;color:#666;font-size:14px;font-family:Arial,sans-serif;">Hi ${escEmail(order.customer_name)}, thank you for your order. We've received it and will get it ready for dispatch soon.</p>

      <div style="background:#faf9f7;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;font-family:Arial,sans-serif;color:#666;">Order Reference</p>
        <p style="margin:4px 0 0;font-size:20px;color:#c9a84c;font-weight:bold;letter-spacing:1px;">${escEmail(order.order_number)}</p>
      </div>

      <!-- Items -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:#999;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f0ede8;">Item</th>
            <th style="text-align:center;font-size:11px;color:#999;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f0ede8;">Qty</th>
            <th style="text-align:right;font-size:11px;color:#999;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;padding-bottom:10px;border-bottom:2px solid #f0ede8;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <!-- Totals -->
      <div style="border-top:2px solid #f0ede8;padding-top:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-family:Arial,sans-serif;font-size:14px;color:#666;">
          <span>Subtotal</span><span>£${order.subtotal.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-family:Arial,sans-serif;font-size:14px;color:#666;">
          <span>Delivery${order.delivery_carrier ? ` (${order.delivery_carrier})` : ''}</span><span>£${order.delivery_fee.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#1a1a1a;">
          <span>Total</span><span style="color:#c9a84c;">£${order.total.toFixed(2)}</span>
        </div>
      </div>

      <!-- Delivery address -->
      <div style="margin-top:24px;padding:16px 20px;border:1px solid #f0ede8;border-radius:8px;">
        <p style="margin:0 0 6px;font-size:11px;color:#999;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;">Delivering To</p>
        <p style="margin:0;font-size:14px;color:#333;font-family:Arial,sans-serif;white-space:pre-line;">${escEmail(order.delivery_address)}</p>
      </div>

      <div style="margin-top:28px;padding:16px 20px;background:#faf9f7;border-radius:8px;border:1px solid #f0ede8;">
        <p style="margin:0 0 10px;font-size:11px;color:#999;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;">Need help with your order?</p>
        <p style="margin:0 0 6px;font-size:14px;font-family:Arial,sans-serif;color:#555;">💬 WhatsApp: <a href="https://wa.me/${(order.whatsapp||'').replace(/[^0-9]/g,'')}" style="color:#c9a84c;text-decoration:none;">${escEmail(order.whatsapp||'')}</a></p>
        <p style="margin:0 0 6px;font-size:14px;font-family:Arial,sans-serif;color:#555;">✉️ Email: <a href="mailto:eetasha.collection@gmail.com" style="color:#c9a84c;text-decoration:none;">eetasha.collection@gmail.com</a></p>
        <p style="margin:0 0 6px;font-size:14px;font-family:Arial,sans-serif;color:#555;">📸 Instagram: <a href="https://instagram.com/${(order.instagram||'').replace('@','')}" target="_blank" style="color:#c9a84c;text-decoration:none;">${escEmail(order.instagram||'@eetashacollection')}</a></p>
        <p style="margin:0;font-size:14px;font-family:Arial,sans-serif;color:#555;">📞 Phone: <a href="tel:${escEmail(order.whatsapp||'')}" style="color:#c9a84c;text-decoration:none;">${escEmail(order.whatsapp||'')}</a></p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#faf9f7;padding:20px 32px;text-align:center;border-top:1px solid #f0ede8;">
      <p style="margin:0;font-size:12px;color:#bbb;font-family:Arial,sans-serif;">© ${new Date().getFullYear()} eetashacollection · Luxury Hair Collection</p>
    </div>
  </div>
</body>
</html>`;

    await resendClient.emails.send({
      from:    'eetashacollection <noreply@eetashacollection.com>',
      to:      [order.customer_email],
      subject: `Order Confirmed — ${order.order_number} | eetashacollection`,
      html,
    });
    console.log(`  ✅ Confirmation email sent to ${order.customer_email}`);
  } catch (err) {
    console.error('  ⚠ Email send failed:', err.message);
    // Non-fatal — order still goes through
  }
}

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
    // The initial password comes from the environment — never from source code.
    if (adminCount === 0) {
      const initial = process.env.ADMIN_INITIAL_PASSWORD || '';
      if (initial.length >= 12 && !KNOWN_DEFAULT_ADMIN_PASSWORDS.includes(initial)) {
        const hash = await bcrypt.hash(initial, 12);
        await supabase.from('admins').insert({ username: 'admin', password_hash: hash });
        console.log('  ✅ Admin account created from ADMIN_INITIAL_PASSWORD. You can remove that variable now.');
      } else {
        console.warn('  ⚠ No admin account exists. Set ADMIN_INITIAL_PASSWORD (12+ characters) and restart to create one.');
      }
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
      scriptSrcAttr: ["'unsafe-inline'"],   // pages use onclick="" handlers (helmet blocks them by default)
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

const allowedOrigins = [
  'https://eetashacollection.com',
  'https://www.eetashacollection.com',
  /\.vercel\.app$/,
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server / curl
    const ok = allowedOrigins.some(o => typeof o === 'string' ? o === origin : o.test(origin));
    cb(ok ? null : new Error('Not allowed by CORS'), ok);
  },
  credentials: true,
}));
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));

// ============================================================
//  ADMIN SESSION  (signed cookie — kept for admin only)
// ============================================================
// SESSION_SECRET is required in production. There is deliberately no shared
// fallback: a fallback committed to a public repo would let anyone forge an
// admin cookie. Locally, a random per-process secret is generated instead.
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const _envSecret = process.env.SESSION_SECRET || '';
const _sessSecret = _envSecret.length >= 32
  ? _envSecret
  : (IS_PROD ? null : crypto.randomBytes(32).toString('hex'));
if (!_sessSecret) {
  console.error('  ❌ SESSION_SECRET is missing or shorter than 32 characters — admin login is DISABLED until it is set.');
}
const ADMIN_SESSION_HOURS = 12;
// Known default password that was once committed to this repo. Logging in with it
// is allowed only to change it — every other admin action is blocked.
const KNOWN_DEFAULT_ADMIN_PASSWORDS = ['eetasha2024'];

function _sessSign(payload) {
  return payload + '.' + crypto.createHmac('sha256', _sessSecret).update(payload).digest('base64url');
}
function _sessUnsign(token) {
  if (!_sessSecret) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload  = token.slice(0, i);
  const expected = Buffer.from(_sessSign(payload));
  const given    = Buffer.from(token);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return payload;
}
// Short fingerprint of the password hash: changing the password invalidates every existing session.
function _pwFingerprint(hash) {
  return crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 16);
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
    if (payload) {
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        // Sessions without an expiry (issued by older code) or past expiry are ignored
        if (data && typeof data.exp === 'number' && data.exp > Date.now()) Object.assign(req.session, data);
      } catch {}
    }
  }
  const origEnd = res.end.bind(res);
  res.end = function(...args) {
    if (!res.headersSent) {
      const sess   = req.session;
      const secure = IS_PROD ? '; Secure' : '';
      if (sess === null || (sess && Object.keys(sess).length === 0 && token)) {
        res.setHeader('Set-Cookie', `et_sess=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`);
      } else if (sess && Object.keys(sess).length > 0 && _sessSecret) {
        const p      = Buffer.from(JSON.stringify(sess)).toString('base64url');
        const maxAge = Math.max(0, Math.floor((sess.exp - Date.now()) / 1000));
        res.setHeader('Set-Cookie', `et_sess=${_sessSign(p)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`);
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
const authLimiter    = rateLimit({ windowMs: 60*60*1000, max: 10,  standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: 'Too many attempts — please try again in an hour.' } });
const orderLimiter   = rateLimit({ windowMs: 60*60*1000, max: 20,  standardHeaders: true, legacyHeaders: false, message: { error: 'Too many orders from this device — please try again later.' } });
const generalLimiter = rateLimit({ windowMs: 60*60*1000, max: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests — please try again in an hour.' } });
app.use('/api/', generalLimiter);

// Static files (local dev only — Vercel serves these directly in production)
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

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

// Admin: signed-cookie session, re-checked against the database on every request
// so a password change (or deleted admin) immediately ends all other sessions.
async function loadSessionAdmin(req) {
  if (!req.session?.adminId || !req.session?.pv) return null;
  const { data: admin } = await supabase.from('admins').select('id, password_hash').eq('id', req.session.adminId).single();
  if (!admin || _pwFingerprint(admin.password_hash) !== req.session.pv) return null;
  return admin;
}
function requireAdminSession({ allowMustChange = false } = {}) {
  return async (req, res, next) => {
    try {
      const admin = await loadSessionAdmin(req);
      if (!admin) { req.session = null; return res.status(403).json({ error: 'Admin access required.' }); }
      if (req.session.mustChange && !allowMustChange) {
        return res.status(403).json({ error: 'Please change the default admin password first.', mustChangePassword: true });
      }
      req.admin = admin;
      next();
    } catch {
      res.status(403).json({ error: 'Admin access required.' });
    }
  };
}
const requireAdmin = requireAdminSession();

// ============================================================
//  ADMIN AUTH
// ============================================================
app.post('/api/admin/login', authLimiter, [
  body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
  if (!valid(req, res)) return;
  if (!_sessSecret) return res.status(503).json({ error: 'Admin login is disabled: SESSION_SECRET is not configured on the server.' });
  try {
    const { data: admin } = await supabase.from('admins').select('*').eq('username', 'admin').single();
    if (!admin) return res.status(401).json({ error: 'Incorrect admin password.' });
    const ok = await bcrypt.compare(req.body.password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect admin password.' });
    const mustChange = KNOWN_DEFAULT_ADMIN_PASSWORDS.includes(req.body.password);
    req.session = {
      adminId: admin.id,
      pv:      _pwFingerprint(admin.password_hash),
      exp:     Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000,
      ...(mustChange ? { mustChange: true } : {}),
    };
    res.json({ ok: true, mustChangePassword: mustChange });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/admin/me', async (req, res) => {
  const admin = await loadSessionAdmin(req).catch(() => null);
  if (!admin && req.session?.adminId) req.session = null;
  res.json({ isAdmin: !!admin, mustChangePassword: !!(admin && req.session?.mustChange) });
});

app.post('/api/admin/change-password', authLimiter, requireAdminSession({ allowMustChange: true }), [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 12 }).withMessage('New password must be at least 12 characters'),
  body('confirmPassword').notEmpty().withMessage('Please confirm your new password'),
], async (req, res) => {
  if (!valid(req, res)) return;
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  if (KNOWN_DEFAULT_ADMIN_PASSWORDS.includes(newPassword) || newPassword === currentPassword) {
    return res.status(400).json({ error: 'Please choose a new password you have not used before.' });
  }
  try {
    const admin = req.admin;
    const ok = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password.' });
    const hash = await bcrypt.hash(newPassword, 12);
    const { error } = await supabase.from('admins').update({ password_hash: hash }).eq('id', admin.id);
    if (error) throw error;
    // Re-issue this session against the new password; all other sessions are now invalid.
    req.session = {
      adminId: admin.id,
      pv:      _pwFingerprint(hash),
      exp:     Date.now() + ADMIN_SESSION_HOURS * 3600 * 1000,
    };
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

app.post('/api/admin/upload-image', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    // Decide the type from the file's actual bytes, not its name or the browser's claim
    const b = req.file.buffer;
    const sniffed =
      (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)                       ? { ext: 'jpg',  type: 'image/jpeg' } :
      (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG')                  ? { ext: 'png',  type: 'image/png'  } :
      (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') ? { ext: 'webp', type: 'image/webp' } :
      (b.slice(0, 4).toString() === 'GIF8')                                   ? { ext: 'gif',  type: 'image/gif'  } :
      null;
    if (!sniffed) return res.status(400).json({ error: 'Only jpg, png, webp or gif images are allowed.' });
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${sniffed.ext}`;
    const { error } = await supabase.storage
      .from('product-images')
      .upload(filename, b, { contentType: sniffed.type, upsert: false });
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
    const { name, price, category, image_url, description, in_stock, featured, variants } = req.body;
    const { data, error } = await supabase.from('products').insert({
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
      variants: variants && typeof variants === 'object' ? variants : null,
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
    const { name, price, category, image_url, description, in_stock, featured, variants } = req.body;
    const { data, error } = await supabase.from('products').update({
      name: clean(name), price: parseFloat(price), category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
      variants: variants && typeof variants === 'object' ? variants : null,
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
app.post('/api/orders', orderLimiter, optionalUser, [
  body('customerName').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('customerEmail').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('customerPhone').trim().notEmpty().withMessage('Phone number is required').isLength({ max: 30 }),
  body('deliveryAddress').trim().notEmpty().withMessage('Delivery address is required').isLength({ max: 500 }),
  body('items').isArray({ min: 1 }).withMessage('Your cart is empty'),
  body('items.*.productId').notEmpty().withMessage('Invalid product'),
  body('items').isArray({ max: 50 }).withMessage('Too many items in one order'),
  body('items.*.qty').isInt({ min: 1, max: 99 }).withMessage('Invalid quantity'),
  body('items.*.variantKey').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('Invalid option'),
  body('items.*.variantLabel').optional({ nullable: true }).isString().isLength({ max: 200 }).withMessage('Invalid option'),
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

      // Variant price validation
      let unitPrice;
      if (product.variants?.enabled) {
        if (!item.variantKey) return res.status(400).json({ error: `Please select options for "${product.name}".` });
        unitPrice = product.variants.prices?.[item.variantKey];
        if (unitPrice === undefined) return res.status(400).json({ error: `Invalid option selected for "${product.name}".` });
        if (product.variants.unavailable?.includes(item.variantKey)) return res.status(400).json({ error: `Selected option for "${product.name}" is unavailable.` });
      } else {
        unitPrice = product.price;
      }

      subtotal += unitPrice * qty;
      orderItems.push({
        product_id: product.id, product_name: product.name,
        price: unitPrice, quantity: qty,
        variant: item.variantKey || null, variant_label: item.variantLabel ? clean(item.variantLabel) : null,
      });
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

    // Send confirmation email (non-blocking)
    sendOrderConfirmationEmail(order);

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
    res.json(data || []);
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
      email:           data.email,
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
    if (order.payment_method !== 'stripe' || order.payment_status === 'paid' || order.order_status === 'cancelled') {
      return res.status(400).json({ error: 'This order cannot be paid by card.' });
    }
    // Only ever redirect back to our own site (the Origin header can be forged by scripts)
    const origin = allowedOrigins.some(o => typeof o === 'string' ? o === req.headers.origin : o.test(req.headers.origin || ''))
      ? req.headers.origin
      : (process.env.PUBLIC_SITE_URL || 'https://eetashacollection.com');

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
      success_url: `${origin}/checkout-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url:  `${origin}/checkout`,
      customer_email: order.customer_email,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    });

    await supabase.from('orders').update({ stripe_session_id: sess.id }).eq('id', orderId);
    res.json({ url: sess.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Card payment could not be started. Please try again or choose bank transfer.' });
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
    console.error('Verify payment error:', err.message);
    res.status(500).json({ error: 'Could not verify payment.' });
  }
});

// ============================================================
//  SEO: PRODUCT PAGES + SITEMAP  (server-rendered so search engines can read them)
// ============================================================
const SITE_URL  = (process.env.PUBLIC_SITE_URL || 'https://eetashacollection.com').replace(/\/+$/, '');
const BRAND     = 'eetashacollection';
const OG_IMAGE  = `${SITE_URL}/images/og-image.png`;
const UUID_RE   = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const escHtml   = escEmail;

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';
}
function productPath(p) { return `/product/${slugify(p.name)}-${p.id}`; }
function priceInfo(p) {
  const v = p.variants;
  if (v?.enabled && v.prices && Object.keys(v.prices).length) {
    const unavailable = new Set(v.unavailable || []);
    const vals = Object.entries(v.prices).filter(([k]) => !unavailable.has(k)).map(([, x]) => Number(x)).filter(x => x > 0);
    if (vals.length) return { low: Math.min(...vals), high: Math.max(...vals), hasRange: true };
  }
  return { low: Number(p.price), high: Number(p.price), hasRange: false };
}
function productDescription(p) {
  const d = String(p.description || '').trim();
  return d || `${p.name} from ${BRAND}. Premium ${String(p.category || 'hair').toLowerCase()} — luxury quality with tracked UK and worldwide delivery.`;
}
function jsonLd(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }

function pageShell({ title, description, canonical, image, head = '', body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <link rel="canonical" href="${escHtml(canonical)}">
  <meta property="og:site_name" content="${BRAND}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="${escHtml(canonical)}">
  <meta property="og:image" content="${escHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#1a1c1c">
  <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/images/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.101.1/dist/umd/supabase.min.js"></script>
  ${head}
</head>
<body data-page="product">
  <div id="siteNav"></div>
  ${body}
  <div id="siteFooter"></div>
  <script src="/js/app.js"></script>
</body>
</html>`;
}

const PRODUCT_PAGE_STYLE = `<style>
  .pd-crumbs { font-size: 0.8rem; color: var(--gray-500); margin-bottom: 24px; }
  .pd-crumbs a:hover { color: var(--gold-dark); }
  .pd { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
  .pd-img { border-radius: var(--radius-lg); overflow: hidden; background: var(--gray-100); aspect-ratio: 4 / 5; }
  .pd-img img { width: 100%; height: 100%; object-fit: cover; }
  .pd-info h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); margin: 6px 0 12px; }
  .pd-price { font-family: var(--font-head); font-size: 1.5rem; color: var(--gold-dark); margin-bottom: 8px; }
  .pd-price small { font-size: 0.8rem; color: var(--gray-400); font-family: var(--font-body); }
  .pd-stock { font-size: 0.82rem; font-weight: 600; margin-bottom: 20px; }
  .pd-stock.in { color: var(--success); } .pd-stock.out { color: var(--error); }
  .pd-desc { color: var(--gray-600); line-height: 1.8; margin-bottom: 24px; white-space: pre-line; }
  .pd-perks { margin-top: 28px; border-top: 1px solid var(--gray-200); padding-top: 20px; display: grid; gap: 10px; font-size: 0.88rem; color: var(--gray-600); }
  .pd-perks li { display: flex; gap: 10px; align-items: center; }
  .pd-perks .material-symbols-outlined { color: var(--gold-dark); font-size: 20px; }
  @media (max-width: 768px) { .pd { grid-template-columns: 1fr; gap: 24px; } }
</style>`;

app.get('/product/:slug', async (req, res) => {
  const m = UUID_RE.exec(req.params.slug || '');
  const notFound = () => res.status(404).type('html').send(pageShell({
    title: `Product not found | ${BRAND}`, description: 'This product is no longer available.',
    canonical: `${SITE_URL}/shop`, image: OG_IMAGE,
    head: '<meta name="robots" content="noindex">',
    body: `<main class="section page-top"><div class="container text-center" style="padding:60px 20px;">
      <h1 class="serif mb-2">Product not found</h1>
      <p style="color:var(--gray-500);margin-bottom:24px;">This item may have sold out or been removed.</p>
      <a href="/shop" class="btn btn-primary">Browse the collection</a></div></main>
      <script>document.addEventListener('DOMContentLoaded', async () => { await initApp(); renderNav('shop'); renderFooter(); document.body.classList.add('page-ready'); });</script>`,
  }));
  if (!m) return notFound();
  try {
    const { data: p } = await supabase.from('products').select('*').eq('id', m[1].toLowerCase()).single();
    if (!p) return notFound();
    const canonicalPath = productPath(p);
    if (req.path !== canonicalPath) return res.redirect(301, canonicalPath);

    const canonical = SITE_URL + canonicalPath;
    const desc      = productDescription(p);
    const image     = p.image_url || OG_IMAGE;
    const price     = priceInfo(p);
    const money     = n => `£${Number(n).toFixed(2)}`;
    const availability = p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: desc,
      image: [image],
      sku: p.id,
      category: p.category || undefined,
      brand: { '@type': 'Brand', name: BRAND },
      offers: price.hasRange
        ? { '@type': 'AggregateOffer', priceCurrency: 'GBP', lowPrice: price.low.toFixed(2), highPrice: price.high.toFixed(2), availability, url: canonical }
        : { '@type': 'Offer', priceCurrency: 'GBP', price: price.low.toFixed(2), availability, url: canonical, itemCondition: 'https://schema.org/NewCondition' },
    };
    const crumbsLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_URL + '/shop' },
        { '@type': 'ListItem', position: 3, name: p.name, item: canonical },
      ],
    };

    const html = pageShell({
      title: `${p.name} | ${BRAND}`,
      description: desc.slice(0, 160),
      canonical, image,
      head: `${PRODUCT_PAGE_STYLE}
  <meta property="og:type" content="product">
  <meta property="product:price:amount" content="${price.low.toFixed(2)}">
  <meta property="product:price:currency" content="GBP">
  <script type="application/ld+json">${jsonLd(ld)}</script>
  <script type="application/ld+json">${jsonLd(crumbsLd)}</script>`,
      body: `<main class="section page-top" id="productPage" data-product-id="${escHtml(p.id)}">
    <div class="container">
      <nav class="pd-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a> / <span>${escHtml(p.name)}</span></nav>
      <div class="pd">
        <div class="pd-img">${p.image_url ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.name)}">` : ''}</div>
        <div class="pd-info">
          <div class="product-card-category">${escHtml(p.category || 'Hair')}</div>
          <h1 class="serif">${escHtml(p.name)}</h1>
          <div class="pd-price">${price.hasRange ? `<small>from </small>${money(price.low)}` : money(price.low)}</div>
          <p class="pd-stock ${p.in_stock ? 'in' : 'out'}">${p.in_stock ? 'In stock' : 'Out of stock'}</p>
          <div class="pd-desc">${escHtml(desc)}</div>
          <div id="pdAction"><a href="/shop" class="btn btn-primary">Shop the collection</a></div>
          <ul class="pd-perks">
            <li><span class="material-symbols-outlined">local_shipping</span>Tracked UK &amp; worldwide delivery</li>
            <li><span class="material-symbols-outlined">verified</span>Premium quality hair, carefully selected</li>
            <li><span class="material-symbols-outlined">support_agent</span>Personal help on WhatsApp</li>
          </ul>
        </div>
      </div>
    </div>
  </main>
  <script>
    document.addEventListener('DOMContentLoaded', async () => {
      await initApp();
      renderNav('shop');
      renderFooter();
      updateCartCount();
      const id = document.getElementById('productPage').dataset.productId;
      const p  = Store.getProduct(id);
      const box = document.getElementById('pdAction');
      if (p) {
        const hasVariants = p.variants?.enabled && p.variants?.prices && Object.keys(p.variants.prices).length > 0;
        if (!p.in_stock)              box.innerHTML = '<button class="btn btn-secondary" disabled>Out of Stock</button>';
        else if (hasVariants)         box.innerHTML = '<button class="btn btn-primary" id="pdBtn">Select Options</button>';
        else if (!Store.getSession()) box.innerHTML = '<button class="btn btn-secondary" id="pdBtn">Sign in to Buy</button>';
        else                          box.innerHTML = '<button class="btn btn-primary" id="pdBtn">Add to Bag</button>';
        document.getElementById('pdBtn')?.addEventListener('click', () => {
          if (hasVariants) openVariantModal(p.id);
          else if (!Store.getSession()) promptLogin();
          else addToCartOrLogin(p.id);
        });
      }
      document.body.classList.add('page-ready');
    });
  </script>`,
    });
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.type('html').send(html);
  } catch (err) {
    console.error('Product page error:', err.message);
    res.status(500).type('html').send('<p>Something went wrong. <a href="/shop">Back to the shop</a></p>');
  }
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const { data: products } = await supabase.from('products').select('id, name, created_at, in_stock');
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      { loc: `${SITE_URL}/`,      lastmod: today, priority: '1.0' },
      { loc: `${SITE_URL}/shop`,  lastmod: today, priority: '0.9' },
      { loc: `${SITE_URL}/about`,                 priority: '0.5' },
      ...(products || []).map(p => ({
        loc: SITE_URL + productPath(p),
        lastmod: (p.created_at || '').slice(0, 10) || undefined,
        priority: p.in_stock ? '0.8' : '0.4',
      })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${escHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
    res.set('Cache-Control', 'public, max-age=0, s-maxage=3600');
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('Sitemap error:', err.message);
    res.status(500).type('text/plain').send('Sitemap unavailable');
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
      console.log(`\n  ✨ eetashacollection  →  http://localhost:${PORT}\n`);
      if (!hasStripe) console.log('  ⚠  Stripe NOT configured — add STRIPE_SECRET_KEY to .env\n');
      else            console.log('  ✅ Stripe connected.\n');
    });
  }).catch(err => { console.error('  ❌ Startup failed:', err.message); process.exit(1); });
}
