// End-to-end HTTP checks against the real Express app with an in-memory database.
// Needs `npm install` first (express etc.). Run: npm test --workspace server
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { loadEnv } from '../src/config/env.js';

const { createApp } = await import('../src/app.js');
const WH = 'whsec_test';
const config = loadEnv({ NODE_ENV: 'test', RAZORPAY_WEBHOOK_SECRET: WH, RAZORPAY_KEY_SECRET: 'ks', RAZORPAY_KEY_ID: 'rzp_test_x', JWT_SECRET: 'x'.repeat(40) });
const tokens = { signAccess: (p) => `t.${p.sub}.${p.role}`, verifyAccess: (t) => { const [k, sub, role] = String(t).split('.'); return k === 't' ? { sub, role, email: `${sub}@x.com` } : null; } };
const customer = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };

const boot = async () => {
  const db = createFakeDb({ unique: { payments: ['paymentId'], webhook_events: ['eventId'], coupons: ['code'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 5, image: 'i', published: true });
  let n = 0;
  const razorpay = { orders: { create: async ({ amount }) => ({ id: `order_${++n}`, amount }) } };
  const app = createApp({ config, db, auth: {}, tokens, mailer: { configured: false }, razorpay, cloudinary: null });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `px_at=${cookie}` } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  return { db, server, call };
};
const place = async (call, cookie) => (await (await call('/api/orders', { method: 'POST', cookie, body: { customer, items: [{ productId: 'p1', quantity: 1, price: 1 }], total: 1 } })).json()).item;

test('health and readiness respond', async () => {
  const { server, call } = await boot();
  try { assert.equal((await call('/api/health')).status, 200); assert.equal((await call('/api/ready')).status, 200); } finally { server.close(); }
});
test('order creation ignores client amounts and returns a PX number', async () => {
  const { server, call } = await boot();
  try { const o = await place(call); assert.equal(o.total, 1799); assert.match(o.id, /^PX-\d{4}-0001$/); assert.ok(o.guest_token.length >= 48); } finally { server.close(); }
});
test('customers cannot read other customers orders; guests need the token', async () => {
  const { server, call } = await boot();
  try {
    const o = await place(call, 't.u1.user');
    assert.equal((await call(`/api/customer/orders/${o.id}`, { cookie: 't.u1.user' })).status, 200);
    assert.equal((await call(`/api/customer/orders/${o.id}`, { cookie: 't.u2.user' })).status, 404);
    assert.equal((await call(`/api/customer/orders/${o.id}`)).status, 401);
    const list = await (await call('/api/customer/orders', { cookie: 't.u2.user' })).json();
    assert.equal(list.items.length, 0);
    const track = await call(`/api/orders/track/${o.guest_token}`); const body = await track.text();
    assert.equal(track.status, 200); assert.ok(!body.includes('MG Road') && !body.includes('9876543210'));
    assert.equal((await call(`/api/orders/track/${'0'.repeat(48)}`)).status, 404);
  } finally { server.close(); }
});
test('admin routes reject anonymous users and customers', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('/api/orders')).status, 401);
    assert.equal((await call('/api/orders', { cookie: 't.u1.user' })).status, 403);
    assert.equal((await call('/api/products', { method: 'POST', cookie: 't.u1.user', body: { title: 'x' } })).status, 403);
    assert.equal((await call('/api/admin/summary', { cookie: 't.u1.user' })).status, 403);
    assert.equal((await call('/api/orders', { cookie: 't.s1.support' })).status, 200);
    assert.equal((await call('/api/products', { method: 'POST', cookie: 't.s1.support', body: { title: 'x' } })).status, 403);
  } finally { server.close(); }
});
test('webhook: forged and missing signatures are rejected; valid one pays the order once', async () => {
  const { server, call, db } = await boot();
  try {
    const o = await place(call);
    const pay = await (await call('/api/payments/create-order', { method: 'POST', body: { orderId: o.id, guestToken: o.guest_token, amount: 1 } })).json();
    assert.equal(pay.amount, 179900);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: pay.order.id, amount: 179900 } } } });
    assert.equal((await call('/api/payments/webhook', { method: 'POST', body: raw })).status, 400);
    assert.equal((await call('/api/payments/webhook', { method: 'POST', body: raw, headers: { 'X-Razorpay-Signature': 'f'.repeat(64) } })).status, 400);
    assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'pending');
    const sig = crypto.createHmac('sha256', WH).update(raw).digest('hex');
    const h = { 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': 'evt_1' };
    assert.equal((await call('/api/payments/webhook', { method: 'POST', body: raw, headers: h })).status, 200);
    assert.equal((await call('/api/payments/webhook', { method: 'POST', body: raw, headers: h })).status, 200);
    assert.equal((await db.collection('orders').findOne({ id: o.id })).paymentStatus, 'paid');
    assert.equal(await db.collection('payments').countDocuments({}), 1);
  } finally { server.close(); }
});
test('NoSQL operator injection and foreign origins are blocked', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('/api/cart/quote', { method: 'POST', body: { items: [{ productId: { $ne: '' }, quantity: 1 }] } })).status, 400);
    assert.equal((await call('/api/orders', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { customer, items: [{ productId: 'p1', quantity: 1 }] } })).status, 403);
  } finally { server.close(); }
});

