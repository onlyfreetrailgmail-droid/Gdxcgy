import { checkServiceability } from './shippingService.js';

// Live courier rate for a delivery pincode. Server-side only; the browser never supplies a shipping amount.
// Results are cached briefly so the checkout quote and the order creation that follows use the same number.
const TTL_MS = 10 * 60_000;
const cache = new Map();
export const clearRateCache = () => cache.clear();

export const quoteShipping = async ({ providers, config, pincode, nowMs = Date.now() }) => {
  const key = String(pincode || '');
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < TTL_MS) return hit.value;

  const result = await checkServiceability({ providers, config, pincode: key });
  const rated = (result.options || []).filter((o) => Number.isInteger(o.ratePaise) && o.ratePaise > 0)
    .sort((a, b) => a.ratePaise - b.ratePaise);
  const best = rated[0] || null;
  const value = {
    serviceable: result.serviceable,                                   // true / false / null (unknown)
    ratePaise: best ? Math.ceil(best.ratePaise / 100) * 100 : null,    // whole rupees, cheapest courier
    courier: best?.courier || '',
    etd: (result.options || []).map((o) => o.etd).find(Boolean) || ''
  };
  // Unknown results (courier outage) are not cached, so the next call tries again.
  if (value.serviceable !== null) cache.set(key, { at: nowMs, value });
  return value;
};
