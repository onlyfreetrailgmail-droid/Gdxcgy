import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { createOrder, expireStaleOrders, toTrackingView, canAccessOrder, PAYMENT_WINDOW_MS } from '../src/modules/orders/orderService.js';
import { createRazorpayOrder, verifyCheckout, handleWebhookEvent } from '../src/modules/payments/paymentService.js';

const KEY = 'key_secret_test';
const customer = { name: 'Asha Rao', email: 'Asha@Example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };

const setup = async (stock = 5) => {
  const db = createFakeDb({ unique: { payments: ['paymentId'], webhook_events: ['eventId'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock, image: 'i' });
  await db.collection('coupons').insertOne({ _id: 'c1', code: 'SAVE200', type: 'flat', value: 20000, minOrderPaise: 120000, usageLimit: 1, usedCount: 0, perUserLimit: 1 });
  let n = 0;
  const razorpay = { orders: { create: async ({ amount }) => ({ id: `order_${++n}`, amount }) } };
  return { db, razorpay };
};
const place = (db, extra = {}) => createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }], ...extra } });
const sign = (o, p) => crypto.createHmac('sha256', KEY).update(`${o}|${p}`).digest('hex');
const sigBody = (o, p) => ({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
const captured = (rpOrder, id, amount) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: rpOrder, amount, method: 'upi' } } } });
const failed = (rpOrder, id) => ({ event: 'payment.failed', payload: { payment: { entity: { id, order_id: rpOrder, amount: 179900 } } } });
const pay = async (db, razorpay, order) => (await createRazorpayOrder({ db, razorpay, orderId: order.id, guestToken: order.guestToken })).razorpayOrderId;

test('checkout: client-sent amounts, prices and totals are ignored', async () => {
  const { db } = await setup();
  const o = await createOrder({ db, input: { customer, total: 1, amount: 1, items: [{ productId: 'p1', quantity: 2, price: 1, unitPrice: 1 }] } });
  assert.equal(o.totalPaise, 359800); assert.equal(o.items[0].unitPricePaise, 179900);
  assert.match(o.id, /^PX-\d{4}-0001$/); assert.equal(o.status, 'pending_payment');
  assert.equal(o.customerEmail, 'asha@example.com');
});
test('checkout: rejects invalid customer details', async () => {
  const { db } = await setup();
  await assert.rejects(createOrder({ db, input: { customer: { ...customer, phone: '123' }, items: [{ productId: 'p1', quantity: 1 }] } }), /mobile/);
  await assert.rejects(createOrder({ db, input: { customer: { ...customer, pincode: '12' }, items: [{ productId: 'p1', quantity: 1 }] } }), /pincode/);
});
test('stock: concurrent orders for the last unit, exactly one wins; others get OUT_OF_STOCK', async () => {
  const { db } = await setup(1);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => place(db)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => ['OUT_OF_STOCK'].includes(r.reason.code)));
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 0);
  const nums = (await db.collection('orders').find({}).toArray()).map((o) => o.id);
  assert.equal(new Set(nums).size, nums.length);
});
test('coupon: applied server-side, usage limit and per-customer limit enforced atomically', async () => {
  const { db } = await setup(9);
  const o = await place(db, { couponCode: 'save200' });
  assert.equal(o.discountPaise, 20000); assert.equal(o.totalPaise, 159900);
  await assert.rejects(place(db, { couponCode: 'SAVE200' }), (e) => ['COUPON_USED', 'COUPON_EXHAUSTED'].includes(e.code));
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 8);
});
test('expiry: unpaid orders release stock and coupon exactly once', async () => {
  const { db } = await setup(5);
  const t0 = new Date('2026-01-01T10:00:00Z');
  await createOrder({ db, now: t0, input: { customer, couponCode: 'SAVE200', items: [{ productId: 'p1', quantity: 2 }] } });
  assert.equal(await expireStaleOrders({ db, now: new Date(t0.getTime() + PAYMENT_WINDOW_MS - 1) }), 0);
  assert.equal(await expireStaleOrders({ db, now: new Date(t0.getTime() + PAYMENT_WINDOW_MS + 1) }), 1);
  assert.equal(await expireStaleOrders({ db, now: new Date(t0.getTime() + 2 * PAYMENT_WINDOW_MS) }), 0);
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).stock, 5);
  assert.equal((await db.collection('coupons').findOne({ code: 'SAVE200' })).usedCount, 0);
});

