import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { enqueueEmail } from '../notifications/queue.js';
import { mapShiprocketStatus, mapDelhiveryStatus, canCourierMove } from './statusMap.js';

const num = (v, def, max) => { const n = Number(v ?? def); if (!Number.isFinite(n) || n <= 0 || n > max) throw new AppError(400, 'INVALID_PARCEL', 'Parcel weight and size must be positive numbers within limits.'); return n; };
export const resolveParcel = (defaults, input = {}) => ({
  weightKg: num(input.weightKg, defaults.weightKg, 30), lengthCm: num(input.lengthCm, defaults.lengthCm, 200),
  breadthCm: num(input.breadthCm, defaults.breadthCm, 200), heightCm: num(input.heightCm, defaults.heightCm, 200)
});

export const checkServiceability = async ({ providers, config, pincode }) => {
  if (!/^[1-9]\d{5}$/.test(String(pincode || ''))) throw new AppError(400, 'INVALID_PINCODE', 'Enter a valid 6-digit pincode.');
  const active = Object.values(providers).filter((p) => p?.configured);
  if (!active.length) return { configured: false, serviceable: null, options: [] };
  const args = { pickupPincode: config.shipping.pickupPincode, deliveryPincode: pincode, weightKg: config.shipping.parcel.weightKg };
  const runnable = active.filter((p) => p.name !== 'shiprocket' || args.pickupPincode);   // Shiprocket needs the pickup pincode
  const results = await Promise.allSettled(runnable.map((p) => p.serviceability(args)));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) return { configured: true, serviceable: null, options: [] };   // unknown, never guessed
  return { configured: true, serviceable: ok.some((r) => r.serviceable), options: ok.flatMap((r) => r.options) };
};

export const createShipment = async ({ db, providers, orderId, providerName, parcel: parcelInput, defaults, actor, now = new Date() }) => {
  const provider = providers[providerName];
  if (!provider?.configured) throw new AppError(400, 'COURIER_NOT_CONFIGURED', 'That courier is not set up yet.');
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.paymentStatus === 'advance_paid') throw new AppError(409, 'BALANCE_REQUIRED', 'The balance payment is still pending. Ship after the customer pays it.');
  if (order.paymentStatus !== 'paid' || order.status !== 'confirmed') throw new AppError(409, 'PAYMENT_REQUIRED', 'Only paid, confirmed orders can be shipped.');
  if (!['approved', 'not-required'].includes(order.customPreviewStatus)) throw new AppError(409, 'APPROVAL_REQUIRED', 'The customer has not approved the design yet.');
  if (order.productionStatus !== 'packed') throw new AppError(409, 'NOT_PACKED', 'Mark the order as packed before creating a shipment.');
  const parcel = resolveParcel(defaults, parcelInput);

  // Claim first so a double click cannot book two shipments for one order.
  const claim = await db.collection('orders').updateOne({ _id: order._id, shipmentClaimed: { $ne: true } }, { $set: { shipmentClaimed: true } });
  if (!claim.modifiedCount) throw new AppError(409, 'SHIPMENT_EXISTS', 'A shipment is already being created or exists for this order.');
  let result;
  try {
    result = await provider.createShipment({ order, parcel });
  } catch (e) {
    await db.collection('orders').updateOne({ _id: order._id }, { $set: { shipmentClaimed: false } });
    throw e;
  }
  const labelUrl = await provider.label(result).catch(() => null);
  const shipment = { _id: crypto.randomUUID(), orderId: order.id, provider: providerName, ...result, labelUrl, trackingUrl: provider.trackingUrl(result.awb), parcel, createdBy: actor.email, createdAt: now, lastStatusText: '' };
  shipment.id = shipment._id;
  await db.collection('shipments').insertOne(shipment);
  await db.collection('orders').updateOne({ _id: order._id }, { $set: { courierName: result.courier, trackingNumber: result.awb, trackingUrl: shipment.trackingUrl } });
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: 'create_shipment', targetType: 'order', targetId: order.id, reason: '', changes: [{ field: 'shipment', from: '', to: `${providerName}:${result.awb}` }] });
  return shipment;
};

