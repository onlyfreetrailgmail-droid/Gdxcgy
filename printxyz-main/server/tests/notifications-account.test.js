import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { verifySvix } from '../src/utils/svix.js';
import { renderEmail, TEMPLATE_NAMES } from '../src/modules/notifications/templates.js';
import { enqueueEmail, processQueue, retryFailed, queueStats, handleMailEvent, maybeEnqueueAbandoned, unsubscribeToken, verifyUnsubscribeToken, MAX_ATTEMPTS } from '../src/modules/notifications/queue.js';
import { createOrder, expireStaleOrders, PAYMENT_WINDOW_MS } from '../src/modules/orders/orderService.js';
import * as acct from '../src/modules/account/accountService.js';

const SECRET = 's'.repeat(40); const SITE = 'https://www.printxyz.in';
const mkdb = () => createFakeDb({ unique: { email_queue: ['key'], email_suppressions: ['email'], webhook_events: ['eventId'], users: ['email'] } });
const mailerOk = (log = []) => ({ configured: true, send: async (m) => { log.push(m); return { ok: true, status: 200, id: `re_${log.length}` }; } });
const run = (db, mailer, now = new Date()) => processQueue({ db, mailer, siteUrl: SITE, secret: SECRET, now });
const data = { name: 'Asha <script>', orderId: 'PX-2026-0001', amount: 1799, trackToken: 'tok123', invoiceUrl: 'https://x/i' };

