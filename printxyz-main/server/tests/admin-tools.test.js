import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { validateCoupon, createCoupon, updateCoupon, listCoupons } from '../src/modules/coupons/couponService.js';
import { evaluateCoupon } from '../src/modules/pricing/pricing.js';
import { getShippingSettings, updateShippingSettings, getBusinessAdmin, updateBusiness, } from '../src/modules/settings/settings.js';
import { getBusinessSettings } from '../src/modules/billing/billing.js';
import { salesReport, ordersCsv, csvCell, customersReport, lowStock } from '../src/modules/reports/reports.js';
import { submitReview, moderateReview, listApproved, listPending } from '../src/modules/reviews/reviewService.js';
import { createEnquiry, listEnquiries, setEnquiryStatus } from '../src/modules/enquiries/enquiryService.js';
import { productJsonLd } from '../src/modules/seo/seo.js';

const actor = { sub: 'a1', email: 'owner@x.com' };
const code = async (p) => { try { await p; } catch (e) { return e.code; } return null; };
const mk = () => createFakeDb({ unique: { coupons: ['code'] } });

test('coupons: validated, stored in paise, usable by the pricing engine, code immutable', async () => {
  const db = mk();
  const c = await createCoupon({ db, body: { code: 'diwali10', type: 'percent', value: 10, minOrder: 999, maxDiscount: 300, usageLimit: 50, perUserLimit: 1, expiresAt: '2099-01-01' } });
  assert.equal(c.code, 'DIWALI10'); assert.equal(c.minOrderPaise, 99900); assert.equal(c.maxDiscountPaise, 30000); assert.equal(c.usedCount, 0);
  assert.equal(evaluateCoupon({ coupon: c, subtotalPaise: 500000 }), 30000);
  const flat = await createCoupon({ db, body: { code: 'FLAT200', type: 'flat', value: 200 } });
  assert.equal(flat.value, 20000);
  assert.equal(await code(createCoupon({ db, body: { code: 'FLAT200', type: 'flat', value: 5 } })), 'COUPON_EXISTS');
  const u = await updateCoupon({ db, id: flat.id, body: { code: 'CHANGED', active: false, value: 300 } });
  assert.equal(u.code, 'FLAT200'); assert.equal(u.active, false); assert.equal(u.value, 30000);
  assert.equal((await listCoupons({ db })).length, 2);
});
test('coupons: bad input rejected', () => {
  const bad = (b) => { try { validateCoupon(b); } catch (e) { return e.code; } return null; };
  assert.equal(bad({ code: 'x', type: 'flat', value: 5 }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'percent', value: 150 }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'percent', value: 10.5 }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'flat', value: -5 }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'weird', value: 5 }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'flat', value: 5, startsAt: '2026-05-01', expiresAt: '2026-04-01' }), 'INVALID_COUPON');
  assert.equal(bad({ code: 'ABC', type: 'flat', value: 5, usageLimit: 0 }), 'INVALID_COUPON');
});

test('settings: shipping falls back to env values, admin override stored in paise and audited', async () => {
  const db = createFakeDb(); const defaults = { freeShippingThresholdPaise: 149900, shippingFeePaise: 0 };
  assert.deepEqual(await getShippingSettings(db, defaults), defaults);
  const s = await updateShippingSettings({ db, body: { freeShippingThreshold: 999, shippingFee: 49.5 }, actor, defaults });
  assert.deepEqual(s, { freeShippingThresholdPaise: 99900, shippingFeePaise: 4950 });
  assert.deepEqual(await getShippingSettings(db, defaults), s);
  assert.equal(await db.collection('audit_logs').countDocuments({ action: 'update_shipping_settings' }), 1);
  assert.equal(await code(updateShippingSettings({ db, body: { freeShippingThreshold: -1, shippingFee: 0 }, actor, defaults })), 'INVALID_INPUT');
  assert.equal(await code(updateShippingSettings({ db, body: { freeShippingThreshold: 'abc', shippingFee: 0 }, actor, defaults })), 'INVALID_INPUT');
});
test('settings: business details feed invoices; GST needs a valid GSTIN', async () => {
  const db = createFakeDb();
  assert.equal(await code(updateBusiness({ db, body: { legalName: 'Printxyz', address: '' }, actor })), 'INVALID_INPUT');
  assert.equal(await code(updateBusiness({ db, body: { legalName: 'P', address: 'A', gstEnabled: true }, actor })), 'INVALID_INPUT');
  assert.equal(await code(updateBusiness({ db, body: { legalName: 'P', address: 'A', email: 'nope' }, actor })), 'INVALID_INPUT');
  await updateBusiness({ db, body: { legalName: 'Printxyz Studio', address: '12 Road, Patna', phone: '+91 98000 00000', email: 'hi@example.com', terms: 'T' }, actor });
  const b = await getBusinessSettings(db, null);
  assert.equal(b.legalName, 'Printxyz Studio'); assert.equal(b.address, '12 Road, Patna');
  assert.equal((await getBusinessAdmin(db)).email, 'hi@example.com');
});

