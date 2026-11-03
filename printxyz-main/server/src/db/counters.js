// Atomic, never-reused sequence numbers. A counter document is incremented in one
// database operation, so concurrent checkouts can never receive the same number.
export const nextSequence = async (db, name) => {
  const doc = await db.collection('counters').findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  return doc.seq;
};
export const formatOrderNumber = (year, seq) => `PX-${year}-${String(seq).padStart(4, '0')}`;
export const nextOrderNumber = async (db, now = new Date()) => {
  const year = now.getUTCFullYear();
  return formatOrderNumber(year, await nextSequence(db, `order:${year}`));
};
