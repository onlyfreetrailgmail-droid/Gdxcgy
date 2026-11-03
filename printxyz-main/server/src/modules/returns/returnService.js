import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { canAccessOrder, deliveredAtOf } from '../orders/orderService.js';
import { createRefund } from '../refunds/refundService.js';
import { enqueueEmail } from '../notifications/queue.js';
import { nextSequence } from '../../db/counters.js';

export const RETURN_REASONS = {
  damaged: 'Arrived damaged', defective: 'Print flaw or defect', wrong_item: 'Wrong item received',
  not_as_described: 'Not as described', changed_mind: 'Changed my mind'
};
// Personalised (made-to-order) items are returnable only when something went wrong on our side.
export const CUSTOM_RETURN_REASONS = ['damaged', 'defective', 'wrong_item'];
export const OPEN_STATUSES = ['requested', 'approved', 'received'];
export const STATUS_LABELS = { requested: 'received', approved: 'approved', rejected: 'declined', received: 'received back', refunded: 'refunded', closed: 'closed' };
const PHOTO_PREFIX = 'printxyz/customer-photos/';
const bad = (m, code = 'INVALID_RETURN') => new AppError(400, code, m);
const DAY = 24 * 3600_000;

export const returnEligibility = ({ order, windowDays, now = new Date() }) => {
  if (!windowDays) return { eligible: false, reason: 'Returns are not enabled for this store.' };
  if (order.shippingStatus !== 'delivered') return { eligible: false, reason: 'Returns open after your order is delivered.' };
  const at = deliveredAtOf(order);
  const deliveredMs = at ? new Date(at).getTime() : null;
  if (deliveredMs && now.getTime() > deliveredMs + windowDays * DAY) return { eligible: false, reason: `The ${windowDays}-day return window has passed.` };
  return { eligible: true, custom: order.customPreviewStatus !== 'not-required', until: deliveredMs ? new Date(deliveredMs + windowDays * DAY) : null };
};

const toView = (r) => ({ id: r._id, orderId: r.orderId, status: r.status, statusLabel: STATUS_LABELS[r.status] || r.status, reason: r.reason, reasonLabel: RETURN_REASONS[r.reason] || r.reason,
  details: r.details, items: r.items, photoCount: (r.photos || []).length, createdAt: r.createdAt, decisionNote: r.decisionNote || '', refundPaise: r.refundPaise || 0 });

export const requestReturn = async ({ db, orderId, user = null, guestToken = '', reason, details, photos = [], items, windowDays, supportEmail = '', now = new Date() }) => {
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!order || !canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const elig = returnEligibility({ order, windowDays, now });
  if (!elig.eligible) throw new AppError(409, 'NOT_RETURNABLE', elig.reason);
  if (!RETURN_REASONS[reason]) throw bad('Please choose a reason.');
  if (elig.custom && !CUSTOM_RETURN_REASONS.includes(reason)) throw bad('Personalised items can be returned only if they arrive damaged, defective or are not what you ordered.', 'CUSTOM_NOT_RETURNABLE');
  const text = String(details || '').trim().slice(0, 1000);
  if (text.length < 10) throw bad('Please describe the problem in at least 10 characters.');
  if (['damaged', 'defective'].includes(reason) && (!Array.isArray(photos) || photos.length === 0)) throw bad('Please attach at least one photo of the problem.', 'PHOTO_REQUIRED');
  const clean = [...new Set((Array.isArray(photos) ? photos : []).map((p) => String(p?.publicId ?? p ?? '')))].slice(0, 5);
  if (clean.some((p) => !p.startsWith(PHOTO_PREFIX))) throw bad('A photo reference is invalid.');
  const open = await db.collection('return_requests').findOne({ orderId: order.id, status: { $in: OPEN_STATUSES } });
  if (open) throw new AppError(409, 'RETURN_EXISTS', 'You already have an open return request for this order.');
  const refunded = await db.collection('return_requests').findOne({ orderId: order.id, status: 'refunded' });
  if (refunded) throw new AppError(409, 'RETURN_EXISTS', 'This order has already been refunded through a return.');

  const wanted = Array.isArray(items) && items.length ? items : order.items.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  const lines = wanted.map((w) => {
    const line = order.items.find((l) => l.productId === String(w?.productId));
    const quantity = Number(w?.quantity);
    if (!line || !Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) throw bad('One of the selected items is not on this order.');
    return { productId: line.productId, title: line.title, quantity, amountPaise: line.unitPricePaise * quantity };
  });
  const doc = { _id: `RET-${String(await nextReturnNumber(db)).padStart(5, '0')}`, orderId: order.id, userId: order.userId || '', customerEmail: order.customerEmail || '', reason, details: text, photos: clean, items: lines,
    itemsPaise: lines.reduce((s, l) => s + l.amountPaise, 0), status: 'requested', createdAt: now };
  await db.collection('return_requests').insertOne(doc);
  if (supportEmail) await enqueueEmail({ db, to: supportEmail, template: 'return_alert', key: `return_alert:${doc._id}`, now, data: { returnId: doc._id, orderId: order.id, reason: RETURN_REASONS[reason], details: text } });
  await db.collection('audit_logs').insertOne({ at: now, actorId: order.userId || 'guest', actorEmail: order.customerEmail || 'customer', action: 'return_requested', targetType: 'order', targetId: order.id, reason: RETURN_REASONS[reason], changes: [] });
  return toView(doc);
};

