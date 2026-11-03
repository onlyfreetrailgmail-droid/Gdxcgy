import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { mapShiprocketStatus, mapDelhiveryStatus, canCourierMove } from '../src/modules/shipping/statusMap.js';
import { createShiprocket } from '../src/modules/shipping/providers/shiprocket.js';
import { createDelhivery } from '../src/modules/shipping/providers/delhivery.js';
import { createShipment, applyCourierUpdate, handleShiprocketWebhook, handleDelhiveryWebhook, checkServiceability, resolveParcel } from '../src/modules/shipping/shippingService.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const customer = { name: 'Asha Rao', email: 'a@x.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };
const defaults = { weightKg: 0.5, lengthCm: 15, breadthCm: 15, heightCm: 10 };
const actor = { sub: 'a1', email: 'owner@x.com' };
const mkOrder = (o = {}) => ({ _id: 'o1', id: 'PX-2026-0001', customer, status: 'confirmed', paymentStatus: 'paid', productionStatus: 'packed', customPreviewStatus: 'not-required', shippingStatus: 'pending',
  items: [{ productId: 'p1', title: 'Lamp', quantity: 2, unitPricePaise: 179900, lineTotalPaise: 359800 }], subtotalPaise: 359800, discountPaise: 0, shippingPaise: 0, totalPaise: 359800, statusHistory: [], ...o });
const fakeProvider = (name, over = {}) => ({ name, configured: true, trackingUrl: (a) => `https://t/${a}`, createShipment: async () => ({ providerOrderId: 'r1', providerShipmentId: 's1', awb: 'AWB1', courier: 'TestCourier' }), label: async () => 'https://label', serviceability: async () => ({ serviceable: true, options: [] }), ...over });

test('status maps: courier wording to our statuses; unknown wording changes nothing', () => {
  assert.equal(mapShiprocketStatus('IN TRANSIT'), 'in-transit');
  assert.equal(mapShiprocketStatus('Out For Delivery'), 'out-for-delivery');
  assert.equal(mapShiprocketStatus('DELIVERED'), 'delivered');
  assert.equal(mapShiprocketStatus('UNDELIVERED-1ST ATTEMPT'), 'delivery-failed');
  assert.equal(mapShiprocketStatus('RTO INITIATED'), 'delivery-failed');
  assert.equal(mapShiprocketStatus('RTO DELIVERED'), 'returned');
  assert.equal(mapShiprocketStatus('PICKUP SCHEDULED'), null);
  assert.equal(mapShiprocketStatus('CANCELED'), null);
  assert.equal(mapDelhiveryStatus({ status: 'In Transit', statusType: 'UD' }), 'in-transit');
  assert.equal(mapDelhiveryStatus({ status: 'Dispatched', statusType: 'UD' }), 'out-for-delivery');
  assert.equal(mapDelhiveryStatus({ status: 'Delivered', statusType: 'DL' }), 'delivered');
  assert.equal(mapDelhiveryStatus({ status: 'In Transit', statusType: 'RT' }), 'delivery-failed');
  assert.equal(mapDelhiveryStatus({ status: 'Manifested', statusType: 'UD' }), null);
  assert.equal(canCourierMove('delivered', 'in-transit'), false);
  assert.equal(canCourierMove('in-transit', 'shipped'), false);
  assert.equal(canCourierMove('pending', 'in-transit'), true);
});

