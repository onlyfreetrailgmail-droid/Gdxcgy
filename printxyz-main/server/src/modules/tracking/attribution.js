// Campaign attribution captured by the storefront and frozen on the order.
// Everything here is untrusted browser input: whitelisted, length-capped and stripped of control characters.
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim().slice(0, max);

// Meta cookie formats: _fbp = fb.1.<ms>.<digits>, _fbc = fb.1.<ms>.<fbclid>
const FBP = /^fb\.[0-2]\.\d{10,16}\.\d{1,20}$/;
const FBC = /^fb\.[0-2]\.\d{10,16}\.[A-Za-z0-9_-]{1,200}$/;

export const sanitizeAttribution = (raw = {}) => {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of FIELDS) {
    const v = clean(src[key], key === 'fbclid' || key === 'gclid' ? 200 : 100);
    if (v) out[key] = v;
  }
  const fbp = clean(src.fbp, 80); if (FBP.test(fbp)) out.fbp = fbp;
  const fbc = clean(src.fbc, 260); if (FBC.test(fbc)) out.fbc = fbc;
  const landing = clean(src.landing, 300); if (landing.startsWith('/')) out.landing = landing;
  const referrer = clean(src.referrer, 200); if (/^https?:\/\//.test(referrer)) out.referrer = referrer;
  return out;
};

// Marketing consent is an explicit boolean from the cookie banner. Anything else means "no".
export const hasMarketingConsent = (input = {}) => input.marketingConsent === true;
