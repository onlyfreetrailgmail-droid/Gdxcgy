import { AppError } from '../../middleware/errors.js';
import { verifyCheckoutSignature } from '../../utils/signature.js';
import { canAccessOrder } from '../orders/orderService.js';
import { getBusinessSettings, issueCreditNote } from '../billing/billing.js';
import { enqueueEmail } from '../notifications/queue.js';
import { dueNowPaise, receivedPaise } from '../orders/advance.js';
import { recordPaymentFailure } from '../alerts/alerts.js';

const isDup = (e) => e?.code === 11000;

// The Razorpay order is always created from the amount stored on OUR order. The request body never carries money.
export const createRazorpayOrder = async ({ db, razorpay, orderId, guestToken, user, now = new Date() }) => {
  if (!razorpay) throw new AppError(503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not available right now.');
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.status !== 'pending_payment' || order.paymentStatus === 'paid') throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order cannot be paid.');
  if (new Date(order.expiresAt) <= now) throw new AppError(409, 'ORDER_EXPIRED', 'This order expired. Please check out again.');
  const due = dueNowPaise(order);
  if (order.razorpayOrderId) return { razorpayOrderId: order.razorpayOrderId, amountPaise: due, currency: 'INR', orderId: order.id };

  const rp = await razorpay.orders.create({ amount: due, currency: 'INR', receipt: order.id, notes: { orderId: order.id, plan: order.paymentPlan || 'full' } });
  const r = await db.collection('orders').updateOne({ _id: order._id, razorpayOrderId: null }, { $set: { razorpayOrderId: rp.id } });
  if (!r.modifiedCount) {
    const fresh = await db.collection('orders').findOne({ _id: order._id });
    return { razorpayOrderId: fresh.razorpayOrderId, amountPaise: due, currency: 'INR', orderId: fresh.id };
  }
  return { razorpayOrderId: rp.id, amountPaise: due, currency: 'INR', orderId: order.id };
};

// Idempotent. `justPaid` is true exactly once per order, so "paid" emails and purchase events fire from this flag only.
export const markPaid = async ({ db, order, paymentId, amountPaise, method = '', now = new Date() }) => {
  try {
    await db.collection('payments').insertOne({ paymentId, orderId: order.id, amountPaise, method, kind: order.paymentPlan === 'advance' ? 'advance' : 'full', status: 'captured', createdAt: now });
  } catch (e) {
    if (!isDup(e)) throw e;
  }
  const r = await db.collection('orders').updateOne(
    { _id: order._id, paymentStatus: { $ne: 'paid' }, status: { $in: ['pending_payment', 'expired'] } },
    { $set: { paymentStatus: order.paymentPlan === 'advance' ? 'advance_paid' : 'paid', status: 'confirmed', paymentReference: paymentId, paidAt: now, paidAmountPaise: amountPaise, stockReserved: false },
      $push: { statusHistory: { status: 'confirmed', at: now.toISOString() } } }
  );
  if (r.modifiedCount) return { justPaid: true, duplicate: false };
  const fresh = await db.collection('orders').findOne({ _id: order._id });
  if (fresh?.paymentReference && fresh.paymentReference !== paymentId) {
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { paymentFlag: 'second_payment_needs_refund' } });
    return { justPaid: false, duplicate: false, flagged: 'second_payment' };
  }
  return { justPaid: false, duplicate: true };
};

// ---- balance payment for part-paid (advance) orders ----
export const createBalanceOrder = async ({ db, razorpay, orderId, guestToken, user }) => {
  if (!razorpay) throw new AppError(503, 'RAZORPAY_NOT_CONFIGURED', 'Payments are not available right now.');
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.paymentPlan !== 'advance' || order.paymentStatus !== 'advance_paid' || order.status !== 'confirmed') throw new AppError(409, 'NO_BALANCE_DUE', 'There is no balance to pay on this order.');
  if (order.balanceRazorpayOrderId) return { razorpayOrderId: order.balanceRazorpayOrderId, amountPaise: order.balancePaise, currency: 'INR', orderId: order.id };
  const rp = await razorpay.orders.create({ amount: order.balancePaise, currency: 'INR', receipt: `${order.id}-bal`, notes: { orderId: order.id, kind: 'balance' } });
  const r = await db.collection('orders').updateOne({ _id: order._id, balanceRazorpayOrderId: null }, { $set: { balanceRazorpayOrderId: rp.id } });
  if (!r.modifiedCount) { const fresh = await db.collection('orders').findOne({ _id: order._id }); return { razorpayOrderId: fresh.balanceRazorpayOrderId, amountPaise: fresh.balancePaise, currency: 'INR', orderId: fresh.id }; }
  return { razorpayOrderId: rp.id, amountPaise: order.balancePaise, currency: 'INR', orderId: order.id };
};

