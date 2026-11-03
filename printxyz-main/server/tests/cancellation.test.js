import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { requestCancellation, approveCancellation, declineCancellation } from '../src/modules/orders/cancellation.js';

const setup = async (orderOverrides = {}) => {
  const db = createFakeDb();
  await db.collection('products').insertOne({ _id: 'p1', id: 'p1', stock: 4 });
  await db.collection('coupons').insertOne({ _id: 'c1', code: 'SAVE', usedCount: 1 });
  const order = { _id: 'o1', id: 'PX-2026-0001', userId: 'u1', customerEmail: 'a@b.in', customer: { name: 'A' }, guestToken: 'g'.repeat(48),
    items: [{ productId: 'p1', quantity: 2 }], couponCode: 'SAVE', totalPaise: 100000, refundReservedPaise: 0,
    status: 'confirmed', paymentStatus: 'paid', paymentReference: 'pay_1', productionStatus: 'awaiting-approval', shippingStatus: 'pending', ...orderOverrides };
  await db.collection('orders').insertOne(order);
  const refunds = [];
  const razorpay = { payments: { refund: async (pid, body) => { refunds.push({ pid, body }); return { id: 'rf_1' }; } } };
  return { db, razorpay, refunds };
};
const user = { sub: 'u1', email: 'a@b.in' };

test('free cancel before production: cancelled, stock and coupon released, full refund started', async () => {
  const { db, razorpay, refunds } = await setup();
  const r = await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'Changed my mind' });
  assert.equal(r.outcome, 'cancelled'); assert.equal(r.refundStarted, true);
  assert.equal(refunds.length, 1); assert.equal(refunds[0].body.amount, 100000);
  const o = await db.collection('orders').findOne({ id: 'PX-2026-0001' });
  assert.equal(o.status, 'cancelled');
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 6);
  assert.equal((await db.collection('coupons').findOne({ code: 'SAVE' })).usedCount, 0);
});

test('cancelling twice never releases stock twice or refunds twice', async () => {
  const { db, razorpay, refunds } = await setup();
  await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'Changed my mind' });
  await assert.rejects(requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'again' }));
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 6);
  assert.equal(refunds.length, 1);
});

test('another customer cannot cancel; guest token works', async () => {
  const { db, razorpay } = await setup();
  await assert.rejects(requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user: { sub: 'u2' }, reason: 'nope nope' }), /not found/i);
  const r = await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', guestToken: 'g'.repeat(48), reason: 'guest cancel' });
  assert.equal(r.outcome, 'cancelled');
});

test('after production starts it becomes a request; staff approve then it refunds and releases stock', async () => {
  const { db, razorpay, refunds } = await setup({ productionStatus: 'printing' });
  const r = await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'Need it cancelled' });
  assert.equal(r.outcome, 'requested');
  assert.equal((await db.collection('orders').findOne({ id: 'PX-2026-0001' })).status, 'confirmed');
  const a = await approveCancellation({ db, razorpay, orderId: 'PX-2026-0001', actor: { sub: 's1', email: 'staff@x.in' } });
  assert.equal(a.refundStarted, true); assert.equal(refunds.length, 1);
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 6);
});

test('shipped orders cannot be cancelled; declined requests are recorded', async () => {
  const shipped = await setup({ shippingStatus: 'shipped' });
  await assert.rejects(requestCancellation({ db: shipped.db, razorpay: shipped.razorpay, orderId: 'PX-2026-0001', user, reason: 'too late' }), /shipped/i);
  const { db, razorpay } = await setup({ productionStatus: 'printing' });
  await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'Need it cancelled' });
  await declineCancellation({ db, orderId: 'PX-2026-0001', actor: { sub: 's1', email: 'staff@x.in' }, note: 'Already printed' });
  assert.equal((await db.collection('cancellation_requests').findOne({ orderId: 'PX-2026-0001' })).status, 'declined');
});

test('a failed refund keeps the order cancelled and flags it for staff', async () => {
  const { db } = await setup();
  const razorpay = { payments: { refund: async () => { throw new Error('gateway down'); } } };
  const r = await requestCancellation({ db, razorpay, orderId: 'PX-2026-0001', user, reason: 'Changed my mind' });
  assert.equal(r.refundStarted, false);
  const o = await db.collection('orders').findOne({ id: 'PX-2026-0001' });
  assert.equal(o.status, 'cancelled'); assert.equal(o.refundPending, true);
});