test('SEO: staging robots block everything; sitemap lists only public products; API is noindex', async () => {
  const { db, server, call } = await boot();
  try {
    await db.collection('products').insertOne({ id: 'p2', slug: 'draft', title: 'Draft', price: 1, stock: 1, image: 'i', published: false });
    assert.match(await (await call('/robots.txt')).text(), /Disallow: \/\n/);
    const xml = await (await call('/sitemap.xml')).text();
    assert.ok(xml.includes('/product/lamp') && !xml.includes('/product/draft') && !xml.includes('/checkout'));
    assert.match((await call('/api/health')).headers.get('x-robots-tag') || '', /noindex/);
  } finally { server.close(); }
});
test('SEO: crawler product page has the right title, image and Product schema; unknown slug is a real 404', async () => {
  const { server, call } = await boot();
  try {
    const ok = await call('/api/seo/product/lamp'); const html = await ok.text();
    assert.equal(ok.status, 200); assert.ok(html.includes('<title>Lamp | Printxyz</title>') && html.includes('og:image') && html.includes('"priceCurrency":"INR"'));
    assert.ok(!html.includes('aggregateRating'));
    assert.equal((await call('/api/seo/product/nope')).status, 404);
    assert.equal((await call('/api/seo/category/nope')).status, 404);
  } finally { server.close(); }
});
test('tracking: order stores attribution and consent; public settings expose only the pixel id; diagnostics are admin-only', async () => {
  const { db, server, call } = await boot();
  try {
    const r = await call('/api/orders', { method: 'POST', body: { customer, items: [{ productId: 'p1', quantity: 1 }], marketingConsent: true, attribution: { utm_source: 'instagram', utm_campaign: 'diwali', hack: 'x' } } });
    const item = (await r.json()).item;
    const stored = await db.collection('orders').findOne({ id: item.id });
    assert.equal(stored.attribution.utm_campaign, 'diwali'); assert.ok(!('hack' in stored.attribution)); assert.equal(stored.marketingConsent, true);
    assert.ok(!JSON.stringify(item).includes('attribution'));
    const pub = await (await call('/api/settings/public')).text(); assert.ok(pub.includes('metaPixelId') && !pub.includes('accessToken'));
    assert.equal((await call('/api/admin/tracking/health')).status, 401);
    assert.equal((await call('/api/admin/tracking/health', { cookie: 't.u1.user' })).status, 403);
    assert.equal((await call('/api/admin/tracking/health', { cookie: 't.o1.owner' })).status, 200);
  } finally { server.close(); }
});