test('shiprocket: logs in once, creates order then assigns AWB with the right payload', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/login')) return json(200, { token: 'tok' });
    if (url.endsWith('/orders/create/adhoc')) return json(200, { order_id: 111, shipment_id: 222 });
    if (url.endsWith('/courier/assign/awb')) return json(200, { response: { data: { awb_code: 'SR123', courier_name: 'Delhivery Surface' } } });
    if (url.includes('/courier/generate/label')) return json(200, { label_url: 'https://lbl' });
    throw new Error('unexpected ' + url);
  };
  const sr = createShiprocket({ email: 'e', password: 'p', pickupLocation: 'Primary', fetchImpl });
  const r = await sr.createShipment({ order: mkOrder(), parcel: defaults });
  assert.deepEqual(r, { providerOrderId: '111', providerShipmentId: '222', awb: 'SR123', courier: 'Delhivery Surface' });
  assert.equal(await sr.label(r), 'https://lbl');
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
  const create = calls.find((c) => c.url.endsWith('/orders/create/adhoc'));
  assert.equal(create.opts.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(create.opts.body);
  assert.equal(body.payment_method, 'Prepaid'); assert.equal(body.pickup_location, 'Primary'); assert.equal(body.sub_total, 3598);
  assert.equal(body.billing_phone, '9876543210'); assert.equal(body.order_id, 'PX-2026-0001'); assert.equal(body.weight, 0.5);
});
test('shiprocket: refreshes an expired token once on 401; failures become clean errors; missing pickup is explained', async () => {
  let logins = 0; let first = true;
  const fetchImpl = async (url) => {
    if (url.endsWith('/auth/login')) { logins++; return json(200, { token: `t${logins}` }); }
    if (first) { first = false; return json(401, {}); }
    return json(200, { data: { available_courier_companies: [{ courier_name: 'X', etd: 'Nov 5, 2026', rate: 52.5 }] } });
  };
  const sr = createShiprocket({ email: 'e', password: 'p', pickupLocation: 'P', fetchImpl });
  const s = await sr.serviceability({ pickupPincode: '800001', deliveryPincode: '110001', weightKg: 0.5 });
  assert.equal(logins, 2); assert.deepEqual(s.options[0], { courier: 'X', etd: 'Nov 5, 2026', ratePaise: 5250 });
  const bad = createShiprocket({ email: 'e', password: 'p', fetchImpl: async (u) => (u.endsWith('/auth/login') ? json(403, {}) : json(200, {})) });
  await assert.rejects(bad.serviceability({ pickupPincode: '1', deliveryPincode: '2', weightKg: 1 }), (e) => e.code === 'COURIER_AUTH_FAILED');
  await assert.rejects(createShiprocket({ email: 'e', password: 'p', fetchImpl }).createShipment({ order: mkOrder(), parcel: defaults }), (e) => e.code === 'PICKUP_NOT_CONFIGURED');
  assert.equal(createShiprocket({ email: '', password: '' }).configured, false);
});
test('delhivery: token header, staging host, form body with pickup warehouse; label and tracking parsed', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/cmu/create.json')) return json(200, { success: true, packages: [{ waybill: 'DL999', refnum: 'PX-2026-0001' }] });
    if (url.includes('/api/p/packing_slip')) return json(200, { packages: [{ pdf_download_link: 'https://slip' }] });
    if (url.includes('/api/v1/packages/json')) return json(200, { ShipmentData: [{ Shipment: { Status: { Status: 'In Transit', StatusType: 'UD', StatusDateTime: '2026-11-02T10:00:00' } } }] });
    if (url.includes('/c/api/pin-codes/json')) return json(200, { delivery_codes: [{ postal_code: { pin: 110001, pre_paid: 'Y' } }] });
    throw new Error('unexpected ' + url);
  };
  const dl = createDelhivery({ token: 'TKN', mode: 'staging', pickupLocation: 'My Warehouse', fetchImpl });
  const r = await dl.createShipment({ order: mkOrder(), parcel: defaults });
  assert.equal(r.awb, 'DL999');
  const c = calls[0]; assert.ok(c.url.startsWith('https://staging-express.delhivery.com')); assert.equal(c.opts.headers.Authorization, 'Token TKN');
  const form = new URLSearchParams(c.opts.body); assert.equal(form.get('format'), 'json');
  const data = JSON.parse(form.get('data'));
  assert.equal(data.pickup_location.name, 'My Warehouse'); assert.equal(data.shipments[0].payment_mode, 'Prepaid'); assert.equal(data.shipments[0].cod_amount, 0); assert.equal(data.shipments[0].weight, 500);
  assert.equal(await dl.label(r), 'https://slip');
  assert.deepEqual(await dl.track('DL999'), { status: 'In Transit', statusType: 'UD', statusText: 'In Transit', at: '2026-11-02T10:00:00' });
  assert.equal((await dl.serviceability({ deliveryPincode: '110001' })).serviceable, true);
  assert.ok(createDelhivery({ token: 'x', mode: 'production', fetchImpl }).trackingUrl('A').includes('delhivery.com'));
  await assert.rejects(createDelhivery({ token: 'x', fetchImpl }).createShipment({ order: mkOrder(), parcel: defaults }), (e) => e.code === 'PICKUP_NOT_CONFIGURED');
  const failing = createDelhivery({ token: 'x', pickupLocation: 'W', fetchImpl: async () => json(200, { success: false, packages: [{ remarks: 'Pin not serviceable' }] }) });
  await assert.rejects(failing.createShipment({ order: mkOrder(), parcel: defaults }), /Pin not serviceable/);
});

