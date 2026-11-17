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
const Pricing = require('./js/pricing.js');
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

// ---------- Customer emails (receipt + "on its way") ----------
// Email apps (Gmail, Outlook, Apple Mail) ignore modern CSS like flexbox, so the
// layout uses tables and inline styles only. Every email also has a plain-text version.
const SHOP_EMAIL   = 'eetasha.collection@gmail.com';
const EMAIL_FROM   = 'eetashacollection <noreply@eetashacollection.com>';
const siteUrl      = () => (process.env.PUBLIC_SITE_URL || 'https://eetashacollection.com').trim().replace(/\/+$/, '');
const gbp          = n => `£${(Number(n) || 0).toFixed(2)}`;
const ukDate       = d => new Date(d || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const F            = 'font-family:Arial,Helvetica,sans-serif;';

// WhatsApp is switched off until the new business number is ready (same switch in js/app.js).
const WHATSAPP_ON  = false;

async function shopContacts() {
  const { data } = await supabase.from('settings').select('whatsapp, instagram, bank_name, sort_code, account_number, account_name').eq('id', 1).single();
  return {
    whatsapp:  WHATSAPP_ON ? (data?.whatsapp || '') : '',
    instagram: data?.instagram || '@eetashacollection',
    bank: data || {},
  };
}

function emailLayout({ preheader, heading, intro, content, contacts }) {
  const wa = (contacts.whatsapp || '').replace(/[^0-9]/g, '');
  const ig = (contacts.instagram || '').replace(/^@/, '');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escEmail(heading)}</title></head>
<body style="margin:0;padding:0;background:#faf9f7;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escEmail(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;">
    <tr><td style="background:#1a1a1a;padding:28px;text-align:center;border-radius:12px 12px 0 0;">
      <div style="font-family:Georgia,serif;color:#c9a84c;font-size:22px;letter-spacing:2px;text-transform:uppercase;">eetashacollection</div>
      <div style="${F}color:#999999;font-size:13px;margin-top:6px;">Luxury Hair Collection</div>
    </td></tr>
    <tr><td style="padding:32px 28px;">
      <h1 style="margin:0 0 8px;font-family:Georgia,serif;color:#1a1a1a;font-size:21px;font-weight:normal;">${escEmail(heading)}</h1>
      <p style="margin:0 0 24px;${F}color:#555555;font-size:14px;line-height:1.6;">${intro}</p>
      ${content}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;background:#faf9f7;border:1px solid #f0ede8;border-radius:8px;"><tr><td style="padding:16px 20px;${F}font-size:14px;color:#555555;line-height:1.9;">
        <div style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;">Need help with your order?</div>
        ${wa ? `WhatsApp: <a href="https://wa.me/${wa}" style="color:#9b7a2a;">${escEmail(contacts.whatsapp)}</a><br>` : ''}
        Email: <a href="mailto:${SHOP_EMAIL}" style="color:#9b7a2a;">${SHOP_EMAIL}</a> (or just reply to this email)<br>
        ${ig ? `Instagram: <a href="https://instagram.com/${escEmail(ig)}" style="color:#9b7a2a;">@${escEmail(ig)}</a>` : ''}
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:18px 28px;text-align:center;border-top:1px solid #f0ede8;${F}font-size:12px;color:#aaaaaa;line-height:1.7;">
      <a href="${siteUrl()}" style="color:#9b7a2a;">eetashacollection.com</a> · <a href="${siteUrl()}/returns" style="color:#9b7a2a;">Returns policy</a><br>
      © ${new Date().getFullYear()} eetashacollection
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// Items, totals, payment and delivery details — the receipt itself
function receiptHtml(order, paymentText, amountLabel) {
  const cell = 'padding:10px 0;border-bottom:1px solid #f0ede8;font-size:14px;vertical-align:top;';
  const head = `text-align:left;${F}font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;padding-bottom:8px;border-bottom:2px solid #f0ede8;`;
  const items = (order.items || []).map(i => `<tr>
      <td style="${cell}${F}color:#1a1a1a;">${escEmail(i.product_name)}${i.variant_label ? `<br><span style="color:#9b8860;font-size:12px;">${escEmail(i.variant_label)}</span>` : ''}</td>
      <td style="${cell}${F}text-align:center;color:#555555;white-space:nowrap;padding-left:14px;padding-right:14px;">× ${Number(i.quantity) || 1}</td>
      <td style="${cell}${F}text-align:right;color:#1a1a1a;white-space:nowrap;padding-left:8px;">${gbp(Number(i.price) * (Number(i.quantity) || 1))}</td>
    </tr>`).join('');
  const row = (label, value, strong) => `<tr>
      <td style="${F}padding:4px 0;font-size:${strong ? 16 : 14}px;color:${strong ? '#1a1a1a' : '#555555'};${strong ? 'font-weight:bold;' : ''}">${label}</td>
      <td style="${F}padding:4px 0;font-size:${strong ? 16 : 14}px;text-align:right;color:${strong ? '#9b7a2a' : '#555555'};${strong ? 'font-weight:bold;' : ''}">${value}</td></tr>`;
  const deliveryFee = Number(order.delivery_fee) || 0;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;border-radius:8px;margin-bottom:22px;"><tr>
      <td style="padding:14px 18px;${F}font-size:13px;color:#555555;line-height:1.8;">
        <strong style="color:#1a1a1a;">Order ${escEmail(order.order_number)}</strong><br>
        Date: ${ukDate(order.created_at)}<br>
        Payment: ${escEmail(paymentText)}
      </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
      <tr><th style="${head}">Item</th><th style="${head}text-align:center;padding-left:14px;padding-right:14px;">Qty</th><th style="${head}text-align:right;">Price</th></tr>
      ${items}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('Subtotal', gbp(order.subtotal))}
      ${row(`Delivery${order.delivery_carrier ? `<br><span style="font-size:12px;color:#999999;">${escEmail(order.delivery_carrier)}</span>` : ''}`, deliveryFee ? gbp(deliveryFee) : 'FREE')}
      ${row(amountLabel, gbp(order.total), true)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border:1px solid #f0ede8;border-radius:8px;"><tr>
      <td style="padding:14px 18px;${F}font-size:14px;color:#333333;line-height:1.6;">
        <div style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Delivering to</div>
        <strong>${escEmail(order.customer_name)}</strong><br>
        <span style="white-space:pre-line;">${escEmail(order.delivery_address)}</span><br>
        <span style="color:#777777;">${escEmail(order.customer_phone || '')}</span>
      </td></tr></table>`;
}

function receiptText(order, paymentText, amountLabel) {
  const lines = (order.items || []).map(i => `- ${i.product_name}${i.variant_label ? ` (${i.variant_label})` : ''} x${Number(i.quantity) || 1}: ${gbp(Number(i.price) * (Number(i.quantity) || 1))}`);
  return [
    `Order ${order.order_number}`, `Date: ${ukDate(order.created_at)}`, `Payment: ${paymentText}`, '',
    ...lines, '',
    `Subtotal: ${gbp(order.subtotal)}`,
    `Delivery${order.delivery_carrier ? ` (${order.delivery_carrier})` : ''}: ${Number(order.delivery_fee) ? gbp(order.delivery_fee) : 'FREE'}`,
    `${amountLabel}: ${gbp(order.total)}`, '',
    'Delivering to:', order.customer_name, order.delivery_address, '',
  ].join('\n');
}

function contactsText(contacts) {
  return [
    'Need help? ' + [contacts.whatsapp && `WhatsApp ${contacts.whatsapp}`, `email ${SHOP_EMAIL} (or reply to this email)`, contacts.instagram && `Instagram ${contacts.instagram}`].filter(Boolean).join(' · '),
    `${siteUrl()} · Returns policy: ${siteUrl()}/returns`,
  ].join('\n');
}

// kind: 'paid'     → payment received: this is the customer's receipt (card, or bank transfer marked paid by admin)
//       'transfer' → order placed, waiting for the customer's bank transfer (includes the bank details)
async function sendOrderConfirmationEmail(order, kind = 'paid') {
  if (!hasResend) return;
  try {
    const contacts = await shopContacts();
    const awaitingTransfer = kind === 'transfer';
    const paymentText = order.payment_method === 'transfer'
      ? (awaitingTransfer ? 'Bank transfer — awaiting payment' : 'Bank transfer — paid')
      : 'Paid online';
    const amountLabel = awaitingTransfer ? 'Total to pay' : 'Total paid';
    const b = contacts.bank;

    const bankHtml = awaitingTransfer ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:2px solid #c9a84c;border-radius:8px;"><tr>
        <td style="padding:16px 20px;${F}font-size:14px;color:#555555;line-height:1.8;">
          <strong style="color:#1a1a1a;">Please pay by bank transfer to complete your order</strong><br>
          Bank: <strong>${escEmail(b.bank_name || '')}</strong><br>
          Account name: <strong>${escEmail(b.account_name || '')}</strong><br>
          Sort code: <strong>${escEmail(b.sort_code || '')}</strong><br>
          Account number: <strong>${escEmail(b.account_number || '')}</strong><br>
          Amount: <strong>${gbp(order.total)}</strong><br>
          Reference: <strong>${escEmail(order.order_number)}</strong>
          <div style="font-size:12px;color:#999999;margin-top:8px;">We'll email you your receipt as soon as the payment arrives, then get your order ready.</div>
        </td></tr></table>` : '';

    const intro = awaitingTransfer
      ? `Hi ${escEmail(order.customer_name)}, thank you for your order. Please complete your bank transfer using the details below.`
      : `Hi ${escEmail(order.customer_name)}, thank you for shopping with us. Your payment has been received, and this email is your receipt. We'll email you again when your order is on its way.`;

    const html = emailLayout({
      preheader: awaitingTransfer ? `Order ${order.order_number}: please complete your bank transfer of ${gbp(order.total)}` : `Receipt for order ${order.order_number} — ${gbp(order.total)} paid`,
      heading:   awaitingTransfer ? 'Order received' : 'Thank you — here is your receipt',
      intro,
      content:   bankHtml + receiptHtml(order, paymentText, amountLabel),
      contacts,
    });
    const text = [
      awaitingTransfer ? 'ORDER RECEIVED — please complete your bank transfer' : 'THANK YOU — HERE IS YOUR RECEIPT', '',
      `Hi ${order.customer_name},`,
      awaitingTransfer
        ? `Please pay ${gbp(order.total)} by bank transfer: ${b.bank_name || ''}, account name ${b.account_name || ''}, sort code ${b.sort_code || ''}, account number ${b.account_number || ''}, reference ${order.order_number}.`
        : 'Your payment has been received. We will email you again when your order is on its way.', '',
      receiptText(order, paymentText, amountLabel),
      contactsText(contacts),
    ].join('\n');

    const { error } = await resendClient.emails.send({
      from:     EMAIL_FROM,
      to:       [order.customer_email],
      replyTo:  SHOP_EMAIL,
      subject:  awaitingTransfer
        ? `Order received — ${order.order_number} | Complete your bank transfer`
        : `Your receipt — order ${order.order_number} | eetashacollection`,
      html, text,
    });
    if (error) throw new Error(error.message || String(error));
    console.log(`  ✅ ${kind} email sent for ${order.order_number}`);
  } catch (err) {
    console.error('  ⚠ Email send failed:', err.message);
    // Non-fatal — order still goes through
  }
}