const order = (o) => ({ _id: o.id, customerEmail: 'a@x.com', customer: { name: 'A', email: 'a@x.com', phone: '1', city: 'Patna', state: 'Bihar', pincode: '800001' }, items: [{ productId: 'p1', title: 'Lamp', quantity: 1, lineTotalPaise: 100000 }],
  subtotalPaise: 100000, discountPaise: 0, shippingPaise: 0, totalPaise: 100000, refundedPaise: 0, paymentStatus: 'paid', status: 'confirmed', productionStatus: 'queued', shippingStatus: 'pending', createdAt: new Date('2026-11-02T10:00:00Z'), paidAt: new Date('2026-11-02T10:05:00Z'), ...o });
test('reports: sales totals, refunds, top products, daily series, sources', async () => {
  const db = createFakeDb();
  await db.collection('orders').insertOne(order({ id: 'PX-1', couponCode: 'SAVE', utm: { source: 'instagram' } }));
  await db.collection('orders').insertOne(order({ id: 'PX-2', totalPaise: 50000, refundedPaise: 50000, paymentStatus: 'refunded', items: [{ productId: 'p2', title: 'Plate', quantity: 2, lineTotalPaise: 50000 }], paidAt: new Date('2026-11-03T10:00:00Z') }));
  await db.collection('orders').insertOne(order({ id: 'PX-3', paymentStatus: 'pending', paidAt: undefined }));
  await db.collection('orders').insertOne(order({ id: 'PX-OLD', paidAt: new Date('2025-01-01T00:00:00Z') }));
  const r = await salesReport({ db, from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T00:00:00Z') });
  assert.equal(r.orders, 2); assert.equal(r.revenuePaise, 150000); assert.equal(r.refundedPaise, 50000); assert.equal(r.netPaise, 100000);
  assert.equal(r.topProducts[0].title, 'Lamp'); assert.equal(r.byDay.length, 2); assert.deepEqual(r.couponUse, [{ code: 'SAVE', orders: 1 }]);
  assert.ok(r.bySource.some((s) => s.source === 'instagram'));
});
test('csv: formula injection neutralised, quotes and commas escaped', async () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+91 98000'), "'+91 98000"); assert.equal(csvCell('-5'), "'-5"); assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Patna, Bihar'), '"Patna, Bihar"'); assert.equal(csvCell(null), ''); assert.equal(csvCell(1799), '1799');
  const db = createFakeDb(); await db.collection('orders').insertOne(order({ id: 'PX-9', customer: { name: '=cmd|calc', email: 'a@x.com', phone: '1', city: 'P', state: 'B', pincode: '1' } }));
  const csv = await ordersCsv({ db }); const lines = csv.split('\r\n');
  assert.equal(lines.length, 2); assert.ok(lines[1].includes("'=cmd|calc")); assert.ok(!lines[1].split(',').some((c) => c.startsWith('=')));
  assert.equal(lines[0].split(',')[0], 'Order');
});
test('customers and low stock reports', async () => {
  const db = createFakeDb();
  await db.collection('orders').insertOne(order({ id: 'PX-1' })); await db.collection('orders').insertOne(order({ id: 'PX-2', totalPaise: 20000, refundedPaise: 5000 }));
  await db.collection('orders').insertOne(order({ id: 'PX-3', paymentStatus: 'pending' }));
  const [c] = await customersReport({ db }); assert.equal(c.orders, 3); assert.equal(c.paidOrders, 2); assert.equal(c.lifetimeValuePaise, 115000);
  for (const [id, stock] of [['a', 0], ['b', 3], ['c', 50]]) await db.collection('products').insertOne({ id, title: id, stock });
  assert.deepEqual((await lowStock({ db })).map((p) => p.id), ['a', 'b']);
});

