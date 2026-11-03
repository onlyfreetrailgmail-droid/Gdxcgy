export const PHOTO_RETENTION_DAYS = 90;
export const photoIdsOf = (order) => (order.items || []).flatMap((l) => (Array.isArray(l.options?.photos) ? l.options.photos : [])).filter((id) => typeof id === 'string');

// Deletes customer photos once an order is finished (or abandoned) and the retention period has passed.
export const purgeExpiredPhotos = async ({ db, cloudinary, now = new Date(), retentionDays = PHOTO_RETENTION_DAYS }) => {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const candidates = await db.collection('orders').find({ status: { $in: ['completed', 'cancelled', 'expired'] }, createdAt: { $lte: cutoff }, photosPurgedAt: null }).toArray();
  let purged = 0;
  for (const o of candidates) {
    const ids = photoIdsOf(o);
    try { for (const id of ids) await cloudinary.destroy(id); } catch { continue; }
    await db.collection('orders').updateOne({ _id: o._id }, { $set: { photosPurgedAt: now } });
    purged += ids.length;
  }
  return purged;
};
