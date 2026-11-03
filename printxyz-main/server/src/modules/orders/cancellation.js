import { AppError } from '../../middleware/errors.js';
import { canAccessOrder } from './orderService.js';
import { createRefund } from '../refunds/refundService.js';
import { PAID_ENOUGH_TO_PRODUCE } from './advance.js';

// Free cancellation only while production has not started. After that it becomes a request for staff to review.
const releaseStock = async (db, order) => {
  for (const l of order.items || []) await db.collection('products').updateOne({ id: l.productId }, { $inc: { stock: l.quantity } });
  if (order.couponCode) await db.collection('coupons').updateOne({ code: order.couponCode }, { $inc: { usedCount: -1 } });
};

export const FREE_CANCEL_STAGES = ['awaiting-approval', 'approved'];

export const requestCancellation = async ({ db, razorpay, orderId, user = null, guestToken = '', reason, now = new Date() }) => {
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!order || !canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw new AppError(400, 'REASON_REQUIRED', 'Please tell us why you are cancelling.');
  if (order.status !== 'confirmed') throw new AppError(409, 'NOT_CANCELLABLE', 'Only confirmed orders can be cancelled.');
  if (order.shippingStatus !== 'pending') throw new AppError(409, 'ALREADY_SHIPPED', 'This order has already shipped. Please contact support about a return.');

  const actor = { sub: order.userId || 'guest', email: order.customerEmail || 'customer' };
  const audit = (action, extra = {}) => db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action, targetType: 'order', targetId: order.id, reason: why, ...extra });

  if (!FREE_CANCEL_STAGES.includes(order.productionStatus)) {
    // Production has started: staff decide. One open request per order.
    const existing = await db.collection('cancellation_requests').findOne({ orderId: order.id, status: 'open' });
    if (!existing) await db.collection('cancellation_requests').insertOne({ orderId: order.id, reason: why, status: 'open', createdAt: now });
    await audit('cancellation_requested');
    return { outcome: 'requested', message: 'Production has already started, so our team will review your request and get back to you.' };
  }

  const claimed = await db.collection('orders').updateOne(
    { _id: order._id, status: 'confirmed', shippingStatus: 'pending', productionStatus: { $in: FREE_CANCEL_STAGES }, stockReleased: { $ne: true } },
    { $set: { status: 'cancelled', productionStatus: 'cancelled', cancelledAt: now, cancelReason: why, stockReleased: true }, $push: { statusHistory: { status: 'cancelled', at: now.toISOString() } } });
  if (!claimed.modifiedCount) throw new AppError(409, 'CONFLICT', 'The order just moved into production. Please try again or contact support.');
  await audit('customer_cancelled_order');
  await releaseStock(db, order);

  let refundStarted = false;
  if (PAID_ENOUGH_TO_PRODUCE.includes(order.paymentStatus)) {
    try { await createRefund({ db, razorpay, orderId: order.id, reason: `Cancelled by customer: ${why}`, actor, now }); refundStarted = true; }
    catch (error) {
      // The order stays cancelled; staff see it flagged and refund by hand. Never lose the cancellation.
      await db.collection('orders').updateOne({ _id: order._id }, { $set: { refundPending: true } });
      await audit('cancel_refund_failed', { code: error?.code || 'ERROR' });
    }
  }
  return { outcome: 'cancelled', refundStarted, order, message: refundStarted ? 'Your order is cancelled and your refund has started.' : 'Your order is cancelled. Our team will process your refund shortly.' };
};

// Staff decision on a request made after production started.
export const approveCancellation = async ({ db, razorpay, orderId, actor, now = new Date() }) => {
  const request = await db.collection('cancellation_requests').findOne({ orderId: String(orderId || ''), status: 'open' });
  if (!request) throw new AppError(404, 'REQUEST_NOT_FOUND', 'No open cancellation request for this order.');
  const order = await db.collection('orders').findOne({ id: request.orderId });
  const claimed = await db.collection('orders').updateOne(
    { _id: order._id, status: 'confirmed', shippingStatus: 'pending', stockReleased: { $ne: true } },
    { $set: { status: 'cancelled', productionStatus: 'cancelled', cancelledAt: now, cancelReason: request.reason, stockReleased: true }, $push: { statusHistory: { status: 'cancelled', at: now.toISOString() } } });
  if (!claimed.modifiedCount) throw new AppError(409, 'NOT_CANCELLABLE', 'This order can no longer be cancelled (shipped or already cancelled).');
  await releaseStock(db, order);
  await db.collection('cancellation_requests').updateOne({ _id: request._id }, { $set: { status: 'approved', decidedBy: actor.email, decidedAt: now } });
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: 'approve_cancellation', targetType: 'order', targetId: order.id, reason: request.reason });
  let refundStarted = false;
  if (PAID_ENOUGH_TO_PRODUCE.includes(order.paymentStatus)) {
    try { await createRefund({ db, razorpay, orderId: order.id, reason: `Cancellation approved: ${request.reason}`, actor, now }); refundStarted = true; }
    catch (error) { await db.collection('orders').updateOne({ _id: order._id }, { $set: { refundPending: true } }); }
  }
  return { order, refundStarted };
};

export const declineCancellation = async ({ db, orderId, actor, note, now = new Date() }) => {
  const r = await db.collection('cancellation_requests').updateOne({ orderId: String(orderId || ''), status: 'open' },
    { $set: { status: 'declined', decidedBy: actor.email, decidedAt: now, note: String(note || '').slice(0, 300) } });
  if (!r.modifiedCount) throw new AppError(404, 'REQUEST_NOT_FOUND', 'No open cancellation request for this order.');
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: 'decline_cancellation', targetType: 'order', targetId: String(orderId), reason: String(note || '').slice(0, 300) });
};
