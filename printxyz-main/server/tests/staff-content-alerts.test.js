process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { loadEnv } from '../src/config/env.js';
import { listStaff, createStaff, changeRole, resetStaffPassword, generateTempPassword } from '../src/modules/staff/staffService.js';
import { validateBanner, createBanner, activeBanners, setHomeSections, getHomeSections, setMaterials, getMaterials } from '../src/modules/content/contentService.js';
import { raiseAlert, runHealthChecks, listAlerts, sendHeartbeat } from '../src/modules/alerts/alerts.js';
import { submitReview, recordReviewUpload, listApproved } from '../src/modules/reviews/reviewService.js';
import { validateAdminPassword } from '../src/config/env.js';

const hasher = { hash: async (p) => `h:${p}`, compare: async (p, h) => h === `h:${p}` };
const owner = { sub: 'u-owner', email: 'o@x.com', role: 'owner' };
const admin = { sub: 'u-admin', email: 'a@x.com', role: 'admin' };
const seedUsers = async (db) => {
  for (const [id, role] of [['u-owner', 'owner'], ['u-admin', 'admin'], ['u-mgr', 'manager'], ['u-cust', 'user']]) await db.collection('users').insertOne({ _id: id, id, email: `${id}@x.com`, name: id, role, createdAt: new Date() });
};

test('staff: temporary passwords meet the staff password rules', () => {
  for (let i = 0; i < 25; i++) assert.deepEqual(validateAdminPassword(generateTempPassword()), []);
});
test('staff: owners create any role, admins only operational roles, nobody creates over an existing email', async () => {
  const db = createFakeDb({ unique: { users: ['email'] } }); await seedUsers(db);
  const r = await createStaff({ db, hasher, actor: owner, body: { name: 'Ravi', email: 'Ravi@x.com', role: 'production' } });
  assert.equal(r.user.email, 'ravi@x.com'); assert.equal(r.user.mustChangePassword, true); assert.ok(r.temporaryPassword.length >= 14);
  assert.equal((await db.collection('users').findOne({ email: 'ravi@x.com' })).passwordHash, `h:${r.temporaryPassword}`);
  await assert.rejects(createStaff({ db, hasher, actor: admin, body: { name: 'X', email: 'x@x.com', role: 'admin' } }), (e) => e.status === 403);
  await assert.rejects(createStaff({ db, hasher, actor: owner, body: { name: 'X', email: 'u-cust@x.com', role: 'support' } }), (e) => e.code === 'EMAIL_EXISTS');
  await assert.rejects(createStaff({ db, hasher, actor: { sub: 'm', role: 'manager' }, body: { name: 'X', email: 'y@x.com', role: 'support' } }), (e) => e.status === 403);
  assert.equal((await listStaff({ db })).length, 4);
});
test('roles: cannot change your own role, cannot remove the last owner, admins cannot touch owners or admins', async () => {
  const db = createFakeDb(); await seedUsers(db);
  await assert.rejects(changeRole({ db, actor: owner, id: 'u-owner', role: 'admin' }), (e) => e.status === 403);
  await db.collection('users').insertOne({ _id: 'u-o2', id: 'u-o2', email: 'o2@x.com', role: 'owner', name: 'o2' });
  await assert.rejects(changeRole({ db, actor: admin, id: 'u-o2', role: 'support' }), (e) => e.status === 403);
  await assert.rejects(changeRole({ db, actor: admin, id: 'u-mgr', role: 'admin' }), (e) => e.status === 403);
  assert.equal((await changeRole({ db, actor: admin, id: 'u-mgr', role: 'support' })).role, 'support');
  assert.equal((await changeRole({ db, actor: owner, id: 'u-o2', role: 'admin' })).role, 'admin');           // another owner exists, fine
  await assert.rejects(changeRole({ db, actor: { sub: 'x', role: 'owner' }, id: 'u-owner', role: 'user' }), (e) => e.code === 'LAST_OWNER');
});
test('roles: changing a role ends that person\'s sessions and is audited; password reset forces a change', async () => {
  const db = createFakeDb(); await seedUsers(db);
  await db.collection('refresh_tokens').insertOne({ userId: 'u-mgr', revoked: false });
  await changeRole({ db, actor: owner, id: 'u-mgr', role: 'user' });
  assert.equal((await db.collection('refresh_tokens').findOne({ userId: 'u-mgr' })).revoked, true);
  assert.equal((await db.collection('audit_logs').findOne({ action: 'change_role' })).targetId, 'u-mgr');
  const r = await resetStaffPassword({ db, hasher, actor: owner, id: 'u-admin' });
  assert.equal((await db.collection('users').findOne({ id: 'u-admin' })).mustChangePassword, true); assert.ok(r.temporaryPassword);
  await assert.rejects(resetStaffPassword({ db, hasher, actor: owner, id: 'u-cust' }), (e) => e.status === 404);
});

