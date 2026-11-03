import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { REFUNDABLE_STATUSES, receivedPaise } from '../orders/advance.js';

// The captured payments behind an order, newest first (the balance is refunded before the advance).
const paymentsOf = (order) => {
  const received = receivedPaise(order);
  if (order.balancePaymentId) return [{ id: order.balancePaymentId, amount: order.balancePaise }, { id: order.paymentReference, amount: received - order.balancePaise }];
  return [{ id: order.paymentReference, amount: received }];
};

// Admin-initiated refund through the Razorpay API. The amount is reserved atomically first, so two staff
// members (or a double click) can never refund more than was paid. An order paid in two parts may need one
// Razorpay refund per payment; each gets its own record and credit note.
export const createRefund = async ({ db, razorpay, orderId, amountPaise, reason, actor, now = new Date() }) => {
  if (!razorpay) throw new AppError(503, 'RAZORPAY_NOT_CONFIGURED', 'Refunds are not available right now.');
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (!REFUNDABLE_STATUSES.includes(order.paymentStatus) || !order.paymentReference) {
    throw new AppError(409, 'NOT_REFUNDABLE', 'This order has no captured payment to refund.');
  }
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 3) throw new AppError(400, 'REASON_REQUIRED', 'A reason is required for every refund.');
  const received = receivedPaise(order);
  const remaining = received - (order.refundReservedPaise || 0);
  const amount = amountPaise == null ? remaining : amountPaise;
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Refund amount must be a positive amount.');
  if (amount > remaining) throw new AppError(409, 'REFUND_EXCEEDS', 'Refund is more than the amount still refundable.');

  const reserved = await db.collection('orders').updateOne(
    { _id: order._id, refundReservedPaise: { $lte: received - amount } }, { $inc: { refundReservedPaise: amount } });
  if (!reserved.modifiedCount) throw new AppError(409, 'REFUND_EXCEEDS', 'Another refund is in progress. Reload and check the balance.');

  // Split the amount across the payments that still have refundable money.
  const parts = []; let left = amount;
  for (const pay of paymentsOf(order)) {
    if (left <= 0) break;
    const refs = await db.collection('refunds').find({ paymentId: pay.id }).toArray();
    const used = refs.filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amountPaise, 0);
    const room = Math.max(pay.amount - used, 0);
    const take = Math.min(room, left);
    if (take > 0) { parts.push({ paymentId: pay.id, amountPaise: take }); left -= take; }
  }
  if (left > 0) {
    await db.collection('orders').updateOne({ _id: order._id }, { $inc: { refundReservedPaise: -amount } });
    throw new AppError(409, 'REFUND_EXCEEDS', 'Refund is more than the amount still refundable.');
  }

  const made = []; let released = 0;
  for (const part of parts) {
    const refund = { _id: crypto.randomUUID(), orderId: order.id, paymentId: part.paymentId, amountPaise: part.amountPaise, reason: why,
      status: 'requested', requestedBy: actor.email, createdAt: now, razorpayRefundId: null };
    refund.id = refund._id;
    await db.collection('refunds').insertOne(refund);
    try {
      const rp = await razorpay.payments.refund(part.paymentId, { amount: part.amountPaise, notes: { orderId: order.id, refundId: refund.id, reason: why } });
      await db.collection('refunds').updateOne({ _id: refund._id }, { $set: { status: 'processing', razorpayRefundId: rp.id } });
      made.push(refund);
    } catch (err) {
      const rest = parts.slice(parts.indexOf(part)).reduce((s, x) => s + x.amountPaise, 0);
      released = rest;
      await db.collection('refunds').updateOne({ _id: refund._id }, { $set: { status: 'failed', failureReason: String(err?.error?.description || err?.message || 'unknown').slice(0, 200) } });
      break;
    }
  }
  if (released) await db.collection('orders').updateOne({ _id: order._id }, { $inc: { refundReservedPaise: -released } });
  if (made.length) await db.collection('orders').updateOne({ _id: order._id, paymentStatus: { $in: ['paid', 'advance_paid', 'partially_refunded'] } }, { $set: { paymentStatus: 'refund_processing' } });
  if (made.length < parts.length) {
    throw new AppError(502, 'REFUND_FAILED', made.length ? 'Part of the refund was sent; the payment provider rejected the rest. Check the order and retry for the remaining amount.' : 'The payment provider rejected the refund. Nothing was refunded.');
  }
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: 'refund_requested', targetType: 'order', targetId: order.id, reason: why, changes: [{ field: 'refund', from: '', to: `${amount} paise` }] });
  const first = await db.collection('refunds').findOne({ _id: made[0]._id });
  return { ...first, amountPaise: amount, parts: made.length };
};
