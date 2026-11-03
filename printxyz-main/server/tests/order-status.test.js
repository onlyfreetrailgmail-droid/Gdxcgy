import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { planStatusUpdate, applyStatusUpdate } from '../src/modules/orders/orderStatus.js';

const base = (o = {}) => ({ _id: 'o1', id: 'PX-2026-0001', status: 'confirmed', paymentStatus: 'paid', productionStatus: 'awaiting-approval', shippingStatus: 'pending', customPreviewStatus: 'not-required', trackingNumber: '', statusHistory: [], ...o });
const actor = { sub: 'a1', email: 'admin@x.com' };
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('status: valid forward transitions pass, skipping steps is rejected', () => {
  assert.equal(planStatusUpdate(base(), { production_status: 'approved' }).changes.length, 1);
  assert.equal(code(() => planStatusUpdate(base(), { production_status: 'printing' })), 'INVALID_TRANSITION');
  assert.equal(code(() => planStatusUpdate(base(), { shipping_status: 'delivered' })), 'INVALID_TRANSITION');
  assert.equal(code(() => planStatusUpdate(base({ status: 'cancelled' }), { status: 'confirmed' })), 'INVALID_TRANSITION');
});
test('status: payment status cannot be set by hand; unpaid orders cannot be produced or shipped', () => {
  assert.equal(code(() => planStatusUpdate(base({ paymentStatus: 'pending' }), { payment_status: 'paid' })), 'PAYMENT_STATUS_LOCKED');
  assert.equal(code(() => planStatusUpdate(base({ paymentStatus: 'pending' }), { production_status: 'approved' })), 'PAYMENT_REQUIRED');
  assert.equal(code(() => planStatusUpdate(base({ paymentStatus: 'pending', shippingStatus: 'pending' }), { shipping_status: 'shipped' })), 'PAYMENT_REQUIRED');
});
test('status: tracking URL must be https; text fields trimmed', () => {
  assert.equal(code(() => planStatusUpdate(base(), { tracking_url: 'javascript:alert(1)' })), 'INVALID_INPUT');
  assert.equal(planStatusUpdate(base(), { tracking_number: '  AWB1 ' }).set.trackingNumber, 'AWB1');
});
test('status: every applied change is written to the audit log with actor, from, to and reason', async () => {
  const db = createFakeDb(); await db.collection('orders').insertOne(base());
  const res = await applyStatusUpdate({ db, order: base(), body: { production_status: 'approved', reason: 'photo ok' }, actor });
  assert.equal(res.changed, true);
  const [log] = await db.collection('audit_logs').find({}).toArray();
  assert.equal(log.actorEmail, 'admin@x.com'); assert.equal(log.reason, 'photo ok');
  assert.deepEqual(log.changes[0], { field: 'production_status', from: 'awaiting-approval', to: 'approved' });
  assert.equal((await db.collection('orders').findOne({ _id: 'o1' })).productionStatus, 'approved');
});
test('status: concurrent stale update is rejected, not silently applied', async () => {
  const db = createFakeDb(); await db.collection('orders').insertOne(base());
  await applyStatusUpdate({ db, order: base(), body: { production_status: 'approved' }, actor });
  await assert.rejects(applyStatusUpdate({ db, order: base(), body: { production_status: 'approved' }, actor }), (e) => ['CONFLICT', 'INVALID_TRANSITION'].includes(e.code));
  assert.equal(await db.collection('audit_logs').countDocuments({}), 1);
});
test('status: invalid transition writes no audit entry and changes nothing', async () => {
  const db = createFakeDb(); await db.collection('orders').insertOne(base());
  await assert.rejects(applyStatusUpdate({ db, order: base(), body: { shipping_status: 'delivered' }, actor }));
  assert.equal(await db.collection('audit_logs').countDocuments({}), 0);
});

test('status: custom orders cannot enter production until the customer approves the preview', () => {
  for (const s of ['pending', 'preview-ready', 'changes-requested']) {
    assert.equal(code(() => planStatusUpdate(base({ customPreviewStatus: s }), { production_status: 'approved' })), 'APPROVAL_REQUIRED', s);
  }
  assert.equal(planStatusUpdate(base({ customPreviewStatus: 'approved' }), { production_status: 'approved' }).changes.length, 1);
});
