import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { nextOrderNumber } from '../../db/counters.js';
import { priceCart, DEFAULT_SETTINGS } from '../pricing/pricing.js';
import { sanitizeAttribution, hasMarketingConsent } from '../tracking/attribution.js';
import { planAdvance, DEFAULT_ADVANCE } from './advance.js';

export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const bad = (message) => new AppError(400, 'INVALID_INPUT', message);
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export const validateCustomer = (c = {}) => {
  const out = {
    name: text(c.name || `${c.firstName || ''} ${c.lastName || ''}`, 120),
    email: text(c.email, 200).toLowerCase(),
    phone: text(c.phone, 20).replace(/[^\d+]/g, ''),
    street: text(c.street, 200), apartment: text(c.apartment, 200), landmark: text(c.landmark, 200),
    city: text(c.city, 80), state: text(c.state, 80), pincode: text(c.pincode, 6), country: 'India'
  };
  if (!out.name) throw bad('Name is required.');
  if (!EMAIL.test(out.email)) throw bad('A valid email is required.');
  if (!/^(\+91)?[6-9]\d{9}$/.test(out.phone)) throw bad('A valid 10-digit Indian mobile number is required.');
  if (!out.street || !out.city || !out.state) throw bad('Full delivery address is required.');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) throw bad('A valid 6-digit pincode is required.');
  return out;
};

const rollback = async (db, demanded, couponCode) => {
  for (const [id, qty] of demanded) await db.collection('products').updateOne({ id }, { $inc: { stock: qty } });
  if (couponCode) await db.collection('coupons').updateOne({ code: couponCode }, { $inc: { usedCount: -1 } });
};

export const createOrder = async ({ db, input = {}, user = null, client = {}, settings = DEFAULT_SETTINGS, shippingQuote = null, advanceConfig = DEFAULT_ADVANCE, now = new Date() }) => {
  const customer = validateCustomer(input.customer);
  const requested = Array.isArray(input.items) ? input.items : [];
  const ids = [...new Set(requested.map((i) => String(i?.productId ?? i?.id ?? '')))];
  const products = await db.collection('products').find({ id: { $in: ids } }).toArray();

  let coupon = null;
  const code = text(input.couponCode, 40).toUpperCase();
  if (code) {
    coupon = await db.collection('coupons').findOne({ code });
    if (coupon?.perUserLimit != null) {
      const used = await db.collection('orders').countDocuments({ couponCode: code, customerEmail: customer.email, status: { $in: ['pending_payment', 'confirmed', 'completed'] } });
      if (used >= coupon.perUserLimit) throw new AppError(400, 'COUPON_USED', 'You have already used this coupon.');
    }
  }

  if (shippingQuote?.serviceable === false) throw new AppError(400, 'DELIVERY_UNAVAILABLE', 'Sorry, we cannot deliver to this pincode yet.');
  const priced = priceCart({ products, items: requested, coupon, settings, shippingQuotePaise: shippingQuote?.ratePaise ?? null, now });

  // Part payment is optional and only for custom or bulk orders; the amount is always computed here.
  const wantsAdvance = input.paymentPlan === 'advance';
  const advance = planAdvance({ lines: priced.lines, totalPaise: priced.totalPaise, cfg: advanceConfig });
  if (wantsAdvance && !advance.eligible) throw new AppError(400, 'ADVANCE_NOT_AVAILABLE', 'Part payment is available for custom and bulk orders above the minimum order value.');

  // Reserve stock atomically per product; undo everything if any line cannot be reserved.
  const reserved = new Map();
  for (const [id, qty] of priced.demanded) {
    const r = await db.collection('products').updateOne({ id, stock: { $gte: qty } }, { $inc: { stock: -qty } });
    if (!r.modifiedCount) { await rollback(db, reserved); throw new AppError(409, 'OUT_OF_STOCK', 'An item just went out of stock.'); }
    reserved.set(id, qty);
  }
  let redeemed = null;
  if (coupon) {
    const filter = coupon.usageLimit != null ? { code: coupon.code, usedCount: { $lt: coupon.usageLimit } } : { code: coupon.code };
    const r = await db.collection('coupons').updateOne(filter, { $inc: { usedCount: 1 } });
    if (!r.modifiedCount) { await rollback(db, reserved); throw new AppError(400, 'COUPON_EXHAUSTED', 'Coupon usage limit reached.'); }
    redeemed = coupon.code;
  }

  try {
    const number = await nextOrderNumber(db, now);
    const order = {
      _id: crypto.randomUUID(), id: number, number,
      userId: user?.sub || '', customerEmail: customer.email, customer,
      items: priced.lines,
      subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise,
      shippingPaise: priced.shippingPaise, shippingQuote: shippingQuote ? { courier: shippingQuote.courier, ratePaise: shippingQuote.ratePaise } : null, totalPaise: priced.totalPaise, currency: 'INR',
      couponCode: priced.couponCode,
      paymentPlan: wantsAdvance ? 'advance' : 'full',
      advancePaise: wantsAdvance ? advance.advancePaise : priced.totalPaise, balancePaise: wantsAdvance ? advance.balancePaise : 0,
      status: 'pending_payment', paymentStatus: 'pending', productionStatus: 'awaiting-approval',
      shippingStatus: 'pending',
      // Orders with customer photos need a design preview and approval before production.
      customPreviewStatus: priced.lines.some((l) => Array.isArray(l.options?.photos) && l.options.photos.length) ? 'pending' : 'not-required',
      revisionCount: 0, refundedPaise: 0, refundReservedPaise: 0, photosPurgedAt: null,
      courierName: '', trackingNumber: '', trackingUrl: '', estimatedDelivery: '',
      // 192-bit unguessable tracking token, revocable by clearing/replacing it.
      guestToken: crypto.randomBytes(24).toString('hex'),
      // Campaign attribution and the buyer's marketing-cookie choice, frozen at checkout. IP and user agent are
      // kept only when consent was given, for Meta server events.
      attribution: sanitizeAttribution(input.attribution),
      marketingConsent: hasMarketingConsent(input),
      clientIp: hasMarketingConsent(input) ? String(client.ip || '').slice(0, 64) : '',
      clientUserAgent: hasMarketingConsent(input) ? String(client.userAgent || '').slice(0, 300) : '',
      razorpayOrderId: null, paymentReference: null, balanceRazorpayOrderId: null, balancePaymentId: null, balanceRequestedAt: null, balanceReminders: 0,
      stockReserved: true,
      statusHistory: [{ status: 'pending_payment', at: now.toISOString() }],
      createdAt: now, expiresAt: new Date(now.getTime() + PAYMENT_WINDOW_MS)
    };
    await db.collection('orders').insertOne(order);
    return order;
  } catch (err) {
    await rollback(db, reserved, redeemed);
    throw err;
  }
};

