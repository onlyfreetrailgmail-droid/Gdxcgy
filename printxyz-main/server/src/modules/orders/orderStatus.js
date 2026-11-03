import { AppError } from '../../middleware/errors.js';
import { PAID_ENOUGH_TO_PRODUCE } from './advance.js';

// Three separate tracks plus the order state. Only listed transitions are allowed.
export const TRANSITIONS = {
  status: { pending_payment: ['confirmed', 'cancelled', 'expired'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [], expired: ['confirmed'] },
  productionStatus: {
    'awaiting-approval': ['approved', 'cancelled'], approved: ['queued'], queued: ['printing'], printing: ['quality-check'],
    'quality-check': ['packed', 'printing'], packed: [], cancelled: []
  },
  shippingStatus: {
    pending: ['shipped'], shipped: ['in-transit', 'delivered', 'delivery-failed'], 'in-transit': ['out-for-delivery', 'delivered', 'delivery-failed', 'returned'],
    'out-for-delivery': ['delivered', 'delivery-failed'], 'delivery-failed': ['out-for-delivery', 'returned'], delivered: [], returned: []
  },
  customPreviewStatus: { 'not-required': [], pending: ['preview-ready'], 'preview-ready': ['approved', 'changes-requested'], 'changes-requested': ['preview-ready'], approved: [] }
};
const FIELD_MAP = { status: 'status', production_status: 'productionStatus', shipping_status: 'shippingStatus', custom_preview_status: 'customPreviewStatus' };
const TEXT_FIELDS = { courier_name: 'courierName', tracking_number: 'trackingNumber', tracking_url: 'trackingUrl', estimated_delivery: 'estimatedDelivery' };

// Pure: returns { set, changes } or throws 400/409. Payment status is deliberately NOT settable by hand.
export const planStatusUpdate = (order, body = {}) => {
  if (body.payment_status !== undefined && body.payment_status !== order.paymentStatus) {
    throw new AppError(400, 'PAYMENT_STATUS_LOCKED', 'Payment status changes only through verified payments and refunds.');
  }
  const set = {}; const changes = [];
  for (const [apiKey, key] of Object.entries(FIELD_MAP)) {
    const next = body[apiKey];
    if (next === undefined || next === order[key]) continue;
    if (!(TRANSITIONS[key][order[key]] || []).includes(next)) {
      throw new AppError(409, 'INVALID_TRANSITION', `Cannot change ${apiKey} from "${order[key]}" to "${next}".`);
    }
    if (key === 'productionStatus' && ['approved', 'queued', 'printing', 'quality-check', 'packed'].includes(next) && !['approved', 'not-required'].includes(order.customPreviewStatus)) {
      throw new AppError(409, 'APPROVAL_REQUIRED', 'The customer has not approved the design preview yet.');
    }
    // Production may start once the advance (or full amount) is in; shipping and completion need the full amount.
    const needsProductionPayment = key === 'productionStatus' && next !== 'cancelled';
    const needsFullPayment = key === 'shippingStatus' || (key === 'status' && next === 'completed');
    if (needsProductionPayment && !PAID_ENOUGH_TO_PRODUCE.includes(order.paymentStatus)) throw new AppError(409, 'PAYMENT_REQUIRED', 'This order is not paid yet.');
    if (needsFullPayment && order.paymentStatus !== 'paid') {
      throw order.paymentStatus === 'advance_paid' ? new AppError(409, 'BALANCE_REQUIRED', 'The balance payment is still pending. Ask the customer to pay it before shipping.') : new AppError(409, 'PAYMENT_REQUIRED', 'This order is not paid yet.');
    }
    set[key] = next; changes.push({ field: apiKey, from: order[key], to: next });
  }
  for (const [apiKey, key] of Object.entries(TEXT_FIELDS)) {
    if (body[apiKey] === undefined) continue;
    const v = String(body[apiKey]).trim().slice(0, 300);
    if (key === 'trackingUrl' && v && !/^https:\/\//.test(v)) throw new AppError(400, 'INVALID_INPUT', 'Tracking URL must start with https://');
    if (v !== order[key]) { set[key] = v; changes.push({ field: apiKey, from: order[key] || '', to: v }); }
  }
  return { set, changes };
};

export const applyStatusUpdate = async ({ db, order, body, actor, now = new Date() }) => {
  const { set, changes } = planStatusUpdate(order, body);
  if (!changes.length) return { changed: false, changes };
  const reason = String(body.reason || '').trim().slice(0, 300);
  const r = await db.collection('orders').updateOne(
    { _id: order._id, ...Object.fromEntries(changes.filter((c) => ['status', 'productionStatus', 'shippingStatus', 'customPreviewStatus'].includes(FIELD_MAP[c.field])).map((c) => [FIELD_MAP[c.field], c.from])) },
    { $set: set, $push: { statusHistory: { status: set.status || set.productionStatus || set.shippingStatus || set.customPreviewStatus || 'updated', at: now.toISOString() } } }
  );
  if (!r.modifiedCount) throw new AppError(409, 'CONFLICT', 'The order changed while you were editing. Reload and try again.');
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: 'update_order_status', targetType: 'order', targetId: order.id, reason, changes });
  return { changed: true, changes };
};
