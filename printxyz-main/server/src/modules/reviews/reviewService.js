import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

const bad = (m) => new AppError(400, 'INVALID_REVIEW', m);

// Only a signed-in customer who received this product can review it, once.
export const REVIEW_PHOTO_PREFIX = 'printxyz/review-photos/';
export const MAX_REVIEW_PHOTOS = 3;

export const submitReview = async ({ db, userId, productId, rating, title, body, photos = [], now = new Date() }) => {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw bad('Rating must be a whole number from 1 to 5.');
  const text = String(body || '').trim().slice(0, 1000); const head = String(title || '').trim().slice(0, 100);
  if (text.length < 10) throw bad('Please write at least 10 characters.');
  const product = await db.collection('products').findOne({ id: String(productId || '') });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const orders = await db.collection('orders').find({ userId, shippingStatus: 'delivered' }).toArray();
  if (!orders.some((o) => o.items.some((l) => l.productId === product.id))) throw new AppError(403, 'NOT_VERIFIED_BUYER', 'Only customers who received this product can review it.');
  if (await db.collection('reviews').findOne({ userId, productId: product.id })) throw new AppError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product.');
  // Photos must be ones this customer just uploaded through the review-photo endpoint.
  const ids = [...new Set((Array.isArray(photos) ? photos : []).map((p) => String(p?.publicId ?? p ?? '')))];
  if (ids.length > MAX_REVIEW_PHOTOS) throw bad(`You can add up to ${MAX_REVIEW_PHOTOS} photos.`);
  for (const id of ids) {
    const up = id.startsWith(REVIEW_PHOTO_PREFIX) ? await db.collection('review_uploads').findOne({ publicId: id, userId, used: false }) : null;
    if (!up) throw bad('One of the photos was not uploaded by you or was already used.');
  }
  const user = await db.collection('users').findOne({ id: userId });
  const doc = { _id: crypto.randomUUID(), productId: product.id, userId, name: String(user?.name || 'Customer').split(' ')[0].slice(0, 40), rating: r, title: head, body: text, photos: ids, status: 'pending', createdAt: now };
  try { await db.collection('reviews').insertOne(doc); } catch (e) { if (e?.code === 11000) throw new AppError(409, 'ALREADY_REVIEWED', 'You have already reviewed this product.'); throw e; }
  for (const id of ids) await db.collection('review_uploads').updateOne({ publicId: id, userId }, { $set: { used: true, reviewId: doc._id } });
  return { id: doc._id, status: 'pending' };
};

export const recordReviewUpload = async ({ db, userId, publicId, now = new Date() }) => db.collection('review_uploads').insertOne({ publicId, userId, used: false, createdAt: now });

const recompute = async (db, productId) => {
  const approved = await db.collection('reviews').find({ productId, status: 'approved' }).toArray();
  const avg = approved.length ? Math.round((approved.reduce((s, x) => s + x.rating, 0) / approved.length) * 10) / 10 : 0;
  await db.collection('products').updateOne({ id: productId }, { $set: { rating: avg, reviews: approved.length } });
  return { rating: avg, reviews: approved.length };
};

export const moderateReview = async ({ db, id, action, actor, cloudinary = null, now = new Date() }) => {
  if (!['approve', 'reject'].includes(action)) throw bad('Action must be approve or reject.');
  const review = await db.collection('reviews').findOne({ _id: String(id) });
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  await db.collection('reviews').updateOne({ _id: review._id }, { $set: { status: action === 'approve' ? 'approved' : 'rejected', moderatedBy: actor.email, moderatedAt: now } });
  if (action === 'reject' && cloudinary?.configured) for (const pid of review.photos || []) { try { await cloudinary.destroyPublic(pid); } catch { /* best effort */ } }
  await db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action: `review_${action}`, targetType: 'review', targetId: review._id, reason: '', changes: [] });
  return recompute(db, review.productId);
};
export const listApproved = async ({ db, productId, urlFor = null }) =>
  (await db.collection('reviews').find({ productId, status: 'approved' }).sort({ createdAt: -1 }).limit(50).toArray()).map((r) => ({ id: r._id, name: r.name, rating: r.rating, title: r.title, body: r.body, createdAt: r.createdAt, photos: urlFor ? (r.photos || []).map((p) => urlFor(p)) : [] }));
export const listPending = async ({ db, urlFor = null }) => (await db.collection('reviews').find({ status: 'pending' }).sort({ createdAt: 1 }).toArray()).map((r) => ({ id: r._id, productId: r.productId, name: r.name, rating: r.rating, title: r.title, body: r.body, createdAt: r.createdAt, photos: urlFor ? (r.photos || []).map((p) => urlFor(p)) : [] }));

export const listRecent = async ({ db, limit = 3 }) =>
  (await db.collection('reviews').find({ status: 'approved' }).sort({ createdAt: -1 }).limit(limit).toArray()).map((r) => ({ id: r._id, name: r.name, rating: r.rating, body: r.body.slice(0, 220) }));

// Photos uploaded for a review that was never submitted are removed after a week.
export const purgeUnusedReviewUploads = async ({ db, cloudinary, now = new Date(), maxAgeMs = 7 * 24 * 3600_000 }) => {
  if (!cloudinary?.configured) return { purged: 0 };
  const stale = await db.collection('review_uploads').find({ used: false, createdAt: { $lte: new Date(now.getTime() - maxAgeMs) } }).limit(100).toArray();
  let purged = 0;
  for (const u of stale) { try { await cloudinary.destroyPublic(u.publicId); await db.collection('review_uploads').deleteOne({ _id: u._id }); purged += 1; } catch { /* retry tomorrow */ } }
  return { purged };
};