test('svix: valid signature passes; tampered body, wrong secret, stale timestamp and missing headers fail', () => {
  const secret = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`; const body = Buffer.from('{"type":"email.delivered"}');
  const ts = String(Math.floor(Date.now() / 1000)); const id = 'msg_1';
  const sig = crypto.createHmac('sha256', Buffer.from('k'.repeat(24))).update(`${id}.${ts}.`).update(body).digest('base64');
  const h = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
  assert.equal(verifySvix({ rawBody: body, headers: h, secret }), true);
  assert.equal(verifySvix({ rawBody: body, headers: { ...h, 'svix-signature': `v1,AAAA v1,${sig}` }, secret }), true);
  assert.equal(verifySvix({ rawBody: Buffer.from('{"type":"x"}'), headers: h, secret }), false);
  assert.equal(verifySvix({ rawBody: body, headers: h, secret: `whsec_${Buffer.from('z'.repeat(24)).toString('base64')}` }), false);
  assert.equal(verifySvix({ rawBody: body, headers: h, secret, now: Date.now() + 10 * 60_000 }), false);
  assert.equal(verifySvix({ rawBody: body, headers: { 'svix-id': id }, secret }), false);
  assert.equal(verifySvix({ rawBody: body, headers: h, secret: '' }), false);
});

test('templates: every template renders, escapes input, builds links only from our site, has no tax wording', () => {
  for (const name of TEMPLATE_NAMES) {
    const m = renderEmail(name, { ...data, trackingUrl: 'javascript:alert(1)', previewUrl: 'https://p', note: '<img onerror=x>', itemsSummary: 'Lamp x1' }, { siteUrl: SITE, unsubscribeUrl: '' });
    assert.ok(m.subject && m.html.includes('Print') && m.text, name);
    assert.ok(!m.html.includes('<script>') && !m.html.includes('<img onerror'), name);
    assert.ok(!/javascript:/i.test(m.html), `${name} leaked javascript: URL`);
    assert.ok(!/gst|cgst|sgst|igst|\btax\b/i.test(m.html + m.text), name);
  }
  assert.ok(renderEmail('order_paid', data, { siteUrl: SITE }).html.includes(`${SITE}/track/tok123`));
  assert.ok(renderEmail('abandoned_cart', data, { siteUrl: SITE, unsubscribeUrl: `${SITE}/u` }).html.includes('Unsubscribe'));
  assert.throws(() => renderEmail('nope', {}, { siteUrl: SITE }));
});

test('queue: idempotent enqueue; sends once; transactional email carries no unsubscribe link', async () => {
  const db = mkdb(); const log = [];
  assert.equal((await enqueueEmail({ db, to: 'A@x.com', template: 'order_paid', key: 'k1', data })).queued, true);
  assert.equal((await enqueueEmail({ db, to: 'a@x.com', template: 'order_paid', key: 'k1', data })).duplicate, true);
  assert.equal((await run(db, mailerOk(log))).sent, 1);
  assert.equal((await run(db, mailerOk(log))).sent, 0);
  assert.equal(log.length, 1); assert.deepEqual(log[0].to, 'a@x.com'); assert.ok(!log[0].headers);
});
test('queue: provider outage keeps the job, retries with backoff, fails after the bound, and can be re-queued', async () => {
  const db = mkdb(); const down = { configured: true, send: async () => ({ ok: false, status: 503 }) };
  let now = new Date('2026-11-01T10:00:00Z');
  await enqueueEmail({ db, to: 'a@x.com', template: 'order_paid', key: 'k1', data, now });   // use the test clock, not the wall clock
  const r1 = await run(db, down, now); assert.equal(r1.retried, 1);
  assert.equal((await run(db, down, now)).retried, 0);                       // not due yet
  for (let i = 1; i < MAX_ATTEMPTS; i++) { now = new Date(now.getTime() + 2 ** 6 * 60_000); await run(db, down, now); }
  assert.equal((await queueStats({ db })).failed, 1);
  assert.equal(await retryFailed({ db, now }), 1);
  const log = []; assert.equal((await run(db, mailerOk(log), now)).sent, 1);
});
test('queue: unconfigured email leaves jobs waiting instead of burning attempts', async () => {
  const db = mkdb(); await enqueueEmail({ db, to: 'a@x.com', template: 'order_paid', key: 'k1', data });
  await run(db, { configured: false });
  const [j] = await db.collection('email_queue').find({}).toArray(); assert.equal(j.status, 'pending'); assert.equal(j.attempts, 0);
});
test('queue: reminders respect opt-out, marketing needs opt-in, suppressed addresses never get mail, transactional still flows', async () => {
  const db = mkdb(); const log = [];
  await db.collection('email_prefs').insertOne({ email: 'out@x.com', optOut: true });
  await enqueueEmail({ db, to: 'out@x.com', template: 'abandoned_cart', key: 'r1', category: 'reminder', data });
  await enqueueEmail({ db, to: 'out@x.com', template: 'order_paid', key: 't1', data });
  await enqueueEmail({ db, to: 'new@x.com', template: 'abandoned_cart', key: 'm1', category: 'marketing', data });
  await db.collection('email_suppressions').insertOne({ email: 'bad@x.com' });
  await enqueueEmail({ db, to: 'bad@x.com', template: 'order_paid', key: 't2', data });
  const r = await run(db, mailerOk(log));
  assert.equal(r.sent, 1); assert.equal(r.suppressed, 3); assert.equal(log[0].subject.startsWith('Payment received'), true);
});
test('queue: reminders include a working unsubscribe link; tokens cannot be forged', async () => {
  const db = mkdb(); const log = [];
  await enqueueEmail({ db, to: 'a@x.com', template: 'abandoned_cart', key: 'r1', category: 'reminder', data });
  await run(db, mailerOk(log));
  const url = log[0].headers['List-Unsubscribe'].slice(1, -1); const u = new URL(url);
  assert.equal(verifyUnsubscribeToken(u.searchParams.get('e'), u.searchParams.get('t'), SECRET), true);
  assert.equal(verifyUnsubscribeToken('other@x.com', u.searchParams.get('t'), SECRET), false);
  assert.equal(verifyUnsubscribeToken('a@x.com', unsubscribeToken('a@x.com', 'wrong'), SECRET), false);
});
test('mail events: complaints and permanent bounces suppress; soft bounces do not; duplicates ignored', async () => {
  const db = mkdb(); const log = [];
  await enqueueEmail({ db, to: 'a@x.com', template: 'order_paid', key: 'k1', data }); await run(db, mailerOk(log));
  const ev = (type, extra = {}) => ({ type, data: { email_id: 're_1', to: ['a@x.com'], ...extra } });
  await handleMailEvent({ db, svixId: 'm1', event: ev('email.bounced', { bounce: { type: 'Transient' } }) });
  assert.equal(await db.collection('email_suppressions').countDocuments({}), 0);
  assert.equal((await handleMailEvent({ db, svixId: 'm1', event: ev('email.bounced') })).duplicate, true);
  await handleMailEvent({ db, svixId: 'm2', event: ev('email.bounced', { bounce: { type: 'Permanent' } }) });
  assert.equal(await db.collection('email_suppressions').countDocuments({ email: 'a@x.com' }), 1);
  await handleMailEvent({ db, svixId: 'm3', event: { type: 'email.complained', data: { to: ['b@x.com'] } } });
  assert.equal(await db.collection('email_suppressions').countDocuments({ email: 'b@x.com' }), 1);
});

const shop = async () => {
  const db = mkdb(); await db.collection('products').insertOne({ id: 'p1', slug: 'l', title: 'Lamp', price: 1799, stock: 9, image: 'i' });
  const customer = { name: 'Asha', email: 'asha@x.com', phone: '9876543210', street: '1 Rd', city: 'Patna', state: 'Bihar', pincode: '800001' };
  return { db, place: (now) => createOrder({ db, now, input: { customer, items: [{ productId: 'p1', quantity: 1 }] } }) };
};
test('abandoned checkout: one reminder after expiry; none after purchase, opt-out, within 7 days; max 3', async () => {
  const { db, place } = await shop(); const t0 = new Date('2026-11-01T10:00:00Z'); const later = new Date(t0.getTime() + PAYMENT_WINDOW_MS + 1000);
  const hook = (n) => (o) => maybeEnqueueAbandoned({ db, order: o, now: n });
  await place(t0);
  assert.equal(await expireStaleOrders({ db, now: later, onExpired: hook(later) }), 1);
  assert.equal(await db.collection('email_queue').countDocuments({ template: 'abandoned_cart' }), 1);
  const o2 = await place(later); assert.equal((await maybeEnqueueAbandoned({ db, order: o2, now: later })).skipped, 'recent');
  const week = new Date(later.getTime() + 8 * 86_400_000);
  await db.collection('orders').insertOne({ id: 'PAID', customerEmail: 'asha@x.com', paymentStatus: 'paid', createdAt: new Date(later.getTime() + 1000) });
  assert.equal((await maybeEnqueueAbandoned({ db, order: o2, now: week })).skipped, 'purchased');
  await db.collection('orders').deleteOne({ id: 'PAID' });
  await db.collection('email_prefs').insertOne({ email: 'asha@x.com', optOut: true });
  assert.equal((await maybeEnqueueAbandoned({ db, order: o2, now: week })).skipped, 'opted_out');
  await db.collection('email_prefs').deleteOne({ email: 'asha@x.com' });
  for (const k of ['a', 'b']) await db.collection('email_queue').insertOne({ _id: k, to: 'asha@x.com', template: 'abandoned_cart', createdAt: new Date(t0.getTime() - 40 * 86_400_000) });
  assert.equal((await maybeEnqueueAbandoned({ db, order: o2, now: week })).skipped, 'limit');
});

const userDb = async () => {
  const db = mkdb(); await db.collection('users').insertOne({ _id: 'u1', id: 'u1', name: 'Asha', email: 'asha@x.com', role: 'user' });
  await db.collection('users').insertOne({ _id: 'u2', id: 'u2', name: 'Bo', email: 'bo@x.com', role: 'user' });
  await db.collection('products').insertOne({ id: 'p1', slug: 'l', title: 'Lamp', price: 1799, stock: 9, image: 'i' });
  return db;
};
const addr = { name: 'Asha', phone: '9876543210', street: '1 Rd', city: 'Patna', state: 'Bihar', pincode: '800001' };
test('account: profile validation', async () => {
  const db = await userDb();
  assert.equal((await acct.updateProfile({ db, userId: 'u1', body: { name: ' New ', phone: '+919876543210', dob: '1990-05-01' } })).name, 'New');
  await assert.rejects(acct.updateProfile({ db, userId: 'u1', body: { phone: '123' } }), /mobile/);
  await assert.rejects(acct.updateProfile({ db, userId: 'u1', body: { dob: '2999-01-01' } }), /past/);
  await assert.rejects(acct.updateProfile({ db, userId: 'u1', body: { name: ' ' } }), /empty/);
  await assert.rejects(acct.getProfile({ db, userId: 'nobody' }), (e) => e.code === 'USER_NOT_FOUND');
});
test('account: addresses are private, first is default, limit enforced, delete moves the default', async () => {
  const db = await userDb();
  const a = await acct.addAddress({ db, userId: 'u1', body: addr }); const b = await acct.addAddress({ db, userId: 'u1', body: { ...addr, label: 'Work' } });
  assert.equal(a.isDefault, true); assert.equal(b.isDefault, false);
  await assert.rejects(acct.addAddress({ db, userId: 'u1', body: { ...addr, pincode: '12' } }), /pincode/);
  assert.equal((await acct.listAddresses({ db, userId: 'u2' })).length, 0);
  await assert.rejects(acct.updateAddress({ db, userId: 'u2', id: a.id, body: addr }), (e) => e.code === 'ADDRESS_NOT_FOUND');
  await assert.rejects(acct.deleteAddress({ db, userId: 'u2', id: a.id }), (e) => e.code === 'ADDRESS_NOT_FOUND');
  await acct.deleteAddress({ db, userId: 'u1', id: a.id });
  assert.equal((await acct.listAddresses({ db, userId: 'u1' }))[0].isDefault, true);
  for (let i = 0; i < acct.MAX_ADDRESSES - 1; i++) await acct.addAddress({ db, userId: 'u1', body: addr });
  await assert.rejects(acct.addAddress({ db, userId: 'u1', body: addr }), (e) => e.code === 'ADDRESS_LIMIT');
});
test('account: wishlist only accepts real products, no duplicates, per user', async () => {
  const db = await userDb();
  await assert.rejects(acct.addToWishlist({ db, userId: 'u1', productId: 'nope' }), (e) => e.code === 'PRODUCT_NOT_FOUND');
  await acct.addToWishlist({ db, userId: 'u1', productId: 'p1' }); await acct.addToWishlist({ db, userId: 'u1', productId: 'p1' });
  assert.deepEqual(await acct.getWishlist({ db, userId: 'u1' }), ['p1']); assert.deepEqual(await acct.getWishlist({ db, userId: 'u2' }), []);
  assert.deepEqual(await acct.removeFromWishlist({ db, userId: 'u1', productId: 'p1' }), []);
});
test('account: preferences default to transactional only; reminders opt-out is shared with the unsubscribe link', async () => {
  const db = await userDb();
  assert.deepEqual(await acct.getPreferences({ db, userId: 'u1' }), { transactional: true, marketing: false, whatsapp: false, reminders: true });
  assert.equal((await acct.updatePreferences({ db, userId: 'u1', body: { marketing: true, reminders: false } })).marketing, true);
  assert.equal((await db.collection('email_prefs').findOne({ email: 'asha@x.com' })).optOut, true);
});
test('account: export contains own data only and never the password hash', async () => {
  const db = await userDb(); await db.collection('users').updateOne({ id: 'u1' }, { $set: { passwordHash: 'SECRETHASH' } });
  await acct.addAddress({ db, userId: 'u1', body: addr });
  const ex = JSON.stringify(await acct.exportData({ db, userId: 'u1' }));
  assert.ok(ex.includes('asha@x.com') && !ex.includes('SECRETHASH') && !ex.includes('bo@x.com'));
});
test('account: deletion needs confirmation, is blocked by open paid orders, then anonymises but keeps orders and invoices', async () => {
  const db = await userDb(); await acct.addAddress({ db, userId: 'u1', body: addr }); await acct.addToWishlist({ db, userId: 'u1', productId: 'p1' });
  const mkOrder = (o) => db.collection('orders').insertOne({ _id: 'o1', id: 'PX-1', userId: 'u1', customerEmail: 'asha@x.com', customer: { name: 'Asha', email: 'asha@x.com', phone: '9876543210', street: '1 Rd', city: 'Patna', state: 'Bihar' }, items: [], totalPaise: 100, paymentStatus: 'paid', status: 'confirmed', guestToken: 'g', ...o });
  await mkOrder({});
  await assert.rejects(acct.deleteAccount({ db, userId: 'u1', confirm: 'yes' }), /DELETE/);
  await assert.rejects(acct.deleteAccount({ db, userId: 'u1', confirm: 'DELETE' }), (e) => e.code === 'OPEN_ORDERS');
  await db.collection('orders').updateOne({ _id: 'o1' }, { $set: { status: 'completed' } });
  await db.collection('invoices').insertOne({ _id: 'i1', type: 'invoice', number: 'PX/2026-27/0001', orderId: 'PX-1' });
  await acct.deleteAccount({ db, userId: 'u1', confirm: 'DELETE' });
  const u = await db.collection('users').findOne({ id: 'u1' }); const o = await db.collection('orders').findOne({ _id: 'o1' });
  assert.ok(u.email.endsWith('@deleted.invalid') && u.role === 'deleted' && u.deletedAt);
  assert.equal(o.customer.email, ''); assert.equal(o.customer.phone, ''); assert.equal(o.customer.city, 'Patna'); assert.notEqual(o.guestToken, 'g'); assert.equal(o.userId, '');
  assert.equal((await db.collection('invoices').findOne({ _id: 'i1' })).number, 'PX/2026-27/0001');
  assert.equal(await db.collection('addresses').countDocuments({ userId: 'u1' }), 0);
  await assert.rejects(acct.getProfile({ db, userId: 'u1' }), (e) => e.code === 'USER_NOT_FOUND');
});