// Tracking links for the carriers we use; anything else just shows the number
function trackingUrl(carrierText, number) {
  const c = String(carrierText || '').toLowerCase(), n = encodeURIComponent(number);
  if (c.includes('royal mail') || c.includes('parcelforce')) return `https://www.royalmail.com/track-your-item#/tracking-results/${n}`;
  if (c.includes('fedex'))  return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes('dpd'))    return `https://track.dpd.co.uk/parcels/${n}`;
  if (c.includes('evri') || c.includes('hermes')) return `https://www.evri.com/track/parcel/${n}`;
  if (c.includes('dhl'))    return `https://www.dhl.com/gb-en/home/tracking.html?tracking-id=${n}`;
  if (c.includes('ups'))    return `https://www.ups.com/track?tracknum=${n}`;
  return null;
}

// "Your order is on its way" — sent once, when the admin marks an order as shipped
async function sendOrderShippedEmail(order, trackingNumber) {
  if (!hasResend) return false;
  try {
    const contacts = await shopContacts();
    const url = trackingNumber ? trackingUrl(order.delivery_carrier, trackingNumber) : null;
    const carrier = String(order.delivery_carrier || 'tracked delivery').replace(/ · Tracking .*$/, '');
    const items = (order.items || []).map(i => `<li style="margin-bottom:6px;">${escEmail(i.product_name)} × ${Number(i.quantity) || 1}${i.variant_label ? `<br><span style="color:#9b8860;font-size:12px;">${escEmail(i.variant_label)}</span>` : ''}</li>`).join('');
    const content = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;border-radius:8px;margin-bottom:22px;"><tr>
        <td style="padding:14px 18px;${F}font-size:14px;color:#555555;line-height:1.8;">
          <strong style="color:#1a1a1a;">Order ${escEmail(order.order_number)}</strong><br>
          Sent with: ${escEmail(carrier)}
          ${trackingNumber ? `<br>Tracking number: <strong style="color:#1a1a1a;">${escEmail(trackingNumber)}</strong>` : ''}
          ${url ? `<div style="margin-top:12px;"><a href="${escEmail(url)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;">Track your parcel</a></div>` : ''}
        </td></tr></table>
      <div style="${F}font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">In this parcel</div>
      <ul style="${F}font-size:14px;color:#1a1a1a;padding-left:18px;margin:0 0 20px;">${items}</ul>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0ede8;border-radius:8px;"><tr>
        <td style="padding:14px 18px;${F}font-size:14px;color:#333333;line-height:1.6;">
          <div style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Delivering to</div>
          <span style="white-space:pre-line;">${escEmail(order.delivery_address)}</span>
        </td></tr></table>`;
    const html = emailLayout({
      preheader: `Order ${order.order_number} has been dispatched${trackingNumber ? ` — tracking ${trackingNumber}` : ''}`,
      heading:   'Your order is on its way',
      intro:     `Hi ${escEmail(order.customer_name)}, good news — your order has been dispatched. Please keep your hair in its sealed packaging until you're happy with it, as unsealed hair can't be returned.`,
      content, contacts,
    });
    const text = [
      'YOUR ORDER IS ON ITS WAY', '',
      `Hi ${order.customer_name}, your order ${order.order_number} has been dispatched with ${carrier}.`,
      trackingNumber ? `Tracking number: ${trackingNumber}${url ? ` — track it here: ${url}` : ''}` : '',
      '', ...(order.items || []).map(i => `- ${i.product_name} x${Number(i.quantity) || 1}`), '',
      'Delivering to:', order.delivery_address, '',
      contactsText(contacts),
    ].join('\n');
    const { error } = await resendClient.emails.send({
      from: EMAIL_FROM, to: [order.customer_email], replyTo: SHOP_EMAIL,
      subject: `Your order ${order.order_number} is on its way | eetashacollection`,
      html, text,
    });
    if (error) throw new Error(error.message || String(error));
    console.log(`  ✅ shipped email sent for ${order.order_number}`);
    return true;
  } catch (err) {
    console.error('  ⚠ Shipped email failed:', err.message);
    return false;
  }
}

// Tells the shop owner about a new order, with everything needed to fulfil it.
async function sendAdminOrderEmail(order, kind = 'paid') {
  if (!hasResend) return;
  try {
    const to = process.env.ADMIN_NOTIFY_EMAIL || 'eetasha.collection@gmail.com';
    const items = (order.items || []).map(i =>
      `<li style="margin-bottom:6px;"><strong>${escEmail(i.product_name)}</strong> × ${i.quantity} — £${(i.price * i.quantity).toFixed(2)}${i.variant_label ? `<br><span style="color:#775a19;">${escEmail(i.variant_label)}</span>` : ''}</li>`).join('');
    const status = kind === 'transfer' ? '⏳ Awaiting bank transfer — check your account before dispatching' : '✅ Paid online';
    const { error } = await resendClient.emails.send({
      from:    EMAIL_FROM,
      to:      [to],
      replyTo: order.customer_email,   // reply goes straight to the customer
      subject: `${kind === 'transfer' ? 'New order (awaiting transfer)' : 'New paid order'} — ${order.order_number} — £${Number(order.total).toFixed(2)}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:560px;">
        <h2 style="margin:0 0 4px;">${escEmail(order.order_number)} · £${Number(order.total).toFixed(2)}</h2>
        <p style="margin:0 0 16px;">${status}</p>
        <ul style="padding-left:18px;margin:0 0 16px;">${items}</ul>
        <p style="margin:0 0 4px;"><strong>${escEmail(order.customer_name)}</strong></p>
        <p style="margin:0 0 4px;">${escEmail(order.customer_email)} · ${escEmail(order.customer_phone)}</p>
        <p style="margin:0 0 4px;white-space:pre-line;">${escEmail(order.delivery_address)}</p>
        <p style="margin:0 0 16px;">Delivery: ${escEmail(order.delivery_carrier || 'Standard')} (£${Number(order.delivery_fee).toFixed(2)})</p>
        <p style="margin:0;"><a href="${siteUrl()}/admin">Open admin dashboard</a></p>
      </div>`,
    });
    if (error) throw new Error(error.message || String(error));
  } catch (err) {
    console.error('  ⚠ Admin email failed:', err.message);
  }
}

// Marks a card order as paid exactly once (called by the Stripe webhook AND the
// success page — whichever comes first sends the emails, the other does nothing).
async function markStripeOrderPaid(sessionId) {
  const { data: rows, error } = await supabase.from('orders')
    .update({ payment_status: 'paid', order_status: 'confirmed' })
    .eq('stripe_session_id', sessionId)
    .neq('payment_status', 'paid')
    .select();
  if (error) throw error;
  for (const order of rows || []) {
    await Promise.all([sendOrderConfirmationEmail(order, 'paid'), sendAdminOrderEmail(order, 'paid')]);
  }
  return (rows || []).length > 0;
}

// ============================================================
//  HELPERS
// ============================================================
function clean(str) { return String(str || '').replace(/[<>]/g, '').trim(); }

// Delivery zones: uk | europe | usa (USA & Canada) | world (Africa & everywhere else).
// A price of null means the service is not offered in that zone.
const DELIVERY_REGIONS = ['uk', 'europe', 'usa', 'world'];
const DEFAULT_DELIVERY_OPTIONS = [
  { id:'uk-tracked',   carrier:'UK Tracked',      service:'Royal Mail / Evri, tracked',       prices:{ uk:4.99, europe:null,  usa:null,  world:null  }, days:{ uk:'2-3 working days' },                                                     minDays:{ uk:2 },                 active:true },
  { id:'uk-nextday',   carrier:'UK Next Day',     service:'Tracked & signed for',             prices:{ uk:9.99, europe:null,  usa:null,  world:null  }, days:{ uk:'Next working day' },                                                     minDays:{ uk:1 },                 active:true },
  { id:'intl-economy', carrier:'Tracked Economy', service:'Royal Mail International Tracked', prices:{ uk:null, europe:19.99, usa:null,  world:null  }, days:{ europe:'5-8 working days' },                                               minDays:{ europe:5 },             active:true },
  { id:'intl-express', carrier:'Express',         service:'DHL / FedEx Express, tracked & insured', prices:{ uk:null, europe:29.99, usa:39.99, world:49.99 }, days:{ europe:'2-4 working days', usa:'2-5 working days', world:'3-7 working days' }, minDays:{ europe:2, usa:2, world:3 }, active:true },
];
// Free UK delivery on the cheapest UK option when the order subtotal reaches this amount
const FREE_UK_DELIVERY_OVER = Number(process.env.FREE_UK_DELIVERY_OVER || 400);
// Optional styling service for wigs (shown to customers, so not secret)
const WIG_STYLING_FEE = Number(process.env.WIG_STYLING_FEE || 10);
const hasPrice = v => typeof v === 'number' && isFinite(v) && v >= 0;
function deliveryOptionsFrom(settings) {
  return settings?.delivery_options?.length ? settings.delivery_options : DEFAULT_DELIVERY_OPTIONS;
}
function cheapestActiveOption(opts, region) {
  return opts.filter(o => o.active && hasPrice(o.prices?.[region])).sort((a, b) => a.prices[region] - b.prices[region])[0] || null;
}
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
// ============================================================
//  STRIPE WEBHOOK  (must be registered before express.json: needs the raw body)
//  Stripe calls this when a card payment succeeds, even if the customer
//  closes the tab before returning to the success page.
// ============================================================
app.post('/api/stripe-webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!hasStripe || !secret) return res.status(503).json({ error: 'Webhook not configured.' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    console.error('Webhook signature check failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  try {
    const sess = event.data.object;
    if ((event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded')
        && sess.payment_status === 'paid') {
      await markStripeOrderPaid(sess.id);
    } else if (event.type === 'checkout.session.expired') {
      await supabase.from('orders').update({ payment_status: 'expired' })
        .eq('stripe_session_id', sess.id).eq('payment_status', 'pending');
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err.message);
    res.status(500).json({ error: 'Webhook handling failed.' });   // Stripe will retry
  }
});

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
      supabase.from('orders').select('total, order_status, payment_method, payment_status'),
      supabase.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    // Revenue = money actually received; "pending" excludes card checkouts that were never paid
    const revenue  = (orders || []).filter(o => o.payment_status === 'paid' && o.order_status !== 'cancelled').reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
    const pending  = (orders || []).filter(o => o.order_status === 'pending' && !(o.payment_method === 'stripe' && o.payment_status !== 'paid')).length;
    const customers = authData?.users?.length || 0;
    res.json({ products: productCount || 0, orders: orderCount || 0, revenue, pending, customers });
  } catch {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ============================================================
//  PRICING FOR "BUILT" PRODUCTS  (prices come from the private Pricing settings)
// ============================================================
let _pricingCache = { at: 0, value: null };
async function getPricing() {
  if (Date.now() - _pricingCache.at < 60 * 1000) return _pricingCache.value;
  const { data, error } = await supabase.from('settings').select('pricing').eq('id', 1).single();
  const value = (!error && data?.pricing) ? Pricing.sanitizePricing(data.pricing) : null;
  _pricingCache = { at: Date.now(), value };
  return value;
}
const isBuilt = p => p?.variants?.variant_type === 'built';
// Price tables are cached per product + settings, so the shop stays fast
const _tableCache = new Map();
function priceTableFor(product, pricing) {
  if (!pricing || !isBuilt(product)) return null;
  const key = `${product.id}:${_pricingCache.at}:${JSON.stringify(product.variants)}`;
  if (!_tableCache.has(key)) {
    if (_tableCache.size > 500) _tableCache.clear();
    _tableCache.set(key, Pricing.buildPriceTable(pricing, product.variants));
  }
  return _tableCache.get(key);
}
// What customers receive: built products get "from" prices; old price tables are not needed by the shop
// Prices are sent as normal; `details.salePercent` tells the shop to show them reduced
// (Pricing.applySale), and the order route applies exactly the same reduction.
function publicProduct(p, pricing) {
  p = { ...p, details: cleanDetails(p.details) };
  if (!isBuilt(p)) return p;
  const t = priceTableFor(p, pricing);
  const { legacy, ...variants } = Pricing.sanitizeBuiltConfig(p.variants, pricing || Pricing.DEFAULT_PRICING);
  return { ...p, variants, fromPrice: t?.fromPrice ?? null, maxPrice: t?.maxPrice ?? null };
}
// Per-product extras: sale % and dispatch time ("ready to ship" / "made to order")
function cleanDetails(d) {
  const o = d && typeof d === 'object' ? d : {};
  const out = {};
  const pct = Pricing.salePercentOf(o);
  if (pct) out.salePercent = pct;
  if (o.dispatch === 'ready' || o.dispatch === 'made') out.dispatch = o.dispatch;
  const days = clean(String(o.madeDays || '')).slice(0, 20);
  if (days) out.madeDays = days;
  return out;
}
// The `details` column is added by supabase-shop-extras-migration.sql. Until that has been run,
// products still save (without the extras) and the admin is told what to do.
const isMissingColumn = (err, col) => !!err && (err.code === '42703' || err.code === 'PGRST204') && new RegExp(col, 'i').test(err.message || '');
const EXTRAS_MIGRATION_MSG = 'Saved — but the sale and dispatch settings need a one-time database update first: run supabase-shop-extras-migration.sql in the Supabase SQL Editor.';
async function saveProductRow(row, id) {
  const run = r => (id ? supabase.from('products').update(r).eq('id', id) : supabase.from('products').insert(r)).select().single();
  let { data, error } = await run(row);
  if (error && 'details' in row && isMissingColumn(error, 'details')) {
    const { details, ...rest } = row;
    ({ data, error } = await run(rest));
    if (!error && data) data = { ...data, _notice: EXTRAS_MIGRATION_MSG };
  }
  return { data, error };
}
// Clean the options an admin saves for a product; built products get their price set to the "from" price
async function normaliseVariants(variants, fallbackPrice) {
  if (!variants || typeof variants !== 'object') return { variants: null, price: fallbackPrice };
  if (variants.variant_type !== 'built') return { variants, price: fallbackPrice };
  const pricing = await getPricing();
  const cfg = Pricing.sanitizeBuiltConfig(variants, pricing || Pricing.DEFAULT_PRICING);
  const t = pricing ? Pricing.buildPriceTable(pricing, cfg) : null;
  return { variants: cfg, price: t?.fromPrice || fallbackPrice };
}

// ============================================================
//  PRODUCTS
// ============================================================
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const pricing = (data || []).some(isBuilt) ? await getPricing() : null;
    res.json((data || []).map(p => publicProduct(p, pricing)));
  } catch {
    res.status(500).json({ error: 'Failed to load products.' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Product not found.' });
    res.json(publicProduct(data, isBuilt(data) ? await getPricing() : null));
  } catch {
    res.status(404).json({ error: 'Product not found.' });
  }
});

// Every selling price for a built product (no costs) — used by the option picker
app.get('/api/products/:id/prices', async (req, res) => {
  try {
    const { data: p } = await supabase.from('products').select('id, variants').eq('id', req.params.id).single();
    if (!p || !isBuilt(p)) return res.status(404).json({ error: 'No price list for this product.' });
    const table = priceTableFor(p, await getPricing());
    if (!table) return res.status(503).json({ error: 'Prices are being updated — please try again shortly.' });
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60');
    res.json(table);
  } catch {
    res.status(500).json({ error: 'Failed to load prices.' });
  }
});

// Admin: the full saved product, including the backup of its old price table
app.get('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch {
    res.status(500).json({ error: 'Failed to load products.' });
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
    const norm = await normaliseVariants(req.body.variants, parseFloat(price));
    const row = {
      name: clean(name), price: norm.price, category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
      variants: norm.variants,
    };
    if (req.body.details !== undefined) row.details = cleanDetails(req.body.details);
    const { data, error } = await saveProductRow(row);
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
    const norm = await normaliseVariants(req.body.variants, parseFloat(price));
    const row = {
      name: clean(name), price: norm.price, category: clean(category),
      image_url: clean(image_url || ''), description: clean(description || ''),
      in_stock: !!in_stock, featured: !!featured,
      variants: norm.variants,
    };
    // Only touch the extras when the admin form sends them (bulk price switches leave them alone)
    if (req.body.details !== undefined) row.details = cleanDetails(req.body.details);
    const { data, error } = await saveProductRow(row, req.params.id);
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
  // New orders are paid online through Stripe only (older bank-transfer orders can still be marked paid in the admin)
  body('paymentMethod').equals('stripe').withMessage('Please refresh the page and try again.'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const { customerName, customerEmail, customerPhone, deliveryAddress, items, paymentMethod, deliveryCarrierId, deliveryRegion } = req.body;

    const { data: settings } = await supabase.from('settings').select('delivery_options').eq('id', 1).single();

    // Compute prices from DB — NEVER trust client-sent prices
    let subtotal   = 0;
    const orderItems = [];
    for (const item of items) {
      const { data: product } = await supabase.from('products').select('*').eq('id', item.productId).single();
      if (!product) return res.status(400).json({ error: 'One or more products were not found.' });
      if (!product.in_stock) return res.status(400).json({ error: `"${product.name}" is out of stock — coming back soon.` });
      const qty = parseInt(item.qty);
      const salePct = Pricing.salePercentOf(product.details);
      const saleNote = salePct ? ` · ${salePct}% off` : '';

      // Products priced from the Pricing settings: work out the price and description here
      if (isBuilt(product)) {
        const pricing = await getPricing();
        const choice  = Pricing.parseBuiltKey(item.variantKey);
        if (!pricing || !choice) return res.status(400).json({ error: `Please select options for "${product.name}".` });
        const q = Pricing.quoteBuilt(pricing, product.variants, choice);
        if (q.error) return res.status(400).json({ error: `"${product.name}": ${q.error} Please remove it from your bag and choose again.` });
        const price = Pricing.applySale(q.price, salePct);
        subtotal += price * qty;
        orderItems.push({
          product_id: product.id, product_name: product.name,
          price, quantity: qty,
          variant: String(item.variantKey), variant_label: q.label + saleNote,
        });
        continue;
      }

      // Optional wig styling is encoded on the cart line as "<variantKey>|styled"
      const rawKey  = item.variantKey ? String(item.variantKey) : null;
      const styled  = !!rawKey && rawKey.endsWith('|styled');
      const baseKey = styled ? rawKey.slice(0, -'|styled'.length) : rawKey;
      const vtype   = product.variants?.variant_type;
      if (styled && vtype !== 'wig' && vtype !== 'big-wig') return res.status(400).json({ error: `Styling is only available on wigs.` });

      // Variant price validation
      let unitPrice;
      if (product.variants?.enabled) {
        if (!baseKey) return res.status(400).json({ error: `Please select options for "${product.name}".` });
        unitPrice = product.variants.prices?.[baseKey];
        if (unitPrice === undefined) return res.status(400).json({ error: `Invalid option selected for "${product.name}".` });
        if (product.variants.unavailable?.includes(baseKey)) return res.status(400).json({ error: `Selected option for "${product.name}" is unavailable.` });
      } else {
        unitPrice = product.price;
      }
      // The sale reduces the hair price; the styling fee stays the same
      unitPrice = Pricing.applySale(unitPrice, salePct) + (styled ? WIG_STYLING_FEE : 0);

      subtotal += unitPrice * qty;
      const label = item.variantLabel ? clean(item.variantLabel) : '';
      orderItems.push({
        product_id: product.id, product_name: product.name,
        price: unitPrice, quantity: qty,
        variant: rawKey, variant_label: (label + saleNote).replace(/^ · /, '') || null,
      });
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Delivery: the price for the chosen option in the chosen zone (same list the delivery page shows)
    const opts    = deliveryOptionsFrom(settings);
    const region  = DELIVERY_REGIONS.includes(deliveryRegion) ? deliveryRegion : null;
    const carrier = region && opts.find(o => o.id === deliveryCarrierId && o.active && hasPrice(o.prices?.[region]));
    if (!carrier) return res.status(400).json({ error: 'Please go back and choose a delivery option for your country.' });
    let deliveryFee     = carrier.prices[region];
    let deliveryCarrier = `${carrier.carrier} – ${carrier.service} (${region.toUpperCase()})`;
    if (region === 'uk' && subtotal >= FREE_UK_DELIVERY_OVER && cheapestActiveOption(opts, 'uk')?.id === carrier.id) {
      deliveryFee = 0;
      deliveryCarrier += ` – FREE over £${FREE_UK_DELIVERY_OVER}`;
    }

    const total = Math.round((subtotal + deliveryFee) * 100) / 100;

    // Order number = highest existing number + 1. If two customers check out at the
    // same moment, the UNIQUE constraint rejects the duplicate and we try the next one.
    const { data: latest } = await supabase.from('orders').select('order_number')
      .like('order_number', 'ORD-%').order('order_number', { ascending: false }).limit(1);
    let nextNum = Math.max(1001, (parseInt(String(latest?.[0]?.order_number || '').replace(/\D/g, ''), 10) || 1000) + 1);

    let order, error;
    for (let attempt = 0; attempt < 5; attempt++) {
      ({ data: order, error } = await supabase.from('orders').insert({
        order_number:     'ORD-' + String(nextNum).padStart(5, '0'),
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
      }).select().single());
      if (!error || error.code !== '23505') break;   // 23505 = duplicate order number
      nextNum++;
    }
    if (error) throw error;

    // Card orders are emailed only once Stripe confirms payment (see markStripeOrderPaid).
    // Bank-transfer orders get the transfer details now. Awaited so serverless
    // hosting doesn't freeze the function before the email is sent.
    if (paymentMethod === 'transfer') {
      await Promise.all([sendOrderConfirmationEmail(order, 'transfer'), sendAdminOrderEmail(order, 'transfer')]);
    }

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
  body('trackingNumber').optional({ nullable: true }).isString().isLength({ max: 60 }).withMessage('Tracking number is too long'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const status = req.body.status;
    const { data: before } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
    if (!before) return res.status(404).json({ error: 'Order not found.' });
    const updates = { order_status: status };
    // The tracking number is kept on the order's delivery line, so it shows in the admin too
    const tracking = clean(req.body.trackingNumber || '').replace(/[^\w\- ]/g, '').trim();
    if (status === 'shipped' && tracking && !String(before.delivery_carrier || '').includes(tracking)) {
      updates.delivery_carrier = `${before.delivery_carrier || 'Delivery'} · Tracking ${tracking}`;
    }
    // Only the change TO shipped emails the customer (choosing "shipped" again doesn't resend)
    const { data: rows, error } = await supabase.from('orders').update(updates)
      .eq('id', req.params.id).select();
    if (error || !rows?.length) return res.status(404).json({ error: 'Order not found.' });
    let emailed = false;
    if (status === 'shipped' && before.order_status !== 'shipped' && before.customer_email) {
      emailed = await sendOrderShippedEmail(rows[0], tracking || null);
    }
    res.json({ ok: true, emailed });
  } catch {
    res.status(404).json({ error: 'Order not found.' });
  }
});

// Admin confirms a bank transfer has arrived → order is confirmed and the customer is emailed.
app.put('/api/orders/:id/payment', requireAdmin, [
  body('status').isIn(['paid', 'pending']).withMessage('Invalid payment status'),
], async (req, res) => {
  if (!valid(req, res)) return;
  try {
    const paid = req.body.status === 'paid';
    let q = supabase.from('orders')
      .update({ payment_status: paid ? 'paid' : 'pending' })
      .eq('id', req.params.id).eq('payment_method', 'transfer');
    q = paid ? q.neq('payment_status', 'paid') : q.eq('payment_status', 'paid');
    const { data: rows, error } = await q.select();
    if (error) throw error;
    if (paid && rows?.length) {
      // Move a still-pending order to confirmed (don't touch one already shipped)
      await supabase.from('orders').update({ order_status: 'confirmed' }).eq('id', req.params.id).eq('order_status', 'pending');
      await sendOrderConfirmationEmail(rows[0], 'paid');
    }
    res.json({ ok: true, changed: rows?.length || 0 });
  } catch {
    res.status(500).json({ error: 'Failed to update payment.' });
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
      whatsapp:        WHATSAPP_ON ? data.whatsapp : '',   // old number not sent to the site while WhatsApp is off
      instagram:       data.instagram,
      email:           data.email,
      bankName:        data.bank_name,
      sortCode:        data.sort_code,
      accountNumber:   data.account_number,
      accountName:     data.account_name,
      currency:        data.currency,
      deliveryFee:     data.delivery_fee,
      deliveryOptions: deliveryOptionsFrom(data),
      freeUkDeliveryOver: FREE_UK_DELIVERY_OVER,
      wigStylingFee:   WIG_STYLING_FEE,
      payInThree:      !!data.shop_options?.payInThree,
      clearpay:        !!data.shop_options?.clearpay,
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
    if (req.body.deliveryOptions !== undefined) {
      if (!Array.isArray(req.body.deliveryOptions)) return res.status(400).json({ error: 'Invalid delivery options.' });
      const str = (v, max) => clean(String(v ?? '')).slice(0, max);
      updates['delivery_options'] = req.body.deliveryOptions.slice(0, 30).map(o => ({
        id:      str(o.id, 40) || crypto.randomBytes(4).toString('hex'),
        carrier: str(o.carrier, 60),
        service: str(o.service, 80),
        prices:  Object.fromEntries(DELIVERY_REGIONS.map(r => {
          const n = o.prices?.[r];
          return [r, (n === null || n === '' || n === undefined || !isFinite(Number(n))) ? null : Math.max(0, Math.round(Number(n) * 100) / 100)];
        })),
        days:    Object.fromEntries(DELIVERY_REGIONS.filter(r => o.days?.[r]).map(r => [r, str(o.days[r], 40)])),
        minDays: Object.fromEntries(DELIVERY_REGIONS.filter(r => isFinite(Number(o.minDays?.[r]))).map(r => [r, Number(o.minDays[r])])),
        active:  !!o.active,
      }));
    }
    if (Object.keys(updates).length) await supabase.from('settings').update(updates).eq('id', 1);
    // Saved on its own so the other settings still save before the database update has been run
    let notice;
    if (req.body.payInThree !== undefined || req.body.clearpay !== undefined) {
      const { error } = await supabase.from('settings').update({ shop_options: { payInThree: !!req.body.payInThree, clearpay: !!req.body.clearpay } }).eq('id', 1);
      if (isMissingColumn(error, 'shop_options')) notice = 'Saved — but Klarna / Clearpay need a one-time database update first: run supabase-shop-extras-migration.sql in the Supabase SQL Editor.';
    }
    res.json({ ok: true, notice });
  } catch {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// ============================================================
//  PRICING  (supplier costs — ADMIN ONLY, never sent to customers)
// ============================================================
const PRICING_MIGRATION_MSG = 'The database needs a one-time update before prices can be saved: run supabase-pricing-migration.sql in the Supabase SQL Editor.';
const isMissingPricingColumn = err => !!err && (err.code === '42703' || err.code === 'PGRST204' || /pricing/i.test(err.message || ''));

app.get('/api/admin/pricing', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('pricing').eq('id', 1).single();
    if (isMissingPricingColumn(error)) return res.json({ pricing: Pricing.DEFAULT_PRICING, saved: false, needsMigration: true });
    if (error) throw error;
    res.json({ pricing: Pricing.sanitizePricing(data?.pricing || Pricing.DEFAULT_PRICING), saved: !!data?.pricing, needsMigration: false });
  } catch (err) {
    console.error('Pricing load error:', err.message);
    res.status(500).json({ error: 'Failed to load pricing.' });
  }
});

app.put('/api/admin/pricing', requireAdmin, async (req, res) => {
  try {
    const clean = Pricing.sanitizePricing(req.body?.pricing);
    const { error } = await supabase.from('settings').update({ pricing: clean }).eq('id', 1);
    if (isMissingPricingColumn(error)) return res.status(409).json({ error: PRICING_MIGRATION_MSG, needsMigration: true });
    if (error) throw error;
    _pricingCache = { at: Date.now(), value: clean };   // new prices take effect straight away
    res.json({ ok: true, pricing: clean });
  } catch (err) {
    console.error('Pricing save error:', err.message);
    res.status(500).json({ error: 'Failed to save pricing.' });
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
      price_data: { currency: 'gbp', product_data: { name: (i.variant_label ? `${i.product_name} — ${i.variant_label}` : i.product_name).slice(0, 250) }, unit_amount: Math.round(i.price * 100) },
      quantity: i.quantity,
    }));
    if (order.delivery_fee > 0) {
      lineItems.push({
        price_data: { currency: 'gbp', product_data: { name: 'Delivery' }, unit_amount: Math.round(order.delivery_fee * 100) },
        quantity: 1,
      });
    }

    const sessionFor = (methods, shipping) => stripe.checkout.sessions.create({
      payment_method_types: methods,
      line_items:           lineItems,
      mode:                 'payment',
      success_url: `${origin}/checkout-success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
      cancel_url:  `${origin}/checkout`,
      customer_email: order.customer_email,
      metadata: { orderId: order.id, orderNumber: order.order_number },
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,   // abandoned checkouts expire after 1 hour
      ...(shipping ? { payment_intent_data: { shipping } } : {}),
    });
    // Payment options on Stripe's page:
    //  - card (Apple Pay and Google Pay come with it automatically)
    //  - Revolut Pay, Amazon Pay: shown when switched on in the Stripe dashboard
    //  - Klarna ("Pay in 3") and Clearpay ("Pay in 4", UK only, needs the address): only when
    //    switched on in the admin AND in Stripe
    // If Stripe refuses one (e.g. not switched on there), we drop just that one and try again,
    // so the others still show and card always works.
    const { data: shopSettings } = await supabase.from('settings').select('*').eq('id', 1).single();
    const opts = shopSettings?.shop_options || {};
    const clearpayShipping = opts.clearpay ? ukShippingFor(order) : null;
    let methods = ['card', 'revolut_pay', 'amazon_pay',   // add 'paypal' here once PayPal is connected in Stripe
      ...(opts.payInThree ? ['klarna'] : []), ...(clearpayShipping ? ['afterpay_clearpay'] : [])];
    let sess;
    for (let attempt = 0; attempt < 8 && !sess; attempt++) {
      try {
        sess = await sessionFor(methods, methods.includes('afterpay_clearpay') ? clearpayShipping : null);
      } catch (err) {
        const refused = methods.find(m => m !== 'card' && (err.message || '').includes(m));
        console.error(`Payment option not available${refused ? ` (${refused})` : ''}:`, err.message);
        if (refused) methods = methods.filter(m => m !== refused);
        else if (methods.length > 1) methods = ['card'];   // unclear which one: fall back to card only
        else throw err;
      }
    }
    if (!sess) sess = await sessionFor(['card']);

    await supabase.from('orders').update({ stripe_session_id: sess.id }).eq('id', orderId);
    res.json({ url: sess.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Card payment could not be started. Please try again or choose bank transfer.' });
  }
});