const setup = async (order = mkOrder()) => { const db = createFakeDb({ unique: { webhook_events: ['eventId'], shipments: ['awb'] } }); await db.collection('orders').insertOne(order); return db; };
test('shipment: only for paid, approved, packed orders; one per order; failure releases the claim', async () => {
  const providers = { shiprocket: fakeProvider('shiprocket') };
  const run = (db, extra = {}) => createShipment({ db, providers, orderId: 'PX-2026-0001', providerName: 'shiprocket', defaults, actor, ...extra });
  await assert.rejects(run(await setup(mkOrder({ paymentStatus: 'pending' }))), (e) => e.code === 'PAYMENT_REQUIRED');
  await assert.rejects(run(await setup(mkOrder({ productionStatus: 'printing' }))), (e) => e.code === 'NOT_PACKED');
  await assert.rejects(run(await setup(mkOrder({ customPreviewStatus: 'preview-ready' }))), (e) => e.code === 'APPROVAL_REQUIRED');
  await assert.rejects(run(await setup(), { providerName: 'delhivery' }), (e) => e.code === 'COURIER_NOT_CONFIGURED');
  await assert.rejects(run(await setup(), { parcel: { weightKg: -1 } }), (e) => e.code === 'INVALID_PARCEL');
  const db = await setup();
  const results = await Promise.allSettled([run(db), run(db), run(db)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const o = await db.collection('orders').findOne({ id: 'PX-2026-0001' });
  assert.equal(o.trackingNumber, 'AWB1'); assert.equal(o.courierName, 'TestCourier'); assert.equal(await db.collection('shipments').countDocuments({}), 1);
  const db2 = await setup();
  const broken = { shiprocket: fakeProvider('shiprocket', { createShipment: async () => { throw new Error('down'); } }) };
  await assert.rejects(createShipment({ db: db2, providers: broken, orderId: 'PX-2026-0001', providerName: 'shiprocket', defaults, actor }));
  assert.equal((await db2.collection('orders').findOne({ id: 'PX-2026-0001' })).shipmentClaimed, false);
  assert.equal((await createShipment({ db: db2, providers, orderId: 'PX-2026-0001', providerName: 'shiprocket', defaults, actor })).awb, 'AWB1');
});
const withShipment = async (provider = 'shiprocket', orderOver = {}) => { const db = await setup(mkOrder(orderOver)); const sh = { _id: 's1', orderId: 'PX-2026-0001', provider, awb: 'AWB1' }; await db.collection('shipments').insertOne(sh); return { db, sh }; };
test('courier updates: forward only, final states stick, each event applied once, delivery completes the order', async () => {
  const { db, sh } = await withShipment();
  const upd = (target, key) => applyCourierUpdate({ db, shipment: sh, target, statusText: target, eventKey: key, source: 'shiprocket' });
  assert.equal((await upd('in-transit', 'e1')).changed, true);
  assert.equal((await upd('in-transit', 'e1')).duplicate, true);
  assert.equal((await upd('shipped', 'e2')).ignored, true);
  assert.equal((await upd(null, 'e3')).ignored, true);
  assert.equal((await upd('delivered', 'e4')).delivered, true);
  const o = await db.collection('orders').findOne({ id: 'PX-2026-0001' });
  assert.equal(o.shippingStatus, 'delivered'); assert.equal(o.status, 'completed');
  assert.equal((await upd('in-transit', 'e5')).ignored, true);
  assert.equal(await db.collection('audit_logs').countDocuments({ action: 'courier_status' }), 2);
});
test('shiprocket webhook: maps status, ignores unknown AWBs and unmapped statuses', async () => {
  const { db } = await withShipment();
  assert.equal((await handleShiprocketWebhook({ db, body: { awb: 'NOPE', current_status: 'DELIVERED' } })).unmatched, true);
  assert.equal((await handleShiprocketWebhook({ db, body: { awb: 'AWB1', current_status: 'PICKUP SCHEDULED', current_status_id: 3 } })).ignored, true);
  const r = await handleShiprocketWebhook({ db, body: { awb: 'AWB1', current_status: 'OUT FOR DELIVERY', current_status_id: 17, current_timestamp: 't' } });
  assert.equal(r.to, 'out-for-delivery');
});
test('delhivery webhook: payload only names the waybill; status comes from the verified pull, never the pushed body', async () => {
  const { db } = await withShipment('delhivery');
  const providers = { delhivery: { configured: true, track: async () => ({ status: 'In Transit', statusType: 'UD', statusText: 'In Transit', at: 't1' }) } };
  const forged = { Shipment: { AWB: 'AWB1', Status: { Status: 'Delivered', StatusType: 'DL' } } };
  const r = await handleDelhiveryWebhook({ db, providers, body: forged });
  assert.equal(r.to, 'in-transit');
  assert.equal((await db.collection('orders').findOne({ id: 'PX-2026-0001' })).shippingStatus, 'in-transit');
  assert.equal((await handleDelhiveryWebhook({ db, providers, body: { Shipment: { AWB: 'UNKNOWN' } } })).unmatched, true);
});
test('serviceability: invalid pincode rejected; unconfigured says so; one courier failing does not hide the other; all failing is "unknown"', async () => {
  const config = { shipping: { pickupPincode: '800001', parcel: defaults } };
  await assert.rejects(checkServiceability({ providers: {}, config, pincode: '12' }), (e) => e.code === 'INVALID_PINCODE');
  assert.equal((await checkServiceability({ providers: {}, config, pincode: '110001' })).configured, false);
  const good = fakeProvider('delhivery'); const bad = fakeProvider('shiprocket', { serviceability: async () => { throw new Error('x'); } });
  assert.equal((await checkServiceability({ providers: { good, bad }, config, pincode: '110001' })).serviceable, true);
  assert.equal((await checkServiceability({ providers: { bad }, config, pincode: '110001' })).serviceable, null);
  assert.equal((await checkServiceability({ providers: { s: fakeProvider('shiprocket') }, config: { shipping: { pickupPincode: '', parcel: defaults } }, pincode: '110001' })).serviceable, null);
});
test('parcel: defaults apply, bad values rejected', () => {
  assert.deepEqual(resolveParcel(defaults), defaults);
  assert.equal(resolveParcel(defaults, { weightKg: 2 }).weightKg, 2);
  assert.throws(() => resolveParcel(defaults, { heightCm: 0 }));
  assert.throws(() => resolveParcel(defaults, { weightKg: 'abc' }));
});
