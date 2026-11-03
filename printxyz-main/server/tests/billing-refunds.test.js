import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { createOrder } from '../src/modules/orders/orderService.js';
import { createRazorpayOrder, verifyCheckout, handleWebhookEvent } from '../src/modules/payments/paymentService.js';
import { createRefund } from '../src/modules/refunds/refundService.js';
import { respondToPreview, MAX_REVISIONS } from '../src/modules/orders/customApproval.js';
import { purgeExpiredPhotos } from '../src/modules/orders/retention.js';
import { financialYear, amountInWords, getBusinessSettings, issueInvoice, issueReceipt, issueCreditNote, renderDocumentHtml } from '../src/modules/billing/billing.js';

const KEY = 'ks';
const customer = { name: 'Asha <b>Rao</b>', email: 'asha@example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };
const setup = async () => {
  const db = createFakeDb({ unique: { payments: ['paymentId'], webhook_events: ['eventId'], invoices: ['number'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 50, image: 'i' });
  let n = 0; const refunds = [];
  const razorpay = { orders: { create: async () => ({ id: `order_${++n}` }) }, payments: { refund: async (pid, body) => { refunds.push({ pid, body }); return { id: `rfnd_${refunds.length}` }; } } };
  return { db, razorpay, refunds };
};
const sign = (o, p) => crypto.createHmac('sha256', KEY).update(`${o}|${p}`).digest('hex');
const paidOrder = async (db, razorpay, items = [{ productId: 'p1', quantity: 1 }], payId = 'pay_1') => {
  const o = await createOrder({ db, input: { customer, items } });
  const rp = (await createRazorpayOrder({ db, razorpay, orderId: o.id, guestToken: o.guestToken })).razorpayOrderId;
  const r = await verifyCheckout({ db, keySecret: KEY, body: { razorpay_order_id: rp, razorpay_payment_id: payId, razorpay_signature: sign(rp, payId) } });
  return r.order;
};
const admin = { sub: 'a1', email: 'owner@x.com', role: 'owner' };
const settings = { legalName: 'Printxyz', address: '{{BUSINESS_ADDRESS}}', email: '', phone: '', terms: 't' };

test('billing: financial year runs April to March in IST', () => {
  assert.equal(financialYear(new Date('2026-04-01T00:00:00+05:30')), '2026-27');
  assert.equal(financialYear(new Date('2026-03-31T23:59:00+05:30')), '2025-26');
  assert.equal(financialYear(new Date('2027-01-15T10:00:00Z')), '2026-27');
});
test('billing: amount in words uses Indian numbering', () => {
  assert.equal(amountInWords(179900), 'One Thousand Seven Hundred Ninety Nine Rupees Only');
  assert.equal(amountInWords(12345600), 'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only');
  assert.equal(amountInWords(10050), 'One Hundred Rupees and Fifty Paise Only');
  assert.equal(amountInWords(0), 'Zero Rupees Only');
});
test('invoice: only after payment, idempotent, gapless sequence, immutable', async () => {
  const { db, razorpay } = await setup();
  const unpaid = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }] } });
  await assert.rejects(issueInvoice({ db, order: unpaid, settings }), (e) => e.code === 'NOT_PAID');
  const o1 = await paidOrder(db, razorpay, undefined, 'pay_1'); const o2 = await paidOrder(db, razorpay, undefined, 'pay_2');
  const now = new Date('2026-06-01T10:00:00Z');
  const a = await issueInvoice({ db, order: o1, settings, now }); const again = await issueInvoice({ db, order: o1, settings, now });
  const b = await issueInvoice({ db, order: o2, settings, now });
  assert.equal(a.number, 'PX/2026-27/0001'); assert.equal(again.number, a.number); assert.equal(b.number, 'PX/2026-27/0002');
  assert.equal(await db.collection('invoices').countDocuments({ type: 'invoice' }), 2);
  assert.equal((await db.collection('orders').findOne({ id: o1.id })).invoiceNumber, a.number);
});
test('invoice: concurrent issue for one order yields exactly one invoice number', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const res = await Promise.all(Array.from({ length: 10 }, () => issueInvoice({ db, order: o, settings })));
  assert.equal(await db.collection('invoices').countDocuments({ type: 'invoice' }), 1);
  assert.ok(res.filter(Boolean).every((d) => d.number === 'PX/2026-27/0001' || /^PX\/\d{4}-\d{2}\/0001$/.test(d.number)));
});
test('invoice: no GST wording anywhere, values escaped, GST mode refuses instead of half-working', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const inv = await issueInvoice({ db, order: o, settings });
  const html = renderDocumentHtml(inv);
  assert.ok(!/gst|cgst|sgst|igst|tax/i.test(html + JSON.stringify(inv)));
  assert.ok(!html.includes('<b>Rao</b>') && html.includes('&lt;b&gt;Rao'));
  assert.match(html, /Invoice PX\//);
  await db.collection('settings').insertOne({ _id: 'business', gstEnabled: true });
  assert.equal((await getBusinessSettings(db, null)).gst.enabled, false);   // GST on without a valid GSTIN never produces a tax invoice
});
test('receipt: one per payment id', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const r1 = await issueReceipt({ db, order: o, paymentId: 'pay_1', amountPaise: 179900, settings });
  const r2 = await issueReceipt({ db, order: o, paymentId: 'pay_1', amountPaise: 179900, settings });
  assert.match(r1.number, /^RCP-\d{4}-0001$/); assert.equal(r1.number, r2.number);
});

