import { enqueueEmail } from '../notifications/queue.js';

export const MAX_BALANCE_REMINDERS = 3;
export const REMINDER_GAP_MS = 3 * 24 * 3600_000;

// Asks the customer for the remaining amount. Idempotent: the first request stamps the order and sends the email once.
export const requestBalance = async ({ db, order, now = new Date() }) => {
  if (order.paymentPlan !== 'advance' || order.paymentStatus !== 'advance_paid' || order.status !== 'confirmed') return { requested: false };
  const r = await db.collection('orders').updateOne({ _id: order._id, balanceRequestedAt: null, paymentStatus: 'advance_paid' }, { $set: { balanceRequestedAt: now, balanceLastReminderAt: now } });
  if (!r.modifiedCount) return { requested: false, already: true };
  if (order.customerEmail) await enqueueEmail({ db, to: order.customerEmail, template: 'balance_due', key: `balance_due:${order.id}`, now,
    data: { name: order.customer?.name || 'there', orderId: order.id, balance: order.balancePaise / 100, trackToken: order.guestToken } });
  return { requested: true };
};

// Runs from the background sweeper: at most MAX_BALANCE_REMINDERS reminders, one every 3 days, only while the balance is unpaid.
export const sendBalanceReminders = async ({ db, now = new Date() }) => {
  const due = await db.collection('orders').find({ paymentPlan: 'advance', paymentStatus: 'advance_paid', status: 'confirmed',
    balanceRequestedAt: { $ne: null }, balanceReminders: { $lt: MAX_BALANCE_REMINDERS }, balanceLastReminderAt: { $lte: new Date(now.getTime() - REMINDER_GAP_MS) } }).toArray();
  let sent = 0;
  for (const o of due) {
    const n = (o.balanceReminders || 0) + 1;
    const claim = await db.collection('orders').updateOne({ _id: o._id, balanceReminders: o.balanceReminders || 0 }, { $set: { balanceReminders: n, balanceLastReminderAt: now } });
    if (!claim.modifiedCount || !o.customerEmail) continue;
    await enqueueEmail({ db, to: o.customerEmail, template: 'balance_reminder', category: 'reminder', key: `balance_rem:${o.id}:${n}`, now,
      data: { name: o.customer?.name || 'there', orderId: o.id, balance: o.balancePaise / 100, trackToken: o.guestToken } });
    sent += 1;
  }
  return { sent };
};
