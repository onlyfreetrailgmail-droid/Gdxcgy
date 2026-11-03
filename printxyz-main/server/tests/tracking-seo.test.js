import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './helpers/fakeDb.js';
import { loadEnv } from '../src/config/env.js';
import { createOrder } from '../src/modules/orders/orderService.js';
import { sanitizeAttribution } from '../src/modules/tracking/attribution.js';
import { buildPurchaseEvent, sendMetaPurchase, trackingHealth, purchaseEventId } from '../src/modules/tracking/meta.js';
import { buildRobots, buildSitemap, productJsonLd, safeJson, renderSharePage } from '../src/modules/seo/seo.js';

const customer = { name: 'Asha Rao', email: 'Asha@Example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const config = { publicSiteUrl: 'https://printxyz.in', meta: { pixelId: '123456', accessToken: 'SECRET_TOKEN', testEventCode: '' } };
const attribution = { utm_source: 'instagram', utm_campaign: 'diwali', fbclid: 'abc123', fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.abc123' };

const setup = async () => {
  const db = createFakeDb({ unique: { tracking_events: ['eventId'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 5, image: 'i' });
  return db;
};
const paidOrder = async (db, extra = {}) => {
  const o = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 2 }], marketingConsent: true, attribution, ...extra }, client: { ip: '1.2.3.4', userAgent: 'UA' } });
  await db.collection('orders').updateOne({ _id: o._id }, { $set: { paymentStatus: 'paid', status: 'confirmed', paidAt: new Date('2026-10-31T10:00:00Z'), paidAmountPaise: o.totalPaise } });
  return db.collection('orders').findOne({ _id: o._id });
};
const okFetch = () => { const calls = []; const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({}) }; }; f.calls = calls; return f; };

test('attribution: only whitelisted, bounded, valid fields survive', () => {
  const out = sanitizeAttribution({ ...attribution, utm_medium: '<script>x</script>', evil: 'yes', fbp: 'nonsense', landing: 'https://evil.com', referrer: 'javascript:alert(1)' });
  assert.equal(out.utm_source, 'instagram'); assert.equal(out.fbc, attribution.fbc);
  assert.ok(!('evil' in out) && !('fbp' in out) && !('landing' in out) && !('referrer' in out));
  assert.ok(!out.utm_medium.includes('<'));
  assert.deepEqual(sanitizeAttribution(null), {}); assert.deepEqual(sanitizeAttribution('x'), {});
});

test('order: attribution and consent are frozen; IP and user agent kept only with consent', async () => {
  const db = await setup();
  const yes = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }], marketingConsent: true, attribution }, client: { ip: '1.2.3.4', userAgent: 'UA' } });
  assert.equal(yes.marketingConsent, true); assert.equal(yes.attribution.utm_campaign, 'diwali'); assert.equal(yes.clientIp, '1.2.3.4');
  const no = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }], marketingConsent: 'true', attribution }, client: { ip: '1.2.3.4', userAgent: 'UA' } });
  assert.equal(no.marketingConsent, false); assert.equal(no.clientIp, ''); assert.equal(no.clientUserAgent, '');
});

test('purchase event: hashed identifiers, shared event_id, server-computed value', async () => {
  const db = await setup(); const order = await paidOrder(db);
  const ev = buildPurchaseEvent({ order, siteUrl: config.publicSiteUrl });
  assert.equal(ev.event_name, 'Purchase'); assert.equal(ev.event_id, `purchase_${order.id}`); assert.equal(ev.event_id, purchaseEventId(order.id));
  assert.deepEqual(ev.user_data.em, [sha('asha@example.com')]); assert.deepEqual(ev.user_data.ph, [sha('919876543210')]);
  assert.deepEqual(ev.user_data.ct, [sha('patna')]); assert.equal(ev.user_data.fbc, attribution.fbc);
  assert.equal(ev.custom_data.value, 3598); assert.equal(ev.custom_data.currency, 'INR'); assert.equal(ev.custom_data.num_items, 2);
  const raw = JSON.stringify(ev);
  assert.ok(!raw.includes('asha@example.com') && !raw.includes('9876543210') && !raw.includes('Patna'));
  assert.equal(ev.event_time, Math.floor(new Date('2026-10-31T10:00:00Z').getTime() / 1000));
});

test('purchase send: token stays out of the URL, test code passes through', async () => {
  const db = await setup(); const order = await paidOrder(db); const f = okFetch();
  const r = await sendMetaPurchase({ db, order, config: { ...config, meta: { ...config.meta, testEventCode: 'TEST1' } }, fetchImpl: f });
  assert.equal(r.sent, true); assert.equal(f.calls.length, 1);
  assert.ok(!f.calls[0].url.includes('SECRET_TOKEN')); assert.ok(f.calls[0].url.includes('/123456/events'));
  assert.equal(f.calls[0].body.access_token, 'SECRET_TOKEN'); assert.equal(f.calls[0].body.test_event_code, 'TEST1');
});

test('purchase send: unpaid, no-consent and unconfigured orders never reach Meta', async () => {
  const db = await setup(); const f = okFetch();
  const pending = await createOrder({ db, input: { customer, items: [{ productId: 'p1', quantity: 1 }], marketingConsent: true, attribution } });
  assert.equal((await sendMetaPurchase({ db, order: pending, config, fetchImpl: f })).reason, 'not_paid');
  const nc = await paidOrder(db, { marketingConsent: false });
  assert.equal((await sendMetaPurchase({ db, order: nc, config, fetchImpl: f })).reason, 'no_consent');
  const ok = await paidOrder(db);
  assert.equal((await sendMetaPurchase({ db, order: ok, config: { publicSiteUrl: 'x', meta: { pixelId: '', accessToken: '' } }, fetchImpl: f })).reason, 'not_configured');
  assert.equal(f.calls.length, 0);
});