const nextReturnNumber = (db) => nextSequence(db, 'returns');

export const returnsForOrder = async ({ db, orderId, user = null, guestToken = '', windowDays, now = new Date() }) => {
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!order || !canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const rows = await db.collection('return_requests').find({ orderId: order.id }).sort({ createdAt: -1 }).toArray();
  const elig = returnEligibility({ order, windowDays, now });
  const open = rows.some((r) => [...OPEN_STATUSES, 'refunded'].includes(r.status));
  return { eligibility: { ...elig, eligible: elig.eligible && !open }, reasons: Object.entries(RETURN_REASONS).filter(([k]) => !elig.custom || CUSTOM_RETURN_REASONS.includes(k)).map(([value, label]) => ({ value, label })), requests: rows.map(toView) };
};

export const listReturns = async ({ db, status, cloudinary }) => {
  const rows = await db.collection('return_requests').find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).toArray();
  return rows.map((r) => ({ ...toView(r), customerEmail: r.customerEmail, itemsPaise: r.itemsPaise, photos: (r.photos || []).map((id) => (cloudinary?.configured ? cloudinary.signedUrl(id, 'jpg', 900) : '')).filter(Boolean) }));
};

const TRANSITIONS = { approve: { from: ['requested'], to: 'approved' }, reject: { from: ['requested'], to: 'rejected' }, received: { from: ['approved'], to: 'received' }, close: { from: ['requested', 'approved', 'received'], to: 'closed' } };

export const decideReturn = async ({ db, razorpay, id, action, note, refundAmountPaise, actor, now = new Date() }) => {
  const r = await db.collection('return_requests').findOne({ _id: String(id || '') });
  if (!r) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return request not found.');
  const order = await db.collection('orders').findOne({ id: r.orderId });
  const why = String(note || '').trim().slice(0, 300);
  let next; let refundPaise = 0;
  if (action === 'refund') {
    if (!['approved', 'received'].includes(r.status)) throw new AppError(409, 'INVALID_TRANSITION', 'Approve the request before refunding.');
    refundPaise = refundAmountPaise == null ? r.itemsPaise : refundAmountPaise;
    if (!Number.isInteger(refundPaise) || refundPaise <= 0) throw bad('Refund amount must be a positive amount.', 'INVALID_AMOUNT');
    await createRefund({ db, razorpay, orderId: r.orderId, amountPaise: refundPaise, reason: `Return ${r._id}${why ? `: ${why}` : ''}`, actor, now });
    next = 'refunded';
  } else {
    const t = TRANSITIONS[action];
    if (!t) throw bad('Unknown action.');
    if (!t.from.includes(r.status)) throw new AppError(409, 'INVALID_TRANSITION', `A ${r.status} request cannot be ${action === 'received' ? 'marked received' : `${action}d`}.`);
    if (action === 'reject' && why.length < 3) throw bad('Please give the customer a reason.', 'REASON_REQUIRED');
    next = t.to;
  }
  const claimed = await db.collection('return_requests').updateOne({ _id: r._id, status: r.status }, { $set: { status: next, decisionNote: why || r.decisionNote || '', decidedBy: actor.email, decidedAt: now, ...(refundPaise ? { refundPaise } : {}) } });
  if (!claimed.modifiedCount) throw new AppError(409, 'CONFLICT', 'The request changed. Reload and try again.');
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: `return_${action}`, targetType: 'order', targetId: r.orderId, reason: why, changes: [{ field: 'return', from: r.status, to: next }] });
  if (order?.customerEmail) await enqueueEmail({ db, to: order.customerEmail, template: 'return_update', key: `return_update:${r._id}:${next}`, now,
    data: { name: order.customer?.name || 'there', returnId: r._id, orderId: r.orderId, statusLabel: STATUS_LABELS[next], note: why, refundAmount: refundPaise / 100, trackToken: order.guestToken } });
  return { status: next };
};
