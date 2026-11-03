import { AppError } from './errors.js';

// Fixed-window limiter stored in MongoDB, so limits survive restarts and work across instances.
// Fails closed: if the store is down we return 503 rather than letting abuse through.
export const mongoRateLimit = ({ getDb, name, windowMs, max, key }) => async (req, _res, next) => {
  try {
    const bucket = Math.floor(Date.now() / windowMs);
    const doc = await getDb().collection('rate_limits').findOneAndUpdate(
      { _id: `${name}:${key(req)}:${bucket}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs + 60_000) } },
      { upsert: true, returnDocument: 'after' }
    );
    if ((doc?.count ?? 0) > max) return next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.'));
    next();
  } catch {
    next(new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Please try again shortly.'));
  }
};