// Idempotent. `justPaid` is true exactly once, when the balance completes the order.
export const markBalancePaid = async ({ db, order, paymentId, amountPaise, method = '', now = new Date() }) => {
  try { await db.collection('payments').insertOne({ paymentId, orderId: order.id, amountPaise, method, kind: 'balance', status: 'captured', createdAt: now }); }
  catch (e) { if (!isDup(e)) throw e; }
  const r = await db.collection('orders').updateOne(
    { _id: order._id, paymentStatus: 'advance_paid', status: 'confirmed', balancePaymentId: null },
    { $set: { paymentStatus: 'paid', balancePaymentId: paymentId, balancePaidAt: now }, $inc: { paidAmountPaise: amountPaise },
      $push: { statusHistory: { status: 'balance-paid', at: now.toISOString() } } });
  if (r.modifiedCount) return { justPaid: true, balancePaid: true, duplicate: false };
  const fresh = await db.collection('orders').findOne({ _id: order._id });
  if (fresh?.balancePaymentId && fresh.balancePaymentId !== paymentId) {
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { paymentFlag: 'second_payment_needs_refund' } });
    return { justPaid: false, balancePaid: false, flagged: 'second_payment' };
  }
  if (!fresh?.balancePaymentId) { await db.collection('orders').updateOne({ _id: order._id }, { $set: { paymentFlag: 'second_payment_needs_refund' } }); return { justPaid: false, balancePaid: false, flagged: 'balance_on_closed_order' }; }
  return { justPaid: false, balancePaid: true, duplicate: true };
};

export const verifyCheckout = async ({ db, keySecret, body = {}, now = new Date() }) => {
  const rpOrderId = String(body.razorpay_order_id || body.order_id || '');
  const paymentId = String(body.razorpay_payment_id || body.payment_id || '');
  const signature = String(body.razorpay_signature || body.signature || '');
  if (!verifyCheckoutSignature({ orderId: rpOrderId, paymentId, signature, secret: keySecret })) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Payment signature verification failed.');
  }
  // The order id must belong to one of OUR stored orders; the amount comes from that order, never the browser.
  const order = await db.collection('orders').findOne({ razorpayOrderId: rpOrderId });
  if (!order) {
    const balanceOrder = await db.collection('orders').findOne({ balanceRazorpayOrderId: rpOrderId });
    if (!balanceOrder) throw new AppError(400, 'ORDER_NOT_FOUND', 'No matching order for this payment.');
    const b = await markBalancePaid({ db, order: balanceOrder, paymentId, amountPaise: balanceOrder.balancePaise, now });
    if (b.flagged) throw new AppError(409, 'PAYMENT_ALREADY_USED', 'This order already has a different payment.');
    return { order: await db.collection('orders').findOne({ _id: balanceOrder._id }), ...b };
  }
  const result = await markPaid({ db, order, paymentId, amountPaise: dueNowPaise(order), now });
  if (result.flagged) throw new AppError(409, 'PAYMENT_ALREADY_USED', 'This order already has a different payment.');
  return { order: await db.collection('orders').findOne({ _id: order._id }), ...result };
};

const entityOf = (payload, key) => payload?.payload?.[key]?.entity || payload?.payload?.[key] || {};

