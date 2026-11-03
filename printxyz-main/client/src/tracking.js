// Marketing tracking: consent, campaign attribution and the Meta Pixel.
// Nothing marketing-related loads or fires until the visitor accepts marketing cookies.
// Purchase is sent from the server after payment is verified; the browser sends the same event_id so Meta deduplicates.
const CONSENT_KEY = 'printxyz-consent';
const ATTR_KEY = 'printxyz-attribution';
const listeners = new Set();

const read = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

export const getConsent = () => read(localStorage, CONSENT_KEY); // null = not decided yet
export const hasMarketingConsent = () => getConsent()?.marketing === true;
export const subscribeConsent = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const setConsent = (marketing) => {
  write(localStorage, CONSENT_KEY, { v: 1, marketing: Boolean(marketing), at: new Date().toISOString() });
  if (marketing) applyConsentGranted(); else revokeMarketing();
  listeners.forEach((fn) => fn());
};

// ---- campaign attribution (campaign names are not personal data; it is kept for the session only) ----
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
export const captureAttribution = () => {
  const params = new URLSearchParams(window.location.search);
  const found = {};
  for (const k of [...UTM, 'fbclid', 'gclid']) { const v = params.get(k); if (v) found[k] = v.slice(0, 200); }
  const existing = read(sessionStorage, ATTR_KEY) || {};
  if (Object.keys(found).length) {
    // Last touch wins when a visitor arrives from a new campaign link; the first landing page is kept.
    write(sessionStorage, ATTR_KEY, { ...found, landing: existing.landing || window.location.pathname, referrer: existing.referrer ?? (document.referrer || '') });
  } else if (!existing.landing) {
    write(sessionStorage, ATTR_KEY, { landing: window.location.pathname, referrer: document.referrer || '' });
  }
};

const cookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1] || '';

// What is attached to an order. Meta cookie values are included only with marketing consent.
export const getAttributionForOrder = () => {
  const a = read(sessionStorage, ATTR_KEY) || {};
  const out = { ...a };
  if (hasMarketingConsent()) {
    const fbp = cookie('_fbp'); if (fbp) out.fbp = fbp;
    const fbc = cookie('_fbc') || (a.fbclid ? `fb.1.${Date.now()}.${a.fbclid}` : ''); if (fbc) out.fbc = fbc;
  }
  return out;
};

// ---- Google Analytics 4 (same consent gate; no ad personalisation, no Google signals) ----
let gaId = '';
let gaLoaded = false;
const loadGa = () => {
  if (gaLoaded || !gaId) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('config', gaId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  const el = document.createElement('script'); el.async = true; el.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`; document.head.appendChild(el);
  gaLoaded = true;
};
const GA_EVENTS = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' };
const gaTrack = (name, data = {}, eventId) => {
  if (!(hasMarketingConsent() && gaLoaded && typeof window.gtag === 'function') || NEVER_TRACK.test(window.location.pathname) || !GA_EVENTS[name]) return;
  const items = (data.contents || (data.content_ids || []).map((id) => ({ id, quantity: 1 }))).map((c) => ({ item_id: String(c.id), quantity: c.quantity || 1 }));
  window.gtag('event', GA_EVENTS[name], { currency: 'INR', value: data.value, items, ...(name === 'Purchase' ? { transaction_id: String(eventId || '').replace(/^purchase_/, '') } : {}) });
};

// ---- Meta Pixel ----
let pixelId = '';
let pixelLoaded = false;
// Pages whose URL can carry a private token or personal data are never reported to Meta.
const NEVER_TRACK = /^\/(track|orders|account|login|admin)(\/|$)/;
const canFire = () => hasMarketingConsent() && pixelLoaded && typeof window.fbq === 'function' && !NEVER_TRACK.test(window.location.pathname);

const loadPixel = () => {
  if (pixelLoaded || !pixelId) return;
  /* eslint-disable */
  (function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = true; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  // Do not let the pixel scrape form fields or button text (checkout holds names, phone and address).
  window.fbq('set', 'autoConfig', false, pixelId);
  window.fbq('init', pixelId);
  pixelLoaded = true;
};

function applyConsentGranted() { if (pixelId) { loadPixel(); window.fbq?.('consent', 'grant'); } loadGa(); pageView(); }
function revokeMarketing() {
  window.fbq?.('consent', 'revoke');
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
  for (const name of document.cookie.split('; ').map((c) => c.split('=')[0]).filter((n) => n === '_fbp' || n === '_fbc' || n.startsWith('_ga'))) document.cookie = `${name}=; Max-Age=0; path=/`;
}

export const initTracking = (id, ga) => {
  pixelId = /^\d{5,20}$/.test(String(id || '')) ? String(id) : '';
  gaId = /^G-[A-Z0-9]{4,15}$/.test(String(ga || '')) ? String(ga) : '';
  captureAttribution();
  if (hasMarketingConsent()) { if (pixelId) loadPixel(); loadGa(); pageView(); }
};

export const pageView = () => {
  if (canFire()) window.fbq('track', 'PageView');
  if (hasMarketingConsent() && gaLoaded && typeof window.gtag === 'function' && !NEVER_TRACK.test(window.location.pathname)) window.gtag('event', 'page_view', { page_path: window.location.pathname });
};
const track = (name, data, eventId) => {
  if (canFire()) window.fbq('track', name, data, eventId ? { eventID: eventId } : undefined);
  gaTrack(name, data, eventId);
};

const idsOf = (items) => items.map((i) => String(i.productId || i.id));
export const trackViewContent = (p) => track('ViewContent', { content_type: 'product', content_ids: [String(p.id)], content_name: p.title, value: Number(p.price) || 0, currency: 'INR' });
export const trackAddToCart = (p, quantity = 1) => track('AddToCart', { content_type: 'product', content_ids: [String(p.id)], content_name: p.title, contents: [{ id: String(p.id), quantity }], value: (Number(p.price) || 0) * quantity, currency: 'INR' });
export const trackInitiateCheckout = (items, value) => track('InitiateCheckout', { content_type: 'product', content_ids: idsOf(items), num_items: items.reduce((n, i) => n + i.quantity, 0), value, currency: 'INR' });
// Called only after /api/payments/verify succeeded. event_id matches the server's Conversions API event.
export const trackPurchase = ({ orderId, value, items }) => track('Purchase', { content_type: 'product', content_ids: idsOf(items), contents: items.map((i) => ({ id: String(i.productId || i.id), quantity: i.quantity })), num_items: items.reduce((n, i) => n + i.quantity, 0), value, currency: 'INR' }, `purchase_${orderId}`);
