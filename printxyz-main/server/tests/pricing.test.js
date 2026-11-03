import test from 'node:test';
import assert from 'node:assert/strict';
import { priceCart, evaluateCoupon, DEFAULT_SETTINGS } from '../src/modules/pricing/pricing.js';
import { nextOrderNumber, nextSequence } from '../src/db/counters.js';
import { createFakeDb } from './helpers/fakeDb.js';

const products = [
  { id: 'p1', slug: 'a', title: 'A', price: 1799, stock: 5, image: 'x' },
  { id: 'p2', slug: 'b', title: 'B', price: 899, stock: 1, image: 'y' },
  { id: 'p3', slug: 'c', title: 'C', price: 500, stock: 9, published: false }
];
const price = (items, extra = {}) => priceCart({ products, items, ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('pricing: totals in integer paise; client price/total fields are ignored', () => {
  const r = price([{ productId: 'p1', quantity: 2, price: 1, unitPrice: 1, total: 1 }]);
  assert.equal(r.subtotalPaise, 359800); assert.equal(r.totalPaise, 359800);
  assert.ok(Number.isInteger(r.totalPaise));
});
test('pricing: rejects unknown, inactive, bad and out-of-stock quantities', () => {
  assert.equal(code(() => price([{ productId: 'nope', quantity: 1 }])), 'UNKNOWN_PRODUCT');
  assert.equal(code(() => price([{ productId: 'p3', quantity: 1 }])), 'PRODUCT_INACTIVE');
  for (const q of [0, -1, 1.5, '2', NaN, 21]) assert.equal(code(() => price([{ productId: 'p1', quantity: q }])), 'INVALID_QUANTITY', String(q));
  assert.equal(code(() => price([{ productId: 'p2', quantity: 2 }])), 'OUT_OF_STOCK');
  assert.equal(code(() => price([{ productId: 'p2', quantity: 1 }, { productId: 'p2', quantity: 1 }])), 'OUT_OF_STOCK');
  assert.equal(code(() => price([])), 'EMPTY_CART');
});
test('coupons: percent, flat, cap, minimum, window, exhausted', () => {
  const sub = 200000;
  assert.equal(evaluateCoupon({ coupon: { code: 'P', type: 'percent', value: 10 }, subtotalPaise: sub }), 20000);
  assert.equal(evaluateCoupon({ coupon: { code: 'P', type: 'percent', value: 50, maxDiscountPaise: 30000 }, subtotalPaise: sub }), 30000);
  assert.equal(evaluateCoupon({ coupon: { code: 'F', type: 'flat', value: 99999999 }, subtotalPaise: sub }), sub);
  assert.throws(() => evaluateCoupon({ coupon: { code: 'F', type: 'flat', value: 100, minOrderPaise: 300000 }, subtotalPaise: sub }), /more/);
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(code(() => evaluateCoupon({ coupon: { code: 'X', type: 'flat', value: 1, expiresAt: past }, subtotalPaise: sub })), 'COUPON_EXPIRED');
  assert.equal(code(() => evaluateCoupon({ coupon: { code: 'X', type: 'flat', value: 1, usageLimit: 3, usedCount: 3 }, subtotalPaise: sub })), 'COUPON_EXHAUSTED');
  assert.equal(code(() => evaluateCoupon({ coupon: { code: 'X', type: 'flat', value: 1, active: false }, subtotalPaise: sub })), 'INVALID_COUPON');
  assert.equal(code(() => evaluateCoupon({ coupon: null, subtotalPaise: sub })), 'INVALID_COUPON');
});
test('pricing: coupon discount and shipping threshold applied server-side', () => {
  const r = price([{ productId: 'p1', quantity: 1 }], { coupon: { code: 'SAVE', type: 'flat', value: 20000 } });
  assert.equal(r.discountPaise, 20000); assert.equal(r.totalPaise, 159900);
  const s = { ...DEFAULT_SETTINGS, shippingFeePaise: 9900 };
  assert.equal(price([{ productId: 'p2', quantity: 1 }], { settings: s }).shippingPaise, 9900);
  assert.equal(price([{ productId: 'p1', quantity: 1 }], { settings: s }).shippingPaise, 0);
});

test('order numbers: sequential, formatted, yearly reset, unique under concurrency', async () => {
  const db = createFakeDb();
  const y = new Date('2026-05-01T00:00:00Z');
  assert.equal(await nextOrderNumber(db, y), 'PX-2026-0001');
  assert.equal(await nextOrderNumber(db, y), 'PX-2026-0002');
  assert.equal(await nextOrderNumber(db, new Date('2027-01-02T00:00:00Z')), 'PX-2027-0001');
  const many = await Promise.all(Array.from({ length: 200 }, () => nextSequence(db, 'race')));
  assert.equal(new Set(many).size, 200);
});