const shop = async () => {
  const db = createFakeDb({ unique: { reviews: [] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'lamp', title: 'Lamp', price: 1, stock: 1, rating: 0, reviews: 0 });
  await db.collection('users').insertOne({ _id: 'u1', id: 'u1', name: 'Asha Rao', email: 'a@x.com' });
  await db.collection('users').insertOne({ _id: 'u2', id: 'u2', name: 'Bo', email: 'b@x.com' });
  await db.collection('orders').insertOne({ _id: 'o1', id: 'PX-1', userId: 'u1', shippingStatus: 'delivered', items: [{ productId: 'p1' }] });
  await db.collection('orders').insertOne({ _id: 'o2', id: 'PX-2', userId: 'u2', shippingStatus: 'in-transit', items: [{ productId: 'p1' }] });
  return db;
};
test('reviews: only verified delivered buyers, once, validated, hidden until approved, rating recomputed', async () => {
  const db = await shop(); const good = { productId: 'p1', rating: 5, title: 'Great', body: 'Looks lovely on my shelf.' };
  assert.equal(await code(submitReview({ db, userId: 'u2', ...good })), 'NOT_VERIFIED_BUYER');
  assert.equal(await code(submitReview({ db, userId: 'nobody', ...good })), 'NOT_VERIFIED_BUYER');
  assert.equal(await code(submitReview({ db, userId: 'u1', ...good, rating: 6 })), 'INVALID_REVIEW');
  assert.equal(await code(submitReview({ db, userId: 'u1', ...good, rating: 4.5 })), 'INVALID_REVIEW');
  assert.equal(await code(submitReview({ db, userId: 'u1', ...good, body: 'short' })), 'INVALID_REVIEW');
  assert.equal(await code(submitReview({ db, userId: 'u1', ...good, productId: 'zzz' })), 'PRODUCT_NOT_FOUND');
  const r = await submitReview({ db, userId: 'u1', ...good });
  assert.equal(r.status, 'pending'); assert.equal(await code(submitReview({ db, userId: 'u1', ...good })), 'ALREADY_REVIEWED');
  assert.equal((await listApproved({ db, productId: 'p1' })).length, 0); assert.equal((await listPending({ db })).length, 1);
  assert.equal((await db.collection('products').findOne({ id: 'p1' })).reviews, 0);
  assert.deepEqual(await moderateReview({ db, id: r.id, action: 'approve', actor }), { rating: 5, reviews: 1 });
  const [shown] = await listApproved({ db, productId: 'p1' }); assert.equal(shown.name, 'Asha'); assert.ok(!('userId' in shown));
  assert.deepEqual(await moderateReview({ db, id: r.id, action: 'reject', actor }), { rating: 0, reviews: 0 });
  assert.equal(await code(moderateReview({ db, id: r.id, action: 'delete', actor })), 'INVALID_REVIEW');
  assert.equal(await code(moderateReview({ db, id: 'nope', action: 'approve', actor })), 'REVIEW_NOT_FOUND');
});
test('seo: rating markup appears only when real approved reviews exist', () => {
  const product = { id: 'p1', slug: 'lamp', title: 'Lamp', price: 1799, stock: 3, image: '/i.jpg', category: 'Lamps' };
  assert.equal('aggregateRating' in productJsonLd({ product, siteUrl: 'https://x.in' }), false);
  assert.equal('aggregateRating' in productJsonLd({ product, siteUrl: 'https://x.in', reviews: { count: 0, rating: 0 } }), false);
  const ld = productJsonLd({ product, siteUrl: 'https://x.in', reviews: { count: 4, rating: 4.5 } });
  assert.deepEqual(ld.aggregateRating, { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: 4 });
});

test('enquiries: validated, numbered, bots ignored, status managed', async () => {
  const db = createFakeDb(); const ok = { name: 'Raj', email: 'RAJ@x.com', message: 'Need 50 desk plates for our office.', type: 'bulk', quantity: '50' };
  assert.equal(await code(createEnquiry({ db, input: { ...ok, name: '' } })), 'INVALID_INPUT');
  assert.equal(await code(createEnquiry({ db, input: { ...ok, email: 'x' } })), 'INVALID_INPUT');
  assert.equal(await code(createEnquiry({ db, input: { ...ok, message: 'hi' } })), 'INVALID_INPUT');
  assert.equal(await code(createEnquiry({ db, input: { ...ok, phone: '123' } })), 'INVALID_INPUT');
  const a = await createEnquiry({ db, input: ok }); const b = await createEnquiry({ db, input: { ...ok, type: 'weird' } });
  assert.equal(a.id, 'TKT-000001'); assert.equal(b.id, 'TKT-000002'); assert.equal(b.type, 'contact');
  const bot = await createEnquiry({ db, input: { ...ok, website: 'http://spam' } }); assert.equal(bot.ignored, true);
  assert.equal((await listEnquiries({ db })).length, 2);
  assert.equal((await listEnquiries({ db }))[0].email.includes('RAJ'), false);
  await setEnquiryStatus({ db, id: a.id, status: 'resolved' });
  assert.equal((await listEnquiries({ db, status: 'open' })).length, 1);
  assert.equal(await code(setEnquiryStatus({ db, id: a.id, status: 'x' })), 'INVALID_INPUT');
  assert.equal(await code(setEnquiryStatus({ db, id: 'TKT-9', status: 'open' })), 'ENQUIRY_NOT_FOUND');
});
