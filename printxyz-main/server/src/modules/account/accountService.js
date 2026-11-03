import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { toClientOrder } from '../orders/orderService.js';

const bad = (m) => new AppError(400, 'INVALID_INPUT', m);
const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const MAX_ADDRESSES = 10;
export const MAX_WISHLIST = 200;

export const validateAddress = (a = {}) => {
  const out = { label: txt(a.label || 'Home', 30), name: txt(a.name, 120), phone: txt(a.phone, 20).replace(/[^\d+]/g, ''),
    street: txt(a.street), apartment: txt(a.apartment), landmark: txt(a.landmark), city: txt(a.city, 80), state: txt(a.state, 80), pincode: txt(a.pincode, 6) };
  if (!out.name || !out.street || !out.city || !out.state) throw bad('Name, street, city and state are required.');
  if (!/^(\+91)?[6-9]\d{9}$/.test(out.phone)) throw bad('A valid 10-digit Indian mobile number is required.');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) throw bad('A valid 6-digit pincode is required.');
  return out;
};

const publicProfile = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', dob: u.dob || '', picture: u.picture || '' });
const need = async (db, userId) => { const u = await db.collection('users').findOne({ id: userId }); if (!u || u.deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found.'); return u; };

export const getProfile = async ({ db, userId }) => publicProfile(await need(db, userId));
export const updateProfile = async ({ db, userId, body = {} }) => {
  await need(db, userId);
  const set = {};
  if (body.name !== undefined) { set.name = txt(body.name, 120); if (!set.name) throw bad('Name cannot be empty.'); }
  if (body.phone !== undefined) { const p = txt(body.phone, 20).replace(/[^\d+]/g, ''); if (p && !/^(\+91)?[6-9]\d{9}$/.test(p)) throw bad('A valid 10-digit Indian mobile number is required.'); set.phone = p; }
  if (body.dob !== undefined) { const d = txt(body.dob, 10); if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || new Date(d) > new Date())) throw bad('Date of birth must be a past date (YYYY-MM-DD).'); set.dob = d; }
  if (Object.keys(set).length) await db.collection('users').updateOne({ id: userId }, { $set: set });
  return getProfile({ db, userId });
};

