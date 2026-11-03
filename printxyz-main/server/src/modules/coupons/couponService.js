import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

const bad = (m) => new AppError(400, 'INVALID_COUPON', m);
const date = (v, label) => { if (v === undefined || v === null || v === '') return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid date.`); return d; };
const optInt = (v, label, min = 0) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < min) throw bad(`${label} must be a whole number.`); return n; };

// Admin enters rupees; stored as integer paise (matching the pricing engine).
export const validateCoupon = (b = {}, existing = null) => {
  const code = String(b.code ?? existing?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw bad('Code must be 3 to 20 letters or digits.');
  const type = b.type ?? existing?.type;
  if (!['percent', 'flat'].includes(type)) throw bad('Type must be percent or flat.');
  const value = Number(b.value ?? (existing ? (existing.type === 'flat' ? existing.value / 100 : existing.value) : NaN));
  if (type === 'percent' && !(Number.isInteger(value) && value >= 1 && value <= 100)) throw bad('Percent must be a whole number from 1 to 100.');
  if (type === 'flat' && !(Number.isFinite(value) && value > 0 && value <= 1_000_000)) throw bad('Flat amount must be a positive number of rupees.');
  const rupeesToPaise = (v, label) => { if (v === undefined || v === null || v === '') return null; const n = Math.round(Number(v) * 100); if (!Number.isInteger(n) || n < 0) throw bad(`${label} must be a valid amount.`); return n; };
  const startsAt = date(b.startsAt ?? existing?.startsAt, 'Start date'); const expiresAt = date(b.expiresAt ?? existing?.expiresAt, 'Expiry date');
  if (startsAt && expiresAt && expiresAt <= startsAt) throw bad('Expiry must be after the start date.');
  return {
    code, type, value: type === 'flat' ? Math.round(value * 100) : value,
    minOrderPaise: rupeesToPaise(b.minOrder, 'Minimum order') ?? existing?.minOrderPaise ?? 0,
    maxDiscountPaise: b.maxDiscount === undefined ? (existing?.maxDiscountPaise ?? null) : rupeesToPaise(b.maxDiscount, 'Maximum discount'),
    usageLimit: b.usageLimit === undefined ? (existing?.usageLimit ?? null) : optInt(b.usageLimit, 'Usage limit', 1),
    perUserLimit: b.perUserLimit === undefined ? (existing?.perUserLimit ?? null) : optInt(b.perUserLimit, 'Per-customer limit', 1),
    startsAt, expiresAt, active: b.active === undefined ? existing?.active !== false : Boolean(b.active)
  };
};

export const listCoupons = async ({ db }) => (await db.collection('coupons').find({}).sort({ code: 1 }).toArray()).map(({ _id, ...c }) => ({ id: _id, ...c }));
export const createCoupon = async ({ db, body }) => {
  const doc = { _id: crypto.randomUUID(), ...validateCoupon(body), usedCount: 0, createdAt: new Date() };
  try { await db.collection('coupons').insertOne(doc); } catch (e) { if (e?.code === 11000) throw new AppError(409, 'COUPON_EXISTS', 'A coupon with this code already exists.'); throw e; }
  const { _id, ...rest } = doc; return { id: _id, ...rest };
};
export const updateCoupon = async ({ db, id, body }) => {
  const existing = await db.collection('coupons').findOne({ _id: String(id) });
  if (!existing) throw new AppError(404, 'COUPON_NOT_FOUND', 'Coupon not found.');
  const next = validateCoupon({ ...body, code: existing.code }, existing);   // the code never changes after creation
  await db.collection('coupons').updateOne({ _id: existing._id }, { $set: next });
  const { _id, ...rest } = await db.collection('coupons').findOne({ _id: existing._id }); return { id: _id, ...rest };
};
