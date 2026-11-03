import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { createOrder, toClientOrder } from '../src/modules/orders/orderService.js';
import { planAdvance } from '../src/modules/orders/advance.js';
import { createRazorpayOrder, createBalanceOrder, verifyCheckout, handleWebhookEvent } from '../src/modules/payments/paymentService.js';
import { applyStatusUpdate } from '../src/modules/orders/orderStatus.js';
import { createRefund } from '../src/modules/refunds/refundService.js';
import { requestBalance, sendBalanceReminders, REMINDER_GAP_MS } from '../src/modules/orders/balance.js';
import { requestReturn, returnsForOrder, decideReturn, listReturns } from '../src/modules/returns/returnService.js';

const KEY = 'ks';
const cfg = { advancePercent: 50, advanceMinTotalPaise: 200000, bulkMinQuantity: 10 };
const customer = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };
const owner = { sub: 'o1', email: 'owner@x.com', role: 'owner' };
const setup = async () => {
  const db = createFakeDb({ unique: { payments: ['paymentId'], webhook_events: ['eventId'], email_queue: ['key'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 100, image: 'i' });
  let n = 0; const refunds = []; const created = [];
  const razorpay = { orders: { create: async (b) => { created.push(b); return { id: `order_${++n}` }; } }, payments: { refund: async (pid, body) => { refunds.push({ pid, body }); return { id: `rfnd_${refunds.length}` }; } } };
  return { db, razorpay, refunds, created };
};
const sign = (o, p) => crypto.createHmac('sha256', KEY).update(`${o}|${p}`).digest('hex');
const sigBody = (o, p) => ({ razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: sign(o, p) });
const custom = { productId: 'p1', quantity: 2, options: { photos: [{ publicId: 'printxyz/customer-photos/a' }] } };
const advanceOrder = async (db, razorpay) => {
  const o = await createOrder({ db, input: { customer, items: [custom], paymentPlan: 'advance' }, advanceConfig: cfg });
  const rp = (await createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken })).razorpayOrderId;
  const r = await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, 'pay_adv') });
  return { o, rp, r };
};

test('advance plan: only custom or bulk orders above the minimum qualify; amounts come from the server', () => {
  const line = (q, photos) => ({ quantity: q, options: photos ? { photos: [{}] } : undefined });
  assert.equal(planAdvance({ lines: [line(1, false)], totalPaise: 500000, cfg }).eligible, false);       // plain order
  assert.equal(planAdvance({ lines: [line(1, true)], totalPaise: 150000, cfg }).eligible, false);        // below minimum
  assert.equal(planAdvance({ lines: [line(1, true)], totalPaise: 359800, cfg }).advancePaise, 179900);   // custom
  assert.equal(planAdvance({ lines: [line(12, false)], totalPaise: 300000, cfg }).eligible, true);       // bulk
  assert.equal(planAdvance({ lines: [line(1, true)], totalPaise: 359800, cfg: { ...cfg, advancePercent: 0 } }).eligible, false); // switched off
});

test('advance: a plain order cannot choose part payment', async () => {
  const { db } = await setup();
  await assert.rejects(createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 2 }], paymentPlan: 'advance' }, advanceConfig: cfg }), (e) => e.code === 'ADVANCE_NOT_AVAILABLE');
});

test('advance: first payment is only the advance, production may start, shipping needs the balance', async () => {
  const { db, razorpay, created } = await setup();
  const { o, r } = await advanceOrder(db, razorpay);
  assert.equal(created[0].amount, 179900);                                  // Razorpay asked for the advance, not the total
  assert.equal(r.order.paymentStatus, 'advance_paid'); assert.equal(r.order.status, 'confirmed'); assert.equal(r.order.paidAmountPaise, 179900);
  const view = toClientOrder(r.order); assert.equal(view.balance_due, 1799); assert.equal(view.payment_plan, 'advance');
  const fresh = (patch) => db.collection('orders').findOne({ id: o.id }).then((x) => ({ ...x, ...patch }));
  await db.collection('orders').updateOne({ id: o.id }, { $set: { customPreviewStatus: 'approved' } });
  assert.equal((await applyStatusUpdate({ db, order: await fresh(), body: { production_status: 'approved' }, actor: owner })).changed, true);
  await assert.rejects(applyStatusUpdate({ db, order: await fresh({ productionStatus: 'packed' }), body: { shipping_status: 'shipped' }, actor: owner }), (e) => e.code === 'BALANCE_REQUIRED');
});