export const listAddresses = async ({ db, userId }) => (await db.collection('addresses').find({ userId }).sort({ createdAt: 1 }).toArray()).map(({ _id, userId: _u, ...a }) => ({ id: _id, ...a }));
export const addAddress = async ({ db, userId, body }) => {
  const a = validateAddress(body);
  if ((await db.collection('addresses').countDocuments({ userId })) >= MAX_ADDRESSES) throw new AppError(409, 'ADDRESS_LIMIT', `You can save up to ${MAX_ADDRESSES} addresses.`);
  const first = (await db.collection('addresses').countDocuments({ userId })) === 0;
  const doc = { _id: crypto.randomUUID(), userId, ...a, isDefault: first, createdAt: new Date() };
  await db.collection('addresses').insertOne(doc);
  return { id: doc._id, ...a, isDefault: first };
};
const own = async (db, userId, id) => { const a = await db.collection('addresses').findOne({ _id: String(id), userId }); if (!a) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found.'); return a; };
export const updateAddress = async ({ db, userId, id, body }) => {
  await own(db, userId, id);
  await db.collection('addresses').updateOne({ _id: String(id), userId }, { $set: validateAddress(body) });
  return (await listAddresses({ db, userId })).find((a) => a.id === String(id));
};
export const setDefaultAddress = async ({ db, userId, id }) => {
  await own(db, userId, id);
  for (const a of await db.collection('addresses').find({ userId }).toArray()) await db.collection('addresses').updateOne({ _id: a._id }, { $set: { isDefault: a._id === String(id) } });
};
export const deleteAddress = async ({ db, userId, id }) => {
  const a = await own(db, userId, id);
  await db.collection('addresses').deleteOne({ _id: a._id, userId });
  if (a.isDefault) { const [next] = await db.collection('addresses').find({ userId }).sort({ createdAt: 1 }).limit(1).toArray(); if (next) await db.collection('addresses').updateOne({ _id: next._id }, { $set: { isDefault: true } }); }
};

export const getWishlist = async ({ db, userId }) => (await db.collection('wishlists').findOne({ userId }))?.productIds || [];
export const addToWishlist = async ({ db, userId, productId }) => {
  const id = txt(productId, 60);
  if (!(await db.collection('products').findOne({ id, published: { $ne: false } }))) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const ids = await getWishlist({ db, userId });
  if (ids.includes(id)) return ids;
  if (ids.length >= MAX_WISHLIST) throw new AppError(409, 'WISHLIST_LIMIT', 'Your wishlist is full.');
  const next = [...ids, id];
  await db.collection('wishlists').updateOne({ userId }, { $set: { userId, productIds: next } }, { upsert: true });
  return next;
};
export const removeFromWishlist = async ({ db, userId, productId }) => {
  const next = (await getWishlist({ db, userId })).filter((x) => x !== String(productId));
  await db.collection('wishlists').updateOne({ userId }, { $set: { userId, productIds: next } }, { upsert: true });
  return next;
};

// Communication preferences are keyed by email so guests and accounts share one opt-out.
export const getPreferences = async ({ db, userId }) => {
  const u = await need(db, userId); const p = (await db.collection('email_prefs').findOne({ email: u.email })) || {};
  return { transactional: true, marketing: p.marketing === true, whatsapp: p.whatsapp === true, reminders: !p.optOut };
};
export const updatePreferences = async ({ db, userId, body = {} }) => {
  const u = await need(db, userId); const set = {};
  if (body.marketing !== undefined) set.marketing = body.marketing === true;
  if (body.whatsapp !== undefined) set.whatsapp = body.whatsapp === true;
  if (body.reminders !== undefined) set.optOut = body.reminders !== true;
  await db.collection('email_prefs').updateOne({ email: u.email }, { $set: { email: u.email, ...set } }, { upsert: true });
  return getPreferences({ db, userId });
};

export const exportData = async ({ db, userId }) => {
  const u = await need(db, userId);
  const orders = await db.collection('orders').find({ userId }).sort({ createdAt: -1 }).toArray();
  return { exportedAt: new Date().toISOString(), profile: publicProfile(u), addresses: await listAddresses({ db, userId }), wishlist: await getWishlist({ db, userId }),
    preferences: await getPreferences({ db, userId }), orders: orders.map((o) => toClientOrder(o)) };
};

// Deletes personal data. Orders and invoices are kept for bookkeeping but lose contact details.
export const deleteAccount = async ({ db, userId, confirm, now = new Date() }) => {
  const u = await need(db, userId);
  if (confirm !== 'DELETE') throw bad('Type DELETE to confirm.');
  const open = await db.collection('orders').countDocuments({ userId, paymentStatus: { $in: ['paid', 'advance_paid'] }, status: 'confirmed' });
  if (open) throw new AppError(409, 'OPEN_ORDERS', 'You have paid orders that are not delivered yet. Please try again after they are delivered, or contact support.');
  for (const a of await db.collection('addresses').find({ userId }).toArray()) await db.collection('addresses').deleteOne({ _id: a._id });
  await db.collection('wishlists').deleteOne({ userId });
  await db.collection('email_prefs').deleteOne({ email: u.email });
  for (;;) { const r = await db.collection('refresh_tokens').deleteOne({ userId }); if (!r.deletedCount) break; }
  for (const o of await db.collection('orders').find({ userId }).toArray()) {
    await db.collection('orders').updateOne({ _id: o._id }, { $set: { userId: '', customerEmail: '', customer: { ...o.customer, name: 'Deleted customer', email: '', phone: '', street: '', apartment: '', landmark: '' }, guestToken: crypto.randomBytes(24).toString('hex'), anonymisedAt: now } });
  }
  await db.collection('users').updateOne({ id: userId }, { $set: { email: `deleted-${userId}@deleted.invalid`, name: 'Deleted user', phone: '', dob: '', picture: '', role: 'deleted', passwordHash: crypto.randomBytes(32).toString('hex'), deletedAt: now } });
  return { deleted: true };
};