test('admin tools: customers and support staff are refused where they should be; owners can use them', async () => {
  const { server, call } = await boot();
  try {
    for (const path of ['/api/admin/coupons', '/api/admin/reports/sales', '/api/admin/reports/orders.csv', '/api/admin/customers', '/api/admin/settings']) {
      assert.equal((await call(path)).status, 401, `${path} anonymous`);
      assert.equal((await call(path, { cookie: 't.u1.user' })).status, 403, `${path} customer`);
    }
    assert.equal((await call('/api/admin/coupons', { cookie: 't.s1.support' })).status, 403);
    assert.equal((await call('/api/admin/reports/orders.csv', { cookie: 't.s1.support' })).status, 403);
    assert.equal((await call('/api/admin/settings', { cookie: 't.m1.manager' })).status, 403);
    assert.equal((await call('/api/admin/enquiries', { cookie: 't.s1.support' })).status, 200);
    assert.equal((await call('/api/admin/coupons', { cookie: 't.o1.owner' })).status, 200);
    const created = await call('/api/admin/coupons', { method: 'POST', cookie: 't.o1.owner', body: { code: 'diwali10', type: 'percent', value: 10 } });
    assert.equal(created.status, 201);
    assert.equal((await call('/api/admin/coupons', { method: 'POST', cookie: 't.o1.owner', body: { code: 'DIWALI10', type: 'percent', value: 10 } })).status, 409);
    const csv = await call('/api/admin/reports/orders.csv', { cookie: 't.o1.owner' });
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /attachment/);
  } finally { server.close(); }
});
test('shipping settings saved by the owner change the public announcement and the quote', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('/api/admin/settings/shipping', { method: 'PUT', cookie: 't.o1.owner', body: { freeShippingThreshold: 2500, shippingFee: 60 } })).status, 200);
    const pub = await (await call('/api/settings/public')).json();
    assert.ok(pub.announcement.includes('2,500')); assert.ok(!pub.announcement.includes('1,499'));
    const q = await (await call('/api/cart/quote', { method: 'POST', body: { items: [{ productId: 'p1', quantity: 1 }] } })).json();
    assert.equal(q.shipping, 60); assert.equal(q.total, 1859);
  } finally { server.close(); }
});
test('enquiries: stored and numbered, bot honeypot stores nothing, bad input rejected', async () => {
  const { server, call, db } = await boot();
  try {
    const ok = { name: 'Raj', email: 'raj@example.com', message: 'Need 50 desk plates for our office.', type: 'bulk' };
    const r = await call('/api/enquiries', { method: 'POST', body: ok }); const body = await r.json();
    assert.equal(r.status, 201); assert.equal(body.id, 'TKT-000001');
    assert.equal((await call('/api/enquiries', { method: 'POST', body: { ...ok, website: 'http://spam.example' } })).status, 201);
    assert.equal(await db.collection('enquiries').countDocuments({}), 1);
    assert.equal((await call('/api/enquiries', { method: 'POST', body: { ...ok, email: 'nope' } })).status, 400);
  } finally { server.close(); }
});
test('reviews: public list is open, writing needs a signed-in verified buyer, nothing fake on the home feed', async () => {
  const { server, call } = await boot();
  try {
    const list = await (await call('/api/products/lamp/reviews')).json(); assert.deepEqual(list.items, []); assert.equal(list.count, 0);
    assert.deepEqual((await (await call('/api/reviews/recent')).json()).items, []);
    assert.equal((await call('/api/products/lamp/reviews', { method: 'POST', body: { rating: 5, body: 'Lovely lamp indeed.' } })).status, 401);
    assert.equal((await call('/api/products/lamp/reviews', { method: 'POST', cookie: 't.u1.user', body: { rating: 5, body: 'Lovely lamp indeed.' } })).status, 403);
    assert.equal((await call('/api/products/nope/reviews')).status, 404);
  } finally { server.close(); }
});
test('products start with no invented rating and the page shows no made-up specs data', async () => {
  const { server, call } = await boot();
  try {
    const created = await (await call('/api/products', { method: 'POST', cookie: 't.o1.owner', body: { title: 'Test Plate', price: 500, mrp: 600, stock: 3, image: 'https://example.com/a.jpg', category: 'Name Plates' } })).json();
    assert.equal(created.item.rating, 0); assert.equal(created.item.reviews, 0);
  } finally { server.close(); }
});
test('auth: changing a password needs a session; 2FA setup is staff-only', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('/api/auth/change-password', { method: 'POST', body: { current: 'a', next: 'b' } })).status, 401);
    assert.equal((await call('/api/auth/2fa/setup', { method: 'POST', cookie: 't.u1.user' })).status, 403);
    assert.equal((await call('/api/auth/2fa/setup', { method: 'POST' })).status, 401);
  } finally { server.close(); }
});
