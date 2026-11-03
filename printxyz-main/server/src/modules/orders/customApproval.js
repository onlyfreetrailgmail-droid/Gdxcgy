import { AppError } from '../../middleware/errors.js';
import { canAccessOrder } from './orderService.js';

export const MAX_REVISIONS = 2;

// Customer decision on an admin-sent design preview. Production cannot start until this is "approved".
export const respondToPreview = async ({ db, orderId, user, guestToken, action, note, now = new Date() }) => {
  const order = await db.collection('orders').findOne({ id: String(orderId || '') });
  if (!canAccessOrder(order, { user, guestToken })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.customPreviewStatus !== 'preview-ready') throw new AppError(409, 'NO_PREVIEW_PENDING', 'There is no preview waiting for your decision.');
  const at = now.toISOString();
  if (action === 'approve') {
    const r = await db.collection('orders').updateOne({ _id: order._id, customPreviewStatus: 'preview-ready' },
      { $set: { customPreviewStatus: 'approved', approvedAt: now }, $push: { statusHistory: { status: 'design-approved', at } } });
    if (!r.modifiedCount) throw new AppError(409, 'CONFLICT', 'This preview was already answered.');
    return { decision: 'approved' };
  }
  if (action === 'request_changes') {
    const text = String(note || '').trim().slice(0, 600);
    if (text.length < 5) throw new AppError(400, 'NOTE_REQUIRED', 'Please describe the changes you want.');
    if ((order.revisionCount || 0) >= MAX_REVISIONS) throw new AppError(409, 'REVISION_LIMIT', `You have used all ${MAX_REVISIONS} free revisions. Please contact support.`);
    const r = await db.collection('orders').updateOne({ _id: order._id, customPreviewStatus: 'preview-ready' },
      { $set: { customPreviewStatus: 'changes-requested', changeRequest: text }, $inc: { revisionCount: 1 }, $push: { statusHistory: { status: 'changes-requested', at } } });
    if (!r.modifiedCount) throw new AppError(409, 'CONFLICT', 'This preview was already answered.');
    return { decision: 'changes-requested' };
  }
  throw new AppError(400, 'INVALID_ACTION', 'Action must be approve or request_changes.');
};
