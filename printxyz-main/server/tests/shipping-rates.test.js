import test from 'node:test';
import assert from 'node:assert/strict';
import { priceCart } from '../src/modules/pricing/pricing.js';
import { quoteShipping, clearRateCache } from '../src/modules/shipping/rates.js';

const products = [{ id: 'p1', slug: 'p1', title: 'Lamp', price: 500, stock: 10, published: true }];
const settings = { freeShippingThresholdPaise: 149900, shippingFeePaise: 0 };
const config = { shipping: { pickupPincode: '800001', parcel: { weightKg: 0.5 } } };
const provider = (name, result, calls) => ({ name, configured: true, serviceability: async () => { calls.n += 1; return result; } });

test('courier rate is added to the total below the free-shipping threshold', () => {
  const p = priceCart({ products, items: [{ productId: 'p1', quantity: 1 }], settings, shippingQuotePaise: 7000 });
  assert.equal(p.shippingPaise, 7000);
  assert.equal(p.totalPaise, 50000 + 7000);
});

test('shipping stays free above the threshold even with a courier rate', () => {
  const p = priceCart({ products, items: [{ productId: 'p1', quantity: 4 }], settings, shippingQuotePaise: 7000 });
  assert.equal(p.shippingPaise, 0);
});

test('no courier rate falls back to the configured flat fee', () => {
  const p = priceCart({ products, items: [{ productId: 'p1', quantity: 1 }], settings: { ...settings, shippingFeePaise: 4900 }, shippingQuotePaise: null });
  assert.equal(p.shippingPaise, 4900);
});

test('quoteShipping picks the cheapest courier, rounds up to whole rupees and caches', async () => {
  clearRateCache();
  const calls = { n: 0 };
  const providers = {
    a: provider('shiprocket', { serviceable: true, options: [{ courier: 'X', etd: '3 days', ratePaise: 8120 }, { courier: 'Y', etd: null, ratePaise: 9000 }] }, calls),
    b: provider('delhivery', { serviceable: true, options: [{ courier: 'Delhivery', etd: null, ratePaise: null }] }, calls)
  };
  const q = await quoteShipping({ providers, config, pincode: '800001' });
  assert.deepEqual([q.serviceable, q.ratePaise, q.courier], [true, 8200, 'X']);
  await quoteShipping({ providers, config, pincode: '800001' });
  assert.equal(calls.n, 2, 'second call is served from cache');
});

test('unserviceable pincode is reported, unknown results are not cached', async () => {
  clearRateCache();
  const calls = { n: 0 };
  const no = await quoteShipping({ providers: { a: provider('delhivery', { serviceable: false, options: [] }, calls) }, config, pincode: '110001' });
  assert.equal(no.serviceable, false);
  const failing = { a: { name: 'delhivery', configured: true, serviceability: async () => { throw new Error('down'); } } };
  const unknown = await quoteShipping({ providers: failing, config, pincode: '560001' });
  assert.equal(unknown.serviceable, null);
});