test('banners: unsafe links and images are rejected; only live banners show, in order', async () => {
  const ok = { title: 'Diwali', imageDesktop: 'https://res.cloudinary.com/x/a.jpg', link: '/category/devotional' };
  assert.throws(() => validateBanner({ ...ok, link: 'javascript:alert(1)' }), /Link must/);
  assert.throws(() => validateBanner({ ...ok, link: '//evil.com' }), /Link must/);
  assert.throws(() => validateBanner({ ...ok, imageDesktop: 'http://x.com/a.jpg' }), /https/);
  assert.throws(() => validateBanner({ ...ok, imageDesktop: 'data:text/html,<script>' }), /https/);
  assert.throws(() => validateBanner({ ...ok, startsAt: '2026-12-02', endsAt: '2026-12-01' }), /after the start/);
  const db = createFakeDb(); const now = new Date('2026-11-10T00:00:00Z');
  await createBanner({ db, body: { ...ok, title: 'B', position: 2 }, actor: owner });
  await createBanner({ db, body: { ...ok, title: 'A', position: 1 }, actor: owner });
  await createBanner({ db, body: { ...ok, title: 'Off', active: false }, actor: owner });
  await createBanner({ db, body: { ...ok, title: 'Future', startsAt: '2026-12-01' }, actor: owner });
  await createBanner({ db, body: { ...ok, title: 'Ended', endsAt: '2026-11-01' }, actor: owner });
  assert.deepEqual((await activeBanners({ db, now })).map((b) => b.title), ['A', 'B']);
});
test('home sections and material guide: validated, empty by default, nothing invented', async () => {
  const db = createFakeDb();
  assert.deepEqual(await getMaterials({ db }), { intro: '', items: [] });
  assert.deepEqual(await getHomeSections({ db }), ['trending', 'most-loved']);
  await setHomeSections({ db, items: ['bestsellers', 'trending'], actor: owner });
  assert.deepEqual(await getHomeSections({ db }), ['bestsellers', 'trending']);
  await assert.rejects(setHomeSections({ db, items: ['trending', 'trending'], actor: owner }), /different/);
  await assert.rejects(setHomeSections({ db, items: ['<script>'], actor: owner }), /sections/);
  await assert.rejects(setMaterials({ db, body: { items: [{ name: 'PLA' }] }, actor: owner }), /at least one detail/);
  const m = await setMaterials({ db, body: { intro: 'hi', items: [{ name: 'PLA', care: 'Keep away from heat', extra: 'dropped' }, { name: '' }] }, actor: owner });
  assert.equal(m.items.length, 1); assert.equal(m.items[0].extra, undefined);
});