// Clearpay only works for UK customers and needs the delivery address on the payment.
// The checkout has one free-text address box, so we take the first line and the postcode from it.
function ukShippingFor(order) {
  if (!/\(UK\)/.test(order.delivery_carrier || '')) return null;
  const text = String(order.delivery_address || '').trim();
  const postcode = (text.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i) || []);
  if (!postcode[0]) return null;
  const lines = text.split(/\n|,/).map(s => s.trim()).filter(Boolean);
  const rest = lines.slice(1).filter(l => l.toUpperCase() !== postcode[0].toUpperCase()).join(', ').replace(postcode[0], '').replace(/[,\s]+$/, '');
  return {
    name: String(order.customer_name || '').slice(0, 100),
    phone: String(order.customer_phone || '').slice(0, 20) || undefined,
    address: {
      line1: (lines[0] || text).slice(0, 200),
      line2: rest.slice(0, 200) || undefined,
      postal_code: `${postcode[1]} ${postcode[2]}`.toUpperCase(),
      country: 'GB',
    },
  };
}

app.get('/api/verify-payment/:sessionId', async (req, res) => {
  if (!hasStripe) return res.json({ paid: false });
  try {
    const sess = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (sess.payment_status === 'paid') await markStripeOrderPaid(sess.id);
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
// Lowest / highest price a customer pays (after any sale), plus the pre-sale "from" price
function priceInfo(p) {
  const base = (() => {
    if (isBuilt(p)) {
      if (p.fromPrice) return { low: Number(p.fromPrice), high: Number(p.maxPrice || p.fromPrice), hasRange: true };
      return { low: Number(p.price), high: Number(p.price), hasRange: true };
    }
    const v = p.variants;
    if (v?.enabled && v.prices && Object.keys(v.prices).length) {
      const unavailable = new Set(v.unavailable || []);
      const vals = Object.entries(v.prices).filter(([k]) => !unavailable.has(k)).map(([, x]) => Number(x)).filter(x => x > 0);
      if (vals.length) return { low: Math.min(...vals), high: Math.max(...vals), hasRange: true };
    }
    return { low: Number(p.price), high: Number(p.price), hasRange: false };
  })();
  const pct = Pricing.salePercentOf(p.details);
  return { ...base, low: Pricing.applySale(base.low, pct), high: Pricing.applySale(base.high, pct), wasLow: pct ? base.low : null, pct };
}
// "Or pay in instalments" line — must match payInThreeHTML() in js/app.js
function payLaterText(o) {
  const k = !!o?.payInThree, c = !!o?.clearpay;
  if (k && c) return 'Or pay in interest-free instalments with Klarna (3) or Clearpay (4, UK)';
  if (k) return 'Or pay in 3 interest-free instalments with Klarna';
  if (c) return 'Or pay in 4 interest-free instalments with Clearpay (UK)';
  return '';
}
// "Ready to ship" / "Made to order" line. Units made into wigs default to made to order.
function dispatchInfo(p) {
  const d = p.details || {};
  const mode = d.dispatch || (isBuilt(p) && p.variants?.kind === 'unit' ? 'made' : null);
  if (mode === 'ready') return { mode, title: 'Ready to ship', text: 'Dispatched in 1–2 working days' };
  if (mode === 'made')  return { mode, title: 'Made to order', text: `Dispatched in ${d.madeDays || '5–10'} working days` };
  return null;
}

// Fold-out guides on every product page (plain HTML, so Google can read them too)
const PRODUCT_GUIDES_HTML = `
  <div class="pd-guides" id="guides">
    <details>
      <summary>Length guide</summary>
      <p>Lengths are measured with the hair pulled straight. Wavy and curly hair looks shorter than straight hair of the same length.</p>
      <table class="pd-guide-table">
        <tr><td>10–12"</td><td>Chin to neck</td></tr>
        <tr><td>14–16"</td><td>Shoulders to collarbone</td></tr>
        <tr><td>18–20"</td><td>Chest to bra strap</td></tr>
        <tr><td>22–24"</td><td>Mid-back</td></tr>
        <tr><td>26–30"</td><td>Lower back to waist</td></tr>
      </table>
    </details>
    <details>
      <summary>How many bundles do I need?</summary>
      <p>Each bundle weighs about 100g.</p>
      <ul><li>Up to 16": 3 bundles</li><li>18–22": 3–4 bundles</li><li>24" and longer: 4–5 bundles for a full look</li></ul>
      <p>Not sure? Message us and we'll help you choose.</p>
    </details>
    <details>
      <summary>Closure or frontal? HD or transparent lace?</summary>
      <p><strong>Closure</strong> (4x4, 5x5, 2x6): covers the parting area only. It's easier to look after and good for a middle or side part.</p>
      <p><strong>Frontal</strong> (13x4, 13x6): lace from ear to ear, so you can part your hair anywhere and wear it pulled back. 13x6 gives a deeper parting space.</p>
      <p><strong>HD lace</strong> is very thin and melts into all skin tones, but needs gentle handling. <strong>Transparent lace</strong> is a little stronger and suits light to medium skin tones.</p>
    </details>
    <details>
      <summary>Cap size guide</summary>
      <p>Measure around your head along your hairline: from your forehead, above your ears, around the back of your neck and back to the front.</p>
      <table class="pd-guide-table">
        <tr><td>Small</td><td>21"</td></tr>
        <tr><td>Medium</td><td>22" (most people)</td></tr>
        <tr><td>Large</td><td>23"</td></tr>
      </table>
      <p>If you're unsure, choose Medium, or message us your measurement.</p>
    </details>
    <details>
      <summary>Delivery</summary>
      <p>Tracked delivery in the UK (free on orders over £400, next-day available) and tracked express delivery to Europe, the USA and worldwide. Wigs made, coloured or styled for you are made to order. <a href="/delivery">Delivery prices and times</a></p>
    </details>
    <details>
      <summary>Returns</summary>
      <p>For hygiene reasons, worn hair and wigs made to your order can't be returned. Unworn items with the tag and hygiene seal still on can be returned within 14 days of delivery. <a href="/returns">Read the full returns policy</a></p>
    </details>
  </div>`;
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
  .pd-stock span { font-weight: 500; color: var(--gray-500); }
  .pd-guides { margin-top: 24px; border-top: 1px solid var(--gray-200); }
  .pd-guides details { border-bottom: 1px solid var(--gray-200); }
  .pd-guides summary { cursor: pointer; padding: 14px 0; font-weight: 600; font-size: 0.9rem; list-style: none; display: flex; justify-content: space-between; align-items: center; }
  .pd-guides summary::-webkit-details-marker { display: none; }
  .pd-guides summary::after { content: '+'; font-size: 1.2rem; color: var(--gold-dark); }
  .pd-guides details[open] summary::after { content: '−'; }
  .pd-guides p, .pd-guides li { font-size: 0.86rem; color: var(--gray-600); line-height: 1.7; margin-bottom: 10px; }
  .pd-guides ul { padding-left: 18px; margin-bottom: 10px; list-style: disc; }
  .pd-guides a { color: var(--gold-dark); text-decoration: underline; }
  .pd-guide-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 0.86rem; }
  .pd-guide-table td { padding: 7px 0; border-bottom: 1px solid var(--gray-100); color: var(--gray-600); }
  .pd-guide-table td:first-child { font-weight: 600; color: var(--gray-800, #333); width: 40%; }
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
    const { data: raw } = await supabase.from('products').select('*').eq('id', m[1].toLowerCase()).single();
    const p = raw ? publicProduct(raw, isBuilt(raw) ? await getPricing() : null) : null;
    if (!p) return notFound();
    const canonicalPath = productPath(p);
    if (req.path !== canonicalPath) return res.redirect(301, canonicalPath);

    const canonical = SITE_URL + canonicalPath;
    const desc      = productDescription(p);
    const image     = p.image_url || OG_IMAGE;
    const price     = priceInfo(p);
    const money     = n => `£${Number(n).toFixed(2)}`;
    const availability = p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
    const dispatch     = dispatchInfo(p);
    const { data: shopSettings } = await supabase.from('settings').select('*').eq('id', 1).single();
    const payLater     = payLaterText(shopSettings?.shop_options);

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
        <div class="pd-img"><img src="${escHtml(p.image_url || '/images/placeholder.svg')}" alt="${escHtml(p.name)}" onerror="this.onerror=null;this.src='/images/placeholder.svg'"></div>
        <div class="pd-info">
          <div class="product-card-category">${escHtml(p.category || 'Hair')}</div>
          <h1 class="serif">${escHtml(p.name)}</h1>
          <div class="pd-price">${price.hasRange ? `<small>from </small>` : ''}${money(price.low)}${price.pct ? ` <s class="price-was">${money(price.wasLow)}</s> <span class="sale-badge">${price.pct}% off</span>` : ''}</div>
          ${payLater && p.in_stock ? `<p class="pay-in-3">${payLater}</p>` : ''}
          <p class="pd-stock ${p.in_stock ? 'in' : 'out'}">${!p.in_stock ? 'Out of stock – coming back soon' : dispatch ? `${dispatch.title} · <span>${escHtml(dispatch.text)}</span>` : 'In stock'}</p>
          <div class="pd-desc">${escHtml(desc)}</div>
          <div id="pdAction"><a href="/shop" class="btn btn-primary">Shop the collection</a></div>
          <ul class="pd-perks">
            <li><span class="material-symbols-outlined">local_shipping</span>Tracked UK &amp; worldwide delivery</li>
            <li><span class="material-symbols-outlined">verified</span>Premium quality hair, carefully selected</li>
            <li><span class="material-symbols-outlined">support_agent</span>Personal help by email &amp; Instagram</li>
          </ul>
          ${PRODUCT_GUIDES_HTML}
          <div id="pdSocial" style="margin-top:24px;"></div>
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
      document.getElementById('pdSocial').innerHTML = socialCtaHTML({ productName: p?.name || document.querySelector('h1')?.textContent || '' });
      if (p) {
        const hasVariants = p.variants?.variant_type === 'built' || (p.variants?.enabled && p.variants?.prices && Object.keys(p.variants.prices).length > 0);
        if (!p.in_stock)              box.innerHTML = '<button class="btn btn-secondary" disabled>Out of stock – coming back soon</button>';
        else if (hasVariants)         box.innerHTML = '<button class="btn btn-primary" id="pdBtn">Select Options</button>';
        else                          box.innerHTML = '<button class="btn btn-primary" id="pdBtn">Add to Bag</button>';
        document.getElementById('pdBtn')?.addEventListener('click', () => {
          if (hasVariants) openVariantModal(p.id);
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
      { loc: `${SITE_URL}/returns`,               priority: '0.3' },
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
