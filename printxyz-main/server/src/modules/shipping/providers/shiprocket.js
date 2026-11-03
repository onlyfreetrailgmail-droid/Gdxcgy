import { AppError } from '../../../middleware/errors.js';

const BASE = 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;   // docs differ (24h vs 10 days); refresh early to be safe

// `fetchImpl` is injectable for tests. Endpoints follow Shiprocket's published External API.
export const createShiprocket = ({ email, password, pickupLocation, fetchImpl = fetch }) => {
  const configured = Boolean(email && password);
  let token = null; let tokenAt = 0;

  const login = async () => {
    const res = await fetchImpl(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new AppError(502, 'COURIER_AUTH_FAILED', 'Shiprocket login failed. Check the API user credentials.');
    token = data.token; tokenAt = Date.now();
  };
  const call = async (method, path, body, retry = true) => {
    if (!configured) throw new AppError(503, 'COURIER_NOT_CONFIGURED', 'Shiprocket is not configured.');
    if (!token || Date.now() - tokenAt > TOKEN_TTL_MS) await login();
    const res = await fetchImpl(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 && retry) { token = null; return call(method, path, body, false); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, 'COURIER_REQUEST_FAILED', `Shiprocket rejected the request: ${String(data?.message || res.status).slice(0, 160)}`);
    return data;
  };

  return {
    name: 'shiprocket', configured, pickupConfigured: Boolean(pickupLocation),
    trackingUrl: (awb) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`,

    async serviceability({ pickupPincode, deliveryPincode, weightKg }) {
      const q = new URLSearchParams({ pickup_postcode: pickupPincode, delivery_postcode: deliveryPincode, weight: String(weightKg), cod: '0' });
      const data = await call('GET', `/courier/serviceability/?${q}`);
      const list = data?.data?.available_courier_companies || [];
      // etd and rate are shown only when the courier returns them.
      return { serviceable: list.length > 0, options: list.map((c) => ({ courier: c.courier_name, etd: c.etd || null, ratePaise: Number.isFinite(Number(c.rate)) ? Math.round(Number(c.rate) * 100) : null })) };
    },

    async createShipment({ order, parcel }) {
      if (!pickupLocation) throw new AppError(503, 'PICKUP_NOT_CONFIGURED', 'Set SHIPROCKET_PICKUP_LOCATION to the pickup name shown in your Shiprocket panel.');
      const c = order.customer; const [first, ...rest] = c.name.split(' ');
      const created = await call('POST', '/orders/create/adhoc', {
        order_id: order.id, order_date: new Date().toISOString().slice(0, 10), pickup_location: pickupLocation,
        billing_customer_name: first, billing_last_name: rest.join(' '), billing_address: [c.street, c.apartment].filter(Boolean).join(', '),
        billing_city: c.city, billing_pincode: c.pincode, billing_state: c.state, billing_country: 'India', billing_email: c.email, billing_phone: c.phone.replace(/^\+91/, ''),
        shipping_is_billing: true,
        order_items: order.items.map((l) => ({ name: l.title, sku: l.productId, units: l.quantity, selling_price: l.unitPricePaise / 100 })),
        payment_method: 'Prepaid', shipping_charges: order.shippingPaise / 100, total_discount: order.discountPaise / 100, sub_total: order.subtotalPaise / 100,
        length: parcel.lengthCm, breadth: parcel.breadthCm, height: parcel.heightCm, weight: parcel.weightKg
      });
      if (!created.shipment_id) throw new AppError(502, 'COURIER_REQUEST_FAILED', 'Shiprocket did not return a shipment id.');
      // With no courier_id, Shiprocket assigns a courier automatically.
      const awb = await call('POST', '/courier/assign/awb', { shipment_id: created.shipment_id });
      const a = awb?.response?.data || awb?.data || {};
      if (!a.awb_code) throw new AppError(502, 'COURIER_REQUEST_FAILED', 'Shiprocket could not assign a courier. Check wallet balance and serviceability.');
      return { providerOrderId: String(created.order_id || ''), providerShipmentId: String(created.shipment_id), awb: String(a.awb_code), courier: a.courier_name || 'Shiprocket' };
    },

    async label({ providerShipmentId }) {
      const data = await call('POST', '/courier/generate/label', { shipment_id: [Number(providerShipmentId)] });
      return data?.label_url || null;
    },

    async track(awb) {
      const data = await call('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
      const t = data?.tracking_data || {};
      const latest = (t.shipment_track || [])[0] || {};
      return { statusText: latest.current_status || '', etd: t.etd || null };
    }
  };
};