test('alerts: stored, sent once per cooldown, and resolved when healthy', async () => {
  const db = createFakeDb({ unique: { alerts: ['key'] } }); const sent = []; const hooks = [];
  const mailer = { configured: true, send: async (m) => { sent.push(m); return { ok: true }; } };
  const config = { alerts: { email: 'ops@x.com', webhookUrl: 'https://hooks.example/x' } };
  const fetchImpl = async (u, o) => { hooks.push([u, o.body]); return { ok: true }; };
  const t = new Date('2026-11-01T10:00:00Z');
  await raiseAlert({ db, config, mailer, fetchImpl, key: 'k', title: 'Boom <b>', message: 'm', now: t });
  await raiseAlert({ db, config, mailer, fetchImpl, key: 'k', title: 'Boom <b>', message: 'm', now: new Date(t.getTime() + 60_000) });
  assert.equal(sent.length, 1); assert.equal(hooks.length, 1); assert.ok(!sent[0].html.includes('<b>'));          // escaped
  const [a] = await listAlerts({ db }); assert.equal(a.count, 2);
  await raiseAlert({ db, config, mailer, fetchImpl, key: 'k', title: 'Boom', now: new Date(t.getTime() + 2 * 3600_000) });
  assert.equal(sent.length, 2);
  const noChannels = await raiseAlert({ db, config: { alerts: {} }, mailer, key: 'q', title: 'x' });
  assert.equal(noChannels.raised, true); assert.equal(noChannels.notified, false);
});
test('health checks: payment-failure spike, flagged payments and database outage raise alerts; recovery resolves them', async () => {
  const db = createFakeDb({ unique: { alerts: ['key'] } }); const sent = [];
  const mailer = { configured: true, send: async (m) => { sent.push(m.subject); return { ok: true }; } };
  const config = { alerts: { email: 'ops@x.com' } }; const now = new Date();
  for (let i = 0; i < 3; i++) await db.collection('payment_failures').insertOne({ orderId: `o${i}`, at: new Date(now - 60_000) });
  await db.collection('orders').insertOne({ id: 'PX-1', paymentFlag: 'amount_mismatch' });
  const r = await runHealthChecks({ db, config, mailer, pingDb: async () => true, now });
  assert.deepEqual(r.found.sort(), ['payment_failures', 'payment_flagged']); assert.equal(sent.length, 2);
  await db.collection('payment_failures').deleteMany({}); await db.collection('orders').updateOne({ id: 'PX-1' }, { $unset: { paymentFlag: '' } });
  await runHealthChecks({ db, config, mailer, pingDb: async () => true, now });
  assert.deepEqual((await listAlerts({ db, status: 'open' })).map((a) => a.key), []);
  const down = await runHealthChecks({ db, config, mailer, pingDb: async () => { throw new Error('down'); }, now });
  assert.deepEqual(down.found, ['db_down']);
});
test('heartbeat: pings the external monitor only while the database is healthy', async () => {
  const calls = []; const config = { alerts: { heartbeatUrl: 'https://hc.example/ping' } };
  assert.equal((await sendHeartbeat({ config, pingDb: async () => true, fetchImpl: async (u) => calls.push(u) })).sent, true);
  assert.equal((await sendHeartbeat({ config, pingDb: async () => { throw new Error('x'); }, fetchImpl: async (u) => calls.push(u) })).sent, false);
  assert.equal(calls.length, 1); assert.equal((await sendHeartbeat({ config: { alerts: {} }, pingDb: async () => true })).sent, false);
});

test('review photos: only photos this customer uploaded can be attached, once, up to three', async () => {
  const db = createFakeDb({ unique: { reviews: [] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp' });
  await db.collection('users').insertOne({ id: 'u1', name: 'Asha Rao' });
  await db.collection('orders').insertOne({ userId: 'u1', shippingStatus: 'delivered', items: [{ productId: 'p1' }] });
  const base = { db, userId: 'u1', productId: 'p1', rating: 5, body: 'Lovely lamp, great finish.' };
  await recordReviewUpload({ db, userId: 'u1', publicId: 'printxyz/review-photos/a' });
  await recordReviewUpload({ db, userId: 'u2', publicId: 'printxyz/review-photos/theirs' });
  await assert.rejects(submitReview({ ...base, photos: ['printxyz/review-photos/theirs'] }), (e) => e.code === 'INVALID_REVIEW');
  await assert.rejects(submitReview({ ...base, photos: ['printxyz/customer-photos/private'] }), (e) => e.code === 'INVALID_REVIEW');
  await assert.rejects(submitReview({ ...base, photos: ['1', '2', '3', '4'].map((x) => `printxyz/review-photos/${x}`) }), /up to 3/);
  const r = await submitReview({ ...base, photos: [{ publicId: 'printxyz/review-photos/a' }] });
  assert.equal(r.status, 'pending');
  assert.equal((await db.collection('review_uploads').findOne({ publicId: 'printxyz/review-photos/a' })).used, true);
  await db.collection('reviews').updateOne({ _id: r.id }, { $set: { status: 'approved' } });
  assert.deepEqual((await listApproved({ db, productId: 'p1', urlFor: (id) => `https://cdn/${id}` }))[0].photos, ['https://cdn/printxyz/review-photos/a']);
});

test('config: part-payment, return window and alert settings are parsed and bounded', () => {
  const c = loadEnv({ NODE_ENV: 'test', ADVANCE_PERCENT: '999', RETURN_WINDOW_DAYS: '-3', ALERT_EMAIL: 'a@b.com' });
  assert.equal(c.orders.advancePercent, 90); assert.equal(c.orders.returnWindowDays, 0); assert.equal(c.alerts.email, 'a@b.com');
  assert.equal(loadEnv({ NODE_ENV: 'test', ADVANCE_PERCENT: '0' }).orders.advancePercent, 0);
});

test('config: proxy depth and global rate limit are configurable and bounded', () => {
  const c = loadEnv({ NODE_ENV: 'test', TRUST_PROXY_HOPS: '2', RATE_LIMIT_PER_MIN: '5' });
  assert.equal(c.http.trustProxyHops, 2); assert.equal(c.http.globalRatePerMin, 30);
  assert.equal(loadEnv({ NODE_ENV: 'test' }).http.trustProxyHops, 1);
});
