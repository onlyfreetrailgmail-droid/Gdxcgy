import { AppError } from '../../../middleware/errors.js';

const HOSTS = { staging: 'https://staging-express.delhivery.com', production: 'https://track.delhivery.com' };

// `fetchImpl` is injectable for tests. Response shapes follow third-party SDKs of Delhivery's Express API; verify on staging.
export const createDelhivery = ({ token, mode = 'staging', pickupLocation, fetchImpl = fetch }) => {
  const configured = Boolean(token);
  const base = HOSTS[mode] || HOSTS.staging;
  const call = async (method, path, { form } = {}) => {
    if (!configured) throw new AppError(503, 'COURIER_NOT_CONFIGURED', 'Delhivery is not configured.');
    const res = await fetchImpl(`${base}${path}`, { method, headers: { Authorization: `Token ${token}`, Accept: 'application/json', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: form, signal: AbortSignal.timeout(20_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, 'COURIER_REQUEST_FAILED', `Delhivery rejected the request (${res.status}).`);
    return data;
  };

  return {
    name: 'delhivery', configured, pickupConfigured: Boolean(pickupLocation),
    trackingUrl: (awb) => `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`,

    async serviceability({ pickupPincode, deliveryPincode, weightKg }) {
      const data = await call('GET', `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(deliveryPincode)}`);
      const row = (data?.delivery_codes || [])[0]?.postal_code;
      const prepaid = String(row?.pre_paid || '').toUpperCase() === 'Y';
      const serviceable = Boolean(row) && prepaid;
      let ratePaise = null;
      // Rate calculator (verify the response shape on staging). A failure here only means "no live rate".
      if (serviceable && pickupPincode) {
        try {
          const q = new URLSearchParams({ md: 'S', ss: 'Delivered', d_pin: String(deliveryPincode), o_pin: String(pickupPincode), cgm: String(Math.round(Number(weightKg || 0.5) * 1000)), pt: 'Pre-paid' });
          const charge = await call('GET', `/api/kinko/v1/invoice/charges/.json?${q}`);
          const first = Array.isArray(charge) ? charge[0] : charge;
          const amount = Number(first?.total_amount);
          if (Number.isFinite(amount) && amount > 0) ratePaise = Math.round(amount * 100);
        } catch { /* leave null */ }
      }
      return { serviceable, options: row ? [{ courier: 'Delhivery', etd: null, ratePaise }] : [] };
    },

    async createShipment({ order, parcel }) {
      if (!pickupLocation) throw new AppError(503, 'PICKUP_NOT_CONFIGURED', 'Set DELHIVERY_PICKUP_LOCATION to the warehouse name registered with Delhivery.');
      const c = order.customer;
      const payload = { shipments: [{
        name: c.name, add: [c.street, c.apartment, c.landmark].filter(Boolean).join(', '), pin: c.pincode, city: c.city, state: c.state, country: 'India', phone: c.phone.replace(/^\+91/, ''),
        order: order.id, payment_mode: 'Prepaid', products_desc: order.items.map((l) => `${l.title} x${l.quantity}`).join(', ').slice(0, 200),
        total_amount: order.totalPaise / 100, cod_amount: 0, quantity: order.items.reduce((n, l) => n + l.quantity, 0),
        weight: Math.round(parcel.weightKg * 1000), shipment_length: parcel.lengthCm, shipment_width: parcel.breadthCm, shipment_height: parcel.heightCm
      }], pickup_location: { name: pickupLocation } };
      const body = new URLSearchParams({ format: 'json', data: JSON.stringify(payload) }).toString();
      const data = await call('POST', '/api/cmu/create.json', { form: body });
      const pkg = (data?.packages || [])[0];
      if (!data?.success || !pkg?.waybill) throw new AppError(502, 'COURIER_REQUEST_FAILED', `Delhivery did not create the shipment: ${String(pkg?.remarks || data?.rmk || 'unknown reason').slice(0, 160)}`);
      return { providerOrderId: String(pkg.refnum || order.id), providerShipmentId: String(pkg.waybill), awb: String(pkg.waybill), courier: 'Delhivery' };
    },

    async label({ awb }) {
      const data = await call('GET', `/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`);
      return (data?.packages || [])[0]?.pdf_download_link || null;
    },

    async track(awb) {
      const data = await call('GET', `/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`);
      const status = data?.ShipmentData?.[0]?.Shipment?.Status || {};
      return { status: status.Status || '', statusType: status.StatusType || '', statusText: status.Status || '', at: status.StatusDateTime || null };
    }
  };
};