test('advance: balance is created from the stored amount, paid once, and completes the order (callback and webhook are idempotent)', async () => {
  const { db, razorpay, created } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  const bal = await createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken });
  assert.equal(bal.amountPaise, 179900); assert.equal(created[1].amount, 179900);
  assert.equal((await createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken })).razorpayOrderId, bal.razorpayOrderId);   // reused
  await assert.rejects(createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: 'wrong-token' }), (e) => e.code === 'ORDER_NOT_FOUND');
  const a = await verifyCheckout({ db, keySecret: KEY, body: sigBody(bal.razorpayOrderId, 'pay_bal') });
  assert.equal(a.justPaid, true); assert.equal(a.order.paymentStatus, 'paid'); assert.equal(a.order.paidAmountPaise, 359800);
  const again = await handleWebhookEvent({ db, eventId: 'e1', payload: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_bal', order_id: bal.razorpayOrderId, amount: 179900 } } } } });
  assert.equal(again.justPaid, false); assert.equal(again.duplicate, true);
  await assert.rejects(createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken }), (e) => e.code === 'NO_BALANCE_DUE');
});

test('advance: a webhook with the wrong amount flags the order instead of paying it', async () => {
  const { db, razorpay } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  const bal = await createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken });
  const r = await handleWebhookEvent({ db, eventId: 'e2', payload: { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: bal.razorpayOrderId, amount: 100 } } } } });
  assert.equal(r.flagged, 'amount_mismatch');
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'advance_paid');
});

test('advance: a failed balance attempt never downgrades the order', async () => {
  const { db, razorpay } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  const bal = await createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken });
  await handleWebhookEvent({ db, eventId: 'e3', payload: { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: bal.razorpayOrderId, error_code: 'BAD_REQUEST_ERROR', error_description: 'declined' } } } } });
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'advance_paid');
  assert.equal(await db.collection('payment_failures').countDocuments({}), 1);
});

test('refund on a fully paid advance order is split: balance payment first, then the advance', async () => {
  const { db, razorpay, refunds } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  const bal = await createBalanceOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken });
  await verifyCheckout({ db, keySecret: KEY, body: sigBody(bal.razorpayOrderId, 'pay_bal') });
  const r = await createRefund({ db, razorpay, orderId: o.id, reason: 'test full refund', actor: owner });
  assert.equal(r.amountPaise, 359800); assert.equal(r.parts, 2);
  assert.deepEqual(refunds.map((x) => [x.pid, x.body.amount]), [['pay_bal', 179900], ['pay_adv', 179900]]);
  await assert.rejects(createRefund({ db, razorpay, orderId: o.id, reason: 'again', actor: owner }), (e) => ['INVALID_AMOUNT', 'REFUND_EXCEEDS'].includes(e.code));
});

test('refund on an advance-only order is limited to what was actually paid', async () => {
  const { db, razorpay, refunds } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  await assert.rejects(createRefund({ db, razorpay, orderId: o.id, amountPaise: 200000, reason: 'too much', actor: owner }), (e) => e.code === 'REFUND_EXCEEDS');
  const r = await createRefund({ db, razorpay, orderId: o.id, reason: 'cancelled', actor: owner });
  assert.equal(r.amountPaise, 179900); assert.deepEqual(refunds.map((x) => x.pid), ['pay_adv']);
});

test('balance request is sent once; reminders stop after three and wait three days apart', async () => {
  const { db, razorpay } = await setup();
  const { o } = await advanceOrder(db, razorpay);
  const order = await db.collection('orders').findOne({ id: o.id });
  const t0 = new Date('2026-11-01T10:00:00Z');
  assert.equal((await requestBalance({ db, order, now: t0 })).requested, true);
  assert.equal((await requestBalance({ db, order: await db.collection('orders').findOne({ id: o.id }), now: t0 })).requested, false);
  assert.equal(await db.collection('email_queue').countDocuments({ template: 'balance_due' }), 1);
  assert.equal((await sendBalanceReminders({ db, now: new Date(t0.getTime() + 3600_000) })).sent, 0);                // too soon
  for (let i = 1; i <= 5; i++) await sendBalanceReminders({ db, now: new Date(t0.getTime() + i * (REMINDER_GAP_MS + 1000)) });
  assert.equal(await db.collection('email_queue').countDocuments({ template: 'balance_reminder' }), 3);             // capped
});

// ---------------- returns ----------------
const delivered = async (db, razorpay, { custom: isCustom = false, daysAgo = 1 } = {}) => {
  const o = await createOrder({ db, input: { customer, items: [isCustom ? { productId: 'p1', quantity: 1, options: { photos: ['printxyz/customer-photos/x'] } } : { productId: 'p1', quantity: 1 }] } });
  const rp = (await createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken })).razorpayOrderId;
  await verifyCheckout({ db, keySecret: KEY, body: sigBody(rp, `pay_${o.id}`) });
  const at = new Date(Date.now() - daysAgo * 86400000).toISOString();
  await db.collection('orders').updateOne({ id: o.id }, { $set: { shippingStatus: 'delivered', status: 'completed', deliveredAt: at } });
  return o;
};
const ask = (db, o, extra = {}) => requestReturn({ db, orderId: o.id, guestToken: o.guestToken, reason: 'changed_mind', details: 'It does not fit my shelf at all.', windowDays: 7, ...extra });