test('refund: reason required, cannot exceed paid amount, reserves amount atomically', async () => {
  const { db, razorpay, refunds } = await setup(); const o = await paidOrder(db, razorpay);
  await assert.rejects(createRefund({ db, razorpay, orderId: o.id, reason: '', actor: admin }), (e) => e.code === 'REASON_REQUIRED');
  await assert.rejects(createRefund({ db, razorpay, orderId: o.id, amountPaise: 999999, reason: 'damaged', actor: admin }), (e) => e.code === 'REFUND_EXCEEDS');
  await assert.rejects(createRefund({ db, razorpay, orderId: o.id, amountPaise: 1.5, reason: 'damaged', actor: admin }), (e) => e.code === 'INVALID_AMOUNT');
  const results = await Promise.allSettled([1, 2, 3].map(() => createRefund({ db, razorpay, orderId: o.id, reason: 'damaged item', actor: admin })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(refunds.length, 1); assert.equal(refunds[0].body.amount, 179900);
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'refund_processing');
  assert.equal(await db.collection('audit_logs').countDocuments({ action: 'refund_requested' }), 1);
});
test('refund: provider failure releases the reservation and refunds nothing', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const failing = { ...razorpay, payments: { refund: async () => { throw { error: { description: 'nope' } }; } } };
  await assert.rejects(createRefund({ db, razorpay: failing, orderId: o.id, reason: 'damaged', actor: admin }), (e) => e.code === 'REFUND_FAILED');
  assert.equal((await db.collection('orders').findOne({ id: o.id })).refundReservedPaise, 0);
  const ok = await createRefund({ db, razorpay, orderId: o.id, amountPaise: 50000, reason: 'partial', actor: admin });
  assert.equal(ok.status, 'processing');
});
test('refund: webhook completes it, issues one credit note, updates payment status, ignores duplicates', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const rf = await createRefund({ db, razorpay, orderId: o.id, amountPaise: 50000, reason: 'partial', actor: admin });
  const ev = (id) => ({ event: 'refund.processed', payload: { refund: { entity: { id: rf.razorpayRefundId, payment_id: 'pay_1', amount: 50000 } } } });
  const r1 = await handleWebhookEvent({ db, payload: ev(), eventId: 'e1' });
  const r2 = await handleWebhookEvent({ db, payload: ev(), eventId: 'e2' });
  assert.match(r1.creditNote, /^CN\/\d{4}-\d{2}\/0001$/); assert.equal(r2.duplicate, true);
  assert.equal(await db.collection('invoices').countDocuments({ type: 'credit_note' }), 1);
  const fresh = await db.collection('orders').findOne({ id: o.id });
  assert.equal(fresh.paymentStatus, 'partially_refunded'); assert.equal(fresh.refundedPaise, 50000);
});
test('refund: a refund made in the Razorpay dashboard is recorded with a credit note', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay);
  const w = await handleWebhookEvent({ db, payload: { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_dash', payment_id: 'pay_1', amount: 179900 } } } }, eventId: 'ed' });
  assert.equal(w.full, true); assert.ok(w.creditNote);
  assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'refunded');
});

const customItems = [{ productId: 'p1', quantity: 1, options: { photos: ['printxyz/customer-photos/a'] } }];
const previewReady = async (db, o) => db.collection('orders').updateOne({ _id: o._id }, { $set: { customPreviewStatus: 'preview-ready' } });
test('approval: only orders with photos need a preview; others are not-required', async () => {
  const { db, razorpay } = await setup();
  assert.equal((await paidOrder(db, razorpay, undefined, 'pay_a')).customPreviewStatus, 'not-required');
  assert.equal((await paidOrder(db, razorpay, customItems, 'pay_b')).customPreviewStatus, 'pending');
});
test('approval: owner or token holder can approve; strangers cannot; only when a preview is waiting', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay, customItems);
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'approve' }), (e) => e.code === 'NO_PREVIEW_PENDING');
  await previewReady(db, o);
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: 'nope', action: 'approve' }), (e) => e.code === 'ORDER_NOT_FOUND');
  assert.equal((await respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'approve' })).decision, 'approved');
  assert.equal((await db.collection('orders').findOne({ id: o.id })).customPreviewStatus, 'approved');
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'approve' }), (e) => e.code === 'NO_PREVIEW_PENDING');
});
test('approval: change requests need a note and are limited', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay, customItems);
  await previewReady(db, o);
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'request_changes', note: 'x' }), (e) => e.code === 'NOTE_REQUIRED');
  for (let i = 0; i < MAX_REVISIONS; i++) {
    await respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'request_changes', note: 'make the nose smaller' });
    await previewReady(db, o);
  }
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'request_changes', note: 'once more please' }), (e) => e.code === 'REVISION_LIMIT');
  await assert.rejects(respondToPreview({ db, orderId: o.id, guestToken: o.guestToken, action: 'dance' }), (e) => e.code === 'INVALID_ACTION');
});
test('retention: photos deleted only for finished orders past the retention period, once', async () => {
  const { db, razorpay } = await setup(); const o = await paidOrder(db, razorpay, customItems);
  const destroyed = []; const cloudinary = { destroy: async (id) => { destroyed.push(id); } };
  const later = new Date(Date.now() + 100 * 86_400_000);
  assert.equal(await purgeExpiredPhotos({ db, cloudinary, now: later }), 0);          // confirmed, not finished
  await db.collection('orders').updateOne({ _id: o._id }, { $set: { status: 'completed' } });
  assert.equal(await purgeExpiredPhotos({ db, cloudinary, now: new Date() }), 0);     // too recent
  assert.equal(await purgeExpiredPhotos({ db, cloudinary, now: later }), 1);
  assert.equal(await purgeExpiredPhotos({ db, cloudinary, now: later }), 0);          // not repeated
  assert.deepEqual(destroyed, ['printxyz/customer-photos/a']);
});