export const handleWebhookEvent = async ({ db, payload, eventId, now = new Date() }) => {
  try {
    await db.collection('webhook_events').insertOne({ eventId, event: payload?.event || '', receivedAt: now });
  } catch (e) {
    if (isDup(e)) return { duplicate: true };
    throw e;
  }
  const type = payload?.event;

  if (type === 'payment.captured') {
    const p = entityOf(payload, 'payment');
    const order = await db.collection('orders').findOne({ razorpayOrderId: String(p.order_id || '') });
    if (!order) {
      const balanceOrder = await db.collection('orders').findOne({ balanceRazorpayOrderId: String(p.order_id || '') });
      if (!balanceOrder) return { unmatched: true };
      if (!Number.isInteger(p.amount) || p.amount !== balanceOrder.balancePaise) {
        await db.collection('orders').updateOne({ _id: balanceOrder._id }, { $set: { paymentFlag: 'amount_mismatch' } });
        return { flagged: 'amount_mismatch', justPaid: false };
      }
      return markBalancePaid({ db, order: balanceOrder, paymentId: String(p.id), amountPaise: p.amount, method: String(p.method || ''), now });
    }
    if (!Number.isInteger(p.amount) || p.amount !== dueNowPaise(order)) {
      await db.collection('orders').updateOne({ _id: order._id }, { $set: { paymentFlag: 'amount_mismatch' } });
      return { flagged: 'amount_mismatch', justPaid: false };
    }
    return markPaid({ db, order, paymentId: String(p.id), amountPaise: p.amount, method: String(p.method || ''), now });
  }

  if (type === 'payment.failed') {
    const p = entityOf(payload, 'payment');
    const order = await db.collection('orders').findOne({ razorpayOrderId: String(p.order_id || '') });
    const balanceOrder = order ? null : await db.collection('orders').findOne({ balanceRazorpayOrderId: String(p.order_id || '') });
    if (!order && !balanceOrder) return { unmatched: true };
    await recordPaymentFailure({ db, orderId: (order || balanceOrder).id, code: p.error_code, description: p.error_description, now });
    // Never downgrade a paid order; a later capture can still succeed (retry on same Razorpay order). A failed balance
    // attempt leaves the order as advance_paid.
    if (order) await db.collection('orders').updateOne({ _id: order._id, paymentStatus: { $in: ['pending', 'failed'] } }, { $set: { paymentStatus: 'failed' } });
    return { justPaid: false, failed: true };
  }

  if (type === 'refund.processed') {
    const rf = entityOf(payload, 'refund');
    const order = await db.collection('orders').findOne({ paymentReference: String(rf.payment_id || '') }) || await db.collection('orders').findOne({ balancePaymentId: String(rf.payment_id || '') });
    if (!order) return { unmatched: true };
    const amount = Number(rf.amount) || 0;
    let record = await db.collection('refunds').findOne({ razorpayRefundId: String(rf.id || '') });
    if (record) {
      const done = await db.collection('refunds').updateOne({ _id: record._id, status: { $ne: 'processed' } }, { $set: { status: 'processed', processedAt: now } });
      if (!done.modifiedCount) return { duplicate: true };
    } else {
      // Refund made directly in the Razorpay dashboard: record it so books stay complete.
      record = { _id: `rf_${String(rf.id)}`, orderId: order.id, paymentId: String(rf.payment_id || order.paymentReference), amountPaise: amount, reason: 'Refund issued in Razorpay dashboard', status: 'processed', razorpayRefundId: String(rf.id), createdAt: now, processedAt: now };
      record.id = record._id;
      try { await db.collection('refunds').insertOne(record); } catch (e) { if (isDup(e)) return { duplicate: true }; throw e; }
      await db.collection('orders').updateOne({ _id: order._id }, { $inc: { refundReservedPaise: amount } });
    }
    const after = await db.collection('orders').findOneAndUpdate({ _id: order._id }, { $inc: { refundedPaise: amount } }, { returnDocument: 'after' });
    const full = after.refundedPaise >= receivedPaise(order);
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { paymentStatus: full ? 'refunded' : 'partially_refunded' } });
    const creditNote = await issueCreditNote({ db, order: after, refund: record, settings: await getBusinessSettings(db, null), now });
    if (after.customerEmail) await enqueueEmail({ db, to: after.customerEmail, template: 'refund_processed', key: `refund:${record.id}`, now, data: { name: after.customer?.name, orderId: after.id, amount: amount / 100, creditNote: creditNote.number, trackToken: after.guestToken } });
    return { refunded: true, full, creditNote: creditNote.number, refundId: record.id };
  }
  return { ignored: true };
};