test('returns: only delivered orders inside the window; not-delivered and late requests are refused', async () => {
  const { db, razorpay } = await setup();
  const fresh = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }] } });
  await assert.rejects(ask(db, fresh), (e) => e.code === 'ORDER_NOT_FOUND' || e.code === 'NOT_RETURNABLE');
  const late = await delivered(db, razorpay, { daysAgo: 9 });
  await assert.rejects(ask(db, late), (e) => e.code === 'NOT_RETURNABLE' && /window/.test(e.message));
  const ok = await delivered(db, razorpay, { daysAgo: 2 });
  const r = await ask(db, ok); assert.equal(r.status, 'requested'); assert.match(r.id, /^RET-\d{5}$/);
  await assert.rejects(ask(db, ok), (e) => e.code === 'RETURN_EXISTS');
  await assert.rejects(requestReturn({ db, orderId: ok.id, guestToken: 'nope', reason: 'changed_mind', details: 'long enough details here', windowDays: 7 }), (e) => e.code === 'ORDER_NOT_FOUND');
  await assert.rejects(ask(db, await delivered(db, razorpay), { windowDays: 0 }), (e) => e.code === 'NOT_RETURNABLE');
});

test('returns: personalised items only come back when damaged, defective or wrong; damage needs a photo', async () => {
  const { db, razorpay } = await setup();
  const o = await delivered(db, razorpay, { custom: true });
  await assert.rejects(ask(db, o), (e) => e.code === 'CUSTOM_NOT_RETURNABLE');
  await assert.rejects(ask(db, o, { reason: 'damaged' }), (e) => e.code === 'PHOTO_REQUIRED');
  await assert.rejects(ask(db, o, { reason: 'damaged', photos: ['someone-elses/photo'] }), (e) => e.code === 'INVALID_RETURN');
  const r = await ask(db, o, { reason: 'damaged', photos: [{ publicId: 'printxyz/customer-photos/dmg1' }] });
  assert.equal(r.photoCount, 1);
  const view = await returnsForOrder({ db, orderId: o.id, guestToken: o.guestToken, windowDays: 7 });
  assert.equal(view.eligibility.eligible, false); assert.equal(view.requests.length, 1);
  assert.deepEqual(view.reasons.map((x) => x.value), ['damaged', 'defective', 'wrong_item']);
});

test('returns: staff approve, receive, then refund through the payment provider; rejection needs a reason', async () => {
  const { db, razorpay, refunds } = await setup();
  const o = await delivered(db, razorpay);
  const r = await ask(db, o);
  await assert.rejects(decideReturn({ db, razorpay, id: r.id, action: 'refund', actor: owner }), (e) => e.code === 'INVALID_TRANSITION');   // approve first
  await decideReturn({ db, razorpay, id: r.id, action: 'approve', actor: owner });
  await decideReturn({ db, razorpay, id: r.id, action: 'received', actor: owner });
  const done = await decideReturn({ db, razorpay, id: r.id, action: 'refund', refundAmountPaise: 100000, note: 'item came back fine', actor: owner });
  assert.equal(done.status, 'refunded'); assert.equal(refunds[0].body.amount, 100000);
  assert.equal(await db.collection('email_queue').countDocuments({ template: 'return_update' }), 3);
  const o2 = await delivered(db, razorpay); const r2 = await ask(db, o2);
  await assert.rejects(decideReturn({ db, razorpay, id: r2.id, action: 'reject', actor: owner }), (e) => e.code === 'REASON_REQUIRED');
  assert.equal((await decideReturn({ db, razorpay, id: r2.id, action: 'reject', note: 'Outside policy', actor: owner })).status, 'rejected');
  assert.equal((await listReturns({ db })).length, 2);
});

test('custom options: only our own private photo references and a short note survive; others are dropped', async () => {
  const { cleanOptions } = await import('../src/modules/pricing/pricing.js');
  assert.deepEqual(cleanOptions({ photos: ['printxyz/customer-photos/a', 'https://evil.com/x.jpg', '../../etc', { publicId: 'printxyz/customer-photos/b' }], note: '  Name: Asha ', hack: 1 }),
    { photos: ['printxyz/customer-photos/a', 'printxyz/customer-photos/b'], note: 'Name: Asha' });
  assert.equal(cleanOptions({ photos: ['x'], note: '' }), undefined);
  assert.equal(cleanOptions('string'), undefined);
});