test('purchase send: duplicate webhooks send once; an outage is logged and never throws', async () => {
  const db = await setup(); const order = await paidOrder(db); const f = okFetch();
  await sendMetaPurchase({ db, order, config, fetchImpl: f });
  assert.equal((await sendMetaPurchase({ db, order, config, fetchImpl: f })).reason, 'duplicate');
  assert.equal(f.calls.length, 1);
  const db2 = await setup(); const o2 = await paidOrder(db2);
  const r = await sendMetaPurchase({ db: db2, order: o2, config, fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal(r.sent, false);
  const h = await trackingHealth({ db: db2, config });
  assert.equal(h.capiConfigured, true); assert.equal(h.last24h.failed, 1);
});

test('env: only production is indexable; META token is server config', () => {
  assert.equal(loadEnv({ NODE_ENV: 'test' }).seo.allowIndexing, false);
  assert.equal(loadEnv({ NODE_ENV: 'development' }).seo.allowIndexing, false);
  const prod = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@cluster0.mongodb.net/db', JWT_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), CLIENT_URL: 'https://printxyz.in', PUBLIC_SITE_URL: 'https://printxyz.in',
    RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 'k'.repeat(24), RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24), CLOUDINARY_CLOUD_NAME: 'c1', CLOUDINARY_API_KEY: '123456', CLOUDINARY_API_SECRET: 's'.repeat(20), GOOGLE_CLIENT_ID: 'g.apps', RESEND_API_KEY: 're_abcdef', RESEND_FROM_EMAIL: 'a@printxyz.in' };
  assert.equal(loadEnv(prod).seo.allowIndexing, true);
  assert.equal(loadEnv({ ...prod, ALLOW_INDEXING: 'false' }).seo.allowIndexing, false);
  assert.equal(loadEnv({ ...prod, META_PIXEL_ID: '9', META_ACCESS_TOKEN: 't' }).meta.accessToken, 't');
});

test('robots: staging blocks everything; production blocks private pages and lists the sitemap', () => {
  assert.equal(buildRobots({ siteUrl: 'https://s.example', allowIndexing: false }), 'User-agent: *\nDisallow: /\n');
  const r = buildRobots({ siteUrl: 'https://printxyz.in', allowIndexing: true });
  for (const p of ['/admin', '/cart', '/checkout', '/account', '/orders', '/track/', '/search', '/api/']) assert.ok(r.includes(`Disallow: ${p}`), p);
  assert.ok(r.includes('Sitemap: https://printxyz.in/sitemap.xml'));
});

test('sitemap: public canonical URLs only, no duplicates, unpublished and private pages excluded', () => {
  const xml = buildSitemap({ siteUrl: 'https://printxyz.in', categories: [{ slug: 'lithophanes' }],
    products: [{ slug: 'lamp', createdAt: '2026-10-01T00:00:00Z' }, { slug: 'hidden', published: false }, { slug: 'lamp' }, { slug: 'a&b' }] });
  assert.ok(xml.includes('<loc>https://printxyz.in/product/lamp</loc><lastmod>2026-10-01</lastmod>'));
  assert.ok(!xml.includes('hidden')); assert.equal(xml.split('/product/lamp<').length - 1, 1);
  assert.ok(xml.includes('/product/a%26b')); assert.ok(xml.includes('/category/lithophanes')); assert.ok(xml.includes('/faq') && xml.includes('/size-guide') && xml.includes('/care'));
  for (const p of ['/cart', '/checkout', '/account', '/orders', '/track', '/search', '/admin']) assert.ok(!xml.includes(`.in${p}`), p);
});

test('product JSON-LD: INR offer and stock from catalogue; no invented ratings', () => {
  const ld = productJsonLd({ siteUrl: 'https://printxyz.in', product: { id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 0, image: '/lamp.jpg', rating: 4.9, reviews: 128, category: 'Decor' } });
  assert.equal(ld.offers.priceCurrency, 'INR'); assert.equal(ld.offers.price, '1799.00'); assert.equal(ld.offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(ld.offers.url, 'https://printxyz.in/product/lamp'); assert.deepEqual(ld.image, ['https://printxyz.in/lamp.jpg']);
  assert.ok(!('aggregateRating' in ld) && !('review' in ld));
  assert.equal(productJsonLd({ siteUrl: 'https://printxyz.in', product: { id: 'p', slug: 's', title: 't', price: 1, stock: 3 } }).offers.availability, 'https://schema.org/InStock');
});

test('share page: HTML and JSON-LD cannot be broken out of; noindex honoured', () => {
  assert.ok(!safeJson({ a: '</script><script>alert(1)</script>' }).includes('</script>'));
  const html = renderSharePage({ siteUrl: 'https://printxyz.in', path: '/product/x', title: '"><img src=x onerror=alert(1)>', description: 'd', image: '/i.jpg', jsonLd: [{ n: '</script>' }], noindex: true });
  assert.ok(!html.includes('<img src=x')); assert.ok(html.includes('rel="canonical" href="https://printxyz.in/product/x"'));
  assert.ok(html.includes('og:image" content="https://printxyz.in/i.jpg"')); assert.ok(html.includes('name="robots" content="noindex"'));
  assert.equal(html.split('</script>').length - 1, 1);
});