// Applies a courier-reported status. Forward-only; final states never change; each event is applied once.
export const applyCourierUpdate = async ({ db, shipment, target, statusText, eventKey, source, now = new Date() }) => {
  if (eventKey) {
    try { await db.collection('webhook_events').insertOne({ eventId: eventKey, event: `courier:${source}`, receivedAt: now }); }
    catch (e) { if (e?.code === 11000) return { duplicate: true }; throw e; }
  }
  await db.collection('shipments').updateOne({ _id: shipment._id }, { $set: { lastStatusText: String(statusText || '').slice(0, 120), lastEventAt: now } });
  const order = await db.collection('orders').findOne({ id: shipment.orderId });
  if (!order || !target || !canCourierMove(order.shippingStatus, target)) return { ignored: true };
  const set = { shippingStatus: target };
  if (target === 'delivered') { set.deliveredAt = now; if (order.status === 'confirmed') set.status = 'completed'; }
  const r = await db.collection('orders').updateOne({ _id: order._id, shippingStatus: order.shippingStatus }, { $set: set, $push: { statusHistory: { status: target, at: now.toISOString() } } });
  if (!r.modifiedCount) return { conflict: true };
  await db.collection('audit_logs').insertOne({ at: now, actorId: `courier:${source}`, actorEmail: source, action: 'courier_status', targetType: 'order', targetId: order.id, reason: String(statusText || '').slice(0, 120), changes: [{ field: 'shipping_status', from: order.shippingStatus, to: target }] });
  const template = { shipped: 'shipped', 'in-transit': 'shipped', 'out-for-delivery': 'out_for_delivery', delivered: 'delivered' }[target];
  // "shipped" goes out once (first movement); keyed per template so a later in-transit scan does not repeat it.
  if (template && order.customerEmail) await enqueueEmail({ db, to: order.customerEmail, template, key: `ship:${order.id}:${template}`, now,
    data: { name: order.customer?.name, orderId: order.id, courier: order.courierName, awb: order.trackingNumber, trackingUrl: order.trackingUrl, trackToken: order.guestToken } });
  if (target === 'delivered' && order.customerEmail && order.userId) {
    await enqueueEmail({ db, to: order.customerEmail, template: 'review_request', key: `review:${order.id}`, now, sendAfter: new Date(now.getTime() + 3 * 86_400_000),
      data: { name: order.customer?.name, orderId: order.id, productSlug: order.items?.[0]?.slug || '' } });
  }
  return { changed: true, from: order.shippingStatus, to: target, delivered: target === 'delivered' };
};

export const handleShiprocketWebhook = async ({ db, body, now }) => {
  const awb = String(body?.awb || '');
  const shipment = awb ? await db.collection('shipments').findOne({ awb, provider: 'shiprocket' }) : null;
  if (!shipment) return { unmatched: true };
  const key = `sr:${awb}:${body.current_status_id ?? body.current_status}:${body.current_timestamp ?? ''}`;
  return applyCourierUpdate({ db, shipment, target: mapShiprocketStatus(body.current_status), statusText: body.current_status, eventKey: key, source: 'shiprocket', now });
};

// Delhivery documents no webhook signature, so the payload only tells us WHICH waybill changed.
// The status itself is pulled from Delhivery's tracking API, never taken from the pushed body.
export const handleDelhiveryWebhook = async ({ db, providers, body, now }) => {
  const awb = String(body?.Shipment?.AWB || body?.awb || body?.waybill || '');
  const shipment = awb ? await db.collection('shipments').findOne({ awb, provider: 'delhivery' }) : null;
  if (!shipment || !providers.delhivery?.configured) return { unmatched: true };
  const t = await providers.delhivery.track(awb);
  return applyCourierUpdate({ db, shipment, target: mapDelhiveryStatus({ status: t.status, statusType: t.statusType }), statusText: t.statusText, eventKey: `dl:${awb}:${t.status}:${t.at || ''}`, source: 'delhivery', now });
};

export const refreshShipment = async ({ db, providers, orderId, now }) => {
  const shipment = await db.collection('shipments').findOne({ orderId: String(orderId || '') });
  const provider = shipment && providers[shipment.provider];
  if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'No shipment exists for this order.');
  if (!provider?.configured) throw new AppError(400, 'COURIER_NOT_CONFIGURED', 'That courier is not set up.');
  const t = await provider.track(shipment.awb);
  const target = shipment.provider === 'shiprocket' ? mapShiprocketStatus(t.statusText) : mapDelhiveryStatus({ status: t.status, statusType: t.statusType });
  return { ...(await applyCourierUpdate({ db, shipment, target, statusText: t.statusText, eventKey: null, source: shipment.provider, now })), courierStatus: t.statusText };
};
