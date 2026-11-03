import { validateGstin, ALLOWED_RATES } from '../billing/gst.js';
import { AppError } from '../../middleware/errors.js';
import { DEFAULT_SETTINGS } from '../pricing/pricing.js';

const bad = (m) => new AppError(400, 'INVALID_INPUT', m);
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const audit = (db, actor, action, changes, now) => db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action, targetType: 'settings', targetId: action, reason: '', changes });

export const getShippingSettings = async (db, defaults = DEFAULT_SETTINGS) => {
  const s = (await db.collection('settings').findOne({ _id: 'shipping' })) || {};
  return { freeShippingThresholdPaise: s.freeShippingThresholdPaise ?? defaults.freeShippingThresholdPaise, shippingFeePaise: s.shippingFeePaise ?? defaults.shippingFeePaise };
};
// Pricing settings = shipping threshold + fee (DB value wins, env/defaults otherwise). app.js uses this name.
export const getPricingSettings = (db, defaults = DEFAULT_SETTINGS) => getShippingSettings(db, defaults);
// Admin enters rupees; stored as integer paise.
export const updateShippingSettings = async ({ db, body = {}, actor, defaults = DEFAULT_SETTINGS, now = new Date() }) => {
  const threshold = Math.round(Number(body.freeShippingThreshold) * 100); const fee = Math.round(Number(body.shippingFee) * 100);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100_000_000) throw bad('Free-shipping threshold must be a valid amount in rupees.');
  if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000) throw bad('Shipping fee must be a valid amount in rupees.');
  const before = await getShippingSettings(db, defaults);
  await db.collection('settings').updateOne({ _id: 'shipping' }, { $set: { freeShippingThresholdPaise: threshold, shippingFeePaise: fee } }, { upsert: true });
  await audit(db, actor, 'update_shipping_settings', [{ field: 'shipping', from: JSON.stringify(before), to: JSON.stringify({ threshold, fee }) }], now);
  return getShippingSettings(db, defaults);
};

export const getBusinessAdmin = async (db) => {
  const s = (await db.collection('settings').findOne({ _id: 'business' })) || {};
  return { legalName: s.legalName || '', address: s.address || '', phone: s.phone || '', email: s.email || '', terms: s.terms || '', gstEnabled: Boolean(s.gstEnabled), gstin: s.gstin || '', gstRatePercent: Number.isInteger(s.gstRatePercent) ? s.gstRatePercent : 18, defaultHsn: s.defaultHsn || '' };
};
export const updateBusiness = async ({ db, body = {}, actor, now = new Date() }) => {
  const email = txt(body.email, 120); const phone = txt(body.phone, 20);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Enter a valid business email.');
  if (phone && !/^[+\d][\d\s-]{6,18}$/.test(phone)) throw bad('Enter a valid business phone number.');
  const set = { legalName: txt(body.legalName, 120), address: txt(body.address, 300), phone, email, terms: txt(body.terms, 600) };
  if (!set.legalName || !set.address) throw bad('Business name and address are required.');
  // GST can only be switched on with a valid GSTIN; the state for CGST/SGST vs IGST comes from its first two digits.
  const rate = body.gstRatePercent === undefined || body.gstRatePercent === '' ? 18 : Number(body.gstRatePercent);
  if (!ALLOWED_RATES.includes(rate)) throw bad('GST rate must be one of 0, 5, 12, 18 or 28.');
  const hsn = String(body.defaultHsn || '').trim();
  if (hsn && !/^\d{4,8}$/.test(hsn)) throw bad('HSN code must be 4 to 8 digits.');
  const gstin = String(body.gstin || '').trim().toUpperCase();
  if (body.gstEnabled) { const v = validateGstin(gstin); if (!v.valid) throw bad(v.reason); }
  else if (gstin && !validateGstin(gstin).valid) throw bad(validateGstin(gstin).reason);
  Object.assign(set, { gstEnabled: Boolean(body.gstEnabled), gstin, gstRatePercent: rate, defaultHsn: hsn });
  await db.collection('settings').updateOne({ _id: 'business' }, { $set: set }, { upsert: true });
  await audit(db, actor, 'update_business_settings', [{ field: 'business', from: '', to: 'updated' }], now);
  return getBusinessAdmin(db);
};