test('payments: Razorpay order uses stored amount, needs token or owner, is idempotent', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db);
  await assert.rejects(createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: 'wrong' }), (e) => e.code === 'ORDER_NOT_FOUND');
  const a = await createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken, amount: 1 });
  const b = await createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken });
  assert.equal(a.amountPaise, 179900); assert.equal(a.razorpayOrderId, b.razorpayOrderId);
});
test('verify: forged signature rejected, order not paid', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  await assert.rejects(verifyCheckout({ db, keySecret: KEY, body: { razorpay_order_id: rp, razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) } }), (e) => e.code === 'INVALID_SIGNATURE');
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'pending');
});
test('verify: valid signature for an order id we never issued is rejected', async () => {
  const { db } = await setup();
  await assert.rejects(verifyCheckout({ db, keySecret: KEY, body: sigBody('order_foreign', 'pay_9') }), (e) => e.code === 'ORDER_NOT_FOUND');
});
test('verify: pays once; replay is a no-op; different payment id on a paid order is refused', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  const r1 = await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_1') });
  assert.equal(r1.justPaid, true); assert.equal(r1.order.status, 'confirmed');
  const r2 = await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_1') });
  assert.equal(r2.justPaid, false); assert.equal(r2.duplicate, true);
  await assert.rejects(verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_2') }), (e) => e.code === 'PAYMENT_ALREADY_USED');
  // The stray second payment is recorded for refund review, and the order is flagged.
  assert.equal(await db.collection('payments').countDocuments({ orderId: o.id }), 2);
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentFlag, 'second_payment_needs_refund');
});
test('webhook: duplicate event ids never double-process', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  const a = await handleWebhookEvent({ db, payload: captured(rp, 'pay_1', 179900), eventId: 'evt_1' });
  const b = await handleWebhookEvent({ db, payload: captured(rp, 'pay_1', 179900), eventId: 'evt_1' });
  assert.equal(a.justPaid, true); assert.equal(b.duplicate, true);
  assert.equal(await db.collection('payments').countDocuments({ paymentId: 'pay_1' }), 1);
});
test('webhook: same payment via verify then a new event id still pays only once', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  assert.equal((await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_1') })).justPaid, true);
  const w = await handleWebhookEvent({ db, payload: captured(rp, 'pay_1', 179900), eventId: 'evt_9' });
  assert.equal(w.justPaid, false); assert.equal(w.duplicate, true);
});
test('webhook: amount mismatch is flagged, never marked paid', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  for (const amt of [100, 0, undefined]) {
    const w = await handleWebhookEvent({ db, payload: captured(rp, 'pay_x', amt), eventId: `e_${amt}` });
    assert.equal(w.flagged, 'amount_mismatch');
  }
  const fresh = await db.collection('orders').findOne({ id: o.id });
  assert.equal(fresh.paymentStatus, 'pending'); assert.equal(fresh.paymentFlag, 'amount_mismatch');
});
test('webhook: failed payment is not "paid" and fires no paid signal; later capture still succeeds (out of order)', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  const f = await handleWebhookEvent({ db, payload: failed(rp, 'pay_f'), eventId: 'evt_f' });
  assert.equal(f.justPaid, false);
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'failed');
  const c = await handleWebhookEvent({ db, payload: captured(rp, 'pay_ok', 179900), eventId: 'evt_c' });
  assert.equal(c.justPaid, true);
  const late = await handleWebhookEvent({ db, payload: failed(rp, 'pay_f2'), eventId: 'evt_f2' });
  assert.equal(late.failed, true);
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'paid');
});
test('webhook: refund.processed updates payment status (partial then full)', async () => {
  const { db, razorpay } = await setup();
  const o = await place(db); const rp = await pay(db, razorpay, o);
  await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_1') });
  const ref = (id, amount) => ({ event: 'refund.processed', payload: { refund: { entity: { id, payment_id: 'pay_1', amount } } } });
  await handleWebhookEvent({ db, payload: ref('rfnd_1', 50000), eventId: 'r1' });
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'partially_refunded');
  await handleWebhookEvent({ db, payload: ref('rfnd_2', 129900), eventId: 'r2' });
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'refunded');
});

test('access: customers see only their own orders; tracking view hides personal data', async () => {
  const { db } = await setup(9);
  const mine = await createOrder({ db, user: { sub: 'u1' }, input: { customer, items: [{ productId: 'p1', quantity: 1 }] } });
  assert.equal(canAccessOrder(mine, { user: { sub: 'u1', role: 'user' } }), true);
  assert.equal(canAccessOrder(mine, { user: { sub: 'u2', role: 'user' } }), false);
  assert.equal(canAccessOrder(mine, { user: null, guestToken: mine.guestToken }), true);
  assert.equal(canAccessOrder(mine, { user: null, guestToken: mine.guestToken.slice(0, -1) + (mine.guestToken.endsWith('0') ? '1' : '0') }), false);
  assert.equal(canAccessOrder(mine, { user: { sub: 'x', role: 'admin' } }), true);
  const view = JSON.stringify(toTrackingView(mine));
  for (const pii of ['Asha', 'asha@', '9876543210', 'MG Road', '800001', mine.guestToken]) assert.ok(!view.includes(pii), pii);
  assert.equal(mine.guestToken.length, 48);
});
