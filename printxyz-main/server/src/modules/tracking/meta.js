import crypto from 'node:crypto';

// Meta Conversions API. Purchase is sent from the server, only after a payment has been verified
// (signed checkout callback or signed webhook), and only when the buyer accepted marketing cookies.
// The browser Pixel uses the same event_id, so Meta deduplicates the two.
export const GRAPH_VERSION = 'v21.0';
export const purchaseEventId = (orderId) => `purchase_${orderId}`;

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const norm = (v) => String(v ?? '').trim().toLowerCase();
const hashed = (v) => { const n = norm(v); return n ? sha(n) : undefined; };
const phone91 = (p) => { const d = String(p || '').replace(/\D/g, ''); if (!d) return undefined; return sha(d.length === 10 ? `91${d}` : d); };
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));

export const buildPurchaseEvent = ({ order, siteUrl }) => {
  const a = order.attribution || {};
  const c = order.customer || {};
  const [first, ...rest] = norm(c.name).split(/\s+/);
  const userData = compact({
    em: [hashed(order.customerEmail || c.email)].filter(Boolean),
    ph: [phone91(c.phone)].filter(Boolean),
    fn: [hashed(first)].filter(Boolean),
    ln: [hashed(rest.join(' '))].filter(Boolean),
    ct: [hashed(String(c.city || '').replace(/\s+/g, ''))].filter(Boolean),
    st: [hashed(c.state)].filter(Boolean),
    zp: [hashed(c.pincode)].filter(Boolean),
    country: [sha('in')],
    external_id: order.userId ? [sha(String(order.userId))] : undefined,
    fbp: a.fbp, fbc: a.fbc,
    client_ip_address: order.clientIp || undefined,
    client_user_agent: order.clientUserAgent || undefined
  });
  const items = order.items || [];
  return {
    event_name: 'Purchase',
    event_time: Math.floor(new Date(order.paidAt || Date.now()).getTime() / 1000),
    event_id: purchaseEventId(order.id),
    action_source: 'website',
    event_source_url: `${siteUrl}/checkout`,
    user_data: userData,
    custom_data: {
      currency: 'INR',
      value: Number((order.totalPaise / 100).toFixed(2)),
      order_id: order.id,
      content_type: 'product',
      content_ids: items.map((l) => String(l.productId)),
      contents: items.map((l) => ({ id: String(l.productId), quantity: l.quantity, item_price: Number((l.unitPricePaise / 100).toFixed(2)) })),
      num_items: items.reduce((n, l) => n + l.quantity, 0)
    }
  };
};

export const metaConfigured = (meta) => Boolean(meta?.pixelId && meta?.accessToken);

// Never throws: a tracking outage must not affect payment, invoices or emails.
export const sendMetaPurchase = async ({ db, order, config, fetchImpl = globalThis.fetch, now = new Date() }) => {
  const meta = config.meta;
  if (!metaConfigured(meta)) return { sent: false, reason: 'not_configured' };
  if (!['paid', 'advance_paid'].includes(order.paymentStatus)) return { sent: false, reason: 'not_paid' };
  if (!order.marketingConsent) return { sent: false, reason: 'no_consent' };
  const eventId = purchaseEventId(order.id);
  try {
    // The unique eventId makes duplicate webhooks and retries a no-op.
    await db.collection('tracking_events').insertOne({ eventId, orderId: order.id, provider: 'meta', status: 'pending', createdAt: now });
  } catch (e) {
    if (e?.code === 11000) return { sent: false, reason: 'duplicate' };
    return { sent: false, reason: 'storage_error' };
  }
  try {
    const body = { data: [buildPurchaseEvent({ order, siteUrl: config.publicSiteUrl })], access_token: meta.accessToken };
    if (meta.testEventCode) body.test_event_code = meta.testEventCode;
    const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(meta.pixelId)}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const ok = res.ok;
    // Keep only a short error summary: the response can echo request details.
    let error = '';
    if (!ok) { try { error = String((await res.json())?.error?.message || res.status).slice(0, 200); } catch { error = String(res.status); } }
    await db.collection('tracking_events').updateOne({ eventId }, { $set: { status: ok ? 'sent' : 'failed', httpStatus: res.status, error, updatedAt: new Date() } });
    return { sent: ok, reason: ok ? 'sent' : 'failed' };
  } catch (e) {
    await db.collection('tracking_events').updateOne({ eventId }, { $set: { status: 'failed', error: String(e?.message || 'network').slice(0, 200), updatedAt: new Date() } }).catch(() => {});
    return { sent: false, reason: 'failed' };
  }
};

export const trackingHealth = async ({ db, config }) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.collection('tracking_events').find({ createdAt: { $gte: since } }).toArray();
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    pixelConfigured: Boolean(config.meta?.pixelId),
    capiConfigured: metaConfigured(config.meta),
    testMode: Boolean(config.meta?.testEventCode),
    last24h: { sent: count('sent'), failed: count('failed'), pending: count('pending') }
  };
};
