import { AppError } from '../../middleware/errors.js';
import { nextSequence } from '../../db/counters.js';

const bad = (m) => new AppError(400, 'INVALID_INPUT', m);
const txt = (v, max) => String(v ?? '').trim().slice(0, max);

export const createEnquiry = async ({ db, input = {}, now = new Date() }) => {
  // Hidden "website" field: humans leave it empty. Bots fill it, so we pretend success and store nothing.
  if (txt(input.website, 200)) return { id: 'TKT-000000', ignored: true };
  const type = input.type === 'bulk' ? 'bulk' : 'contact';
  const e = { type, name: txt(input.name, 120), email: txt(input.email, 200).toLowerCase(), phone: txt(input.phone, 20).replace(/[^\d+]/g, ''), message: txt(input.message, 2000), quantity: txt(input.quantity, 40), company: txt(input.company, 120) };
  if (!e.name) throw bad('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.email)) throw bad('A valid email is required.');
  if (e.phone && !/^(\+91)?[6-9]\d{9}$/.test(e.phone)) throw bad('Phone must be a valid 10-digit Indian mobile number.');
  if (e.message.length < 10) throw bad('Please write at least 10 characters.');
  const id = `TKT-${String(await nextSequence(db, 'ticket')).padStart(6, '0')}`;
  await db.collection('enquiries').insertOne({ _id: id, id, ...e, status: 'open', createdAt: now });
  return { id, type };
};
export const listEnquiries = async ({ db, status }) => (await db.collection('enquiries').find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).toArray()).map(({ _id, ...x }) => x);
export const setEnquiryStatus = async ({ db, id, status }) => {
  if (!['open', 'resolved'].includes(status)) throw bad('Status must be open or resolved.');
  const r = await db.collection('enquiries').updateOne({ _id: String(id) }, { $set: { status } });
  if (!r.matchedCount) throw new AppError(404, 'ENQUIRY_NOT_FOUND', 'Enquiry not found.');
  return { id, status };
};