// Unpaid orders past their window are expired, and stock and coupon usage are released exactly once.
export const expireStaleOrders = async ({ db, now = new Date(), onExpired }) => {
  const stale = await db.collection('orders').find({ status: 'pending_payment', paymentStatus: { $in: ['pending', 'failed'] }, expiresAt: { $lte: now } }).toArray();
  let expired = 0;
  for (const o of stale) {
    const r = await db.collection('orders').updateOne(
      { _id: o._id, status: 'pending_payment', paymentStatus: { $in: ['pending', 'failed'] } },
      { $set: { status: 'expired', stockReserved: false }, $push: { statusHistory: { status: 'expired', at: now.toISOString() } } }
    );
    if (!r.modifiedCount) continue;
    const demanded = new Map(o.items.map((l) => [l.productId, l.quantity]));
    await rollback(db, demanded, o.couponCode);
    expired += 1;
    if (onExpired) { try { await onExpired(o); } catch { /* reminders must never break expiry */ } }
  }
  return expired;
};

// Shapes a stored order into the field names the storefront already reads. Money in rupees for display.
const rupees = (p) => p / 100;
const planFields = (o) => ({
  payment_plan: o.paymentPlan || 'full',
  advance_amount: rupees(o.advancePaise ?? o.totalPaise), balance_amount: rupees(o.balancePaise || 0),
  paid_amount: rupees(o.paidAmountPaise || 0),
  balance_due: o.paymentPlan === 'advance' && o.paymentStatus === 'advance_paid' && o.status === 'confirmed' ? rupees(o.balancePaise || 0) : 0,
  balance_requested: Boolean(o.balanceRequestedAt)
});
export const toClientOrder = (o, { includeToken = false } = {}) => ({
  id: o.id, createdAt: o.createdAt, customer: o.customer, status: o.status,
  payment_status: o.paymentStatus, production_status: o.productionStatus,
  shipping_status: o.shippingStatus, custom_preview_status: o.customPreviewStatus,
  courier_name: o.courierName, tracking_number: o.trackingNumber, tracking_url: o.trackingUrl,
  estimated_delivery: o.estimatedDelivery,
  items: o.items.map((l) => ({ id: l.productId, productId: l.productId, slug: l.slug, title: l.title, image: l.image, quantity: l.quantity, unitPrice: rupees(l.unitPricePaise), lineTotal: rupees(l.lineTotalPaise) })),
  subtotal: rupees(o.subtotalPaise), discount: rupees(o.discountPaise), shipping: rupees(o.shippingPaise), total: rupees(o.totalPaise),
  ...planFields(o),
  status_history: o.statusHistory, preview_url: o.previewUrl || '', preview_note: o.previewNote || '', revision_count: o.revisionCount || 0,
  is_custom: o.customPreviewStatus !== 'not-required', invoice_number: o.invoiceNumber || '',
  ...(includeToken ? { guest_token: o.guestToken } : {})
});

// Guest tracking reveals progress only: no address, phone or email.
export const toTrackingView = (o) => ({
  id: o.id, createdAt: o.createdAt, status: o.status, payment_status: o.paymentStatus,
  production_status: o.productionStatus, shipping_status: o.shippingStatus, custom_preview_status: o.customPreviewStatus,
  courier_name: o.courierName, tracking_number: o.trackingNumber, tracking_url: o.trackingUrl,
  estimated_delivery: o.estimatedDelivery, status_history: o.statusHistory, preview_url: o.previewUrl || '', preview_note: o.previewNote || '',
  ...planFields(o), delivered_at: deliveredAtOf(o) || null, shipping_total: rupees(o.shippingPaise),
  items: o.items.map((l) => ({ id: l.productId, title: l.title, image: l.image, quantity: l.quantity })),
  total: rupees(o.totalPaise)
});

// Delivery time: the courier webhook stamps deliveredAt; a manual status change only leaves the history entry.
export const deliveredAtOf = (o) => o.deliveredAt || [...(o.statusHistory || [])].reverse().find((h) => h.status === 'delivered')?.at || null;

export const timingSafeEqualStr = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const canAccessOrder = (order, { user, guestToken }) =>
  Boolean(order) && ((['owner', 'admin'].includes(user?.role)) || (user?.sub && order.userId === user.sub) || timingSafeEqualStr(order.guestToken, guestToken));
