import crypto from 'node:crypto';
import { renderEmail } from './templates.js';

export const MAX_ATTEMPTS = 5;
const STALE_LOCK_MS = 10 * 60_000;
const lower = (v) => String(v || '').trim().toLowerCase();

export const unsubscribeToken = (email, secret) => crypto.createHmac('sha256', secret).update(`unsub|${lower(email)}`).digest('hex').slice(0, 32);
export const verifyUnsubscribeToken = (email, token, secret) => {
  const a = Buffer.from(unsubscribeToken(email, secret)); const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// category: transactional (always sent), reminder (skipped after opt-out, has unsubscribe link), marketing (needs opt-in).
// The key makes enqueueing idempotent, so retries and duplicate events never send twice.
export const enqueueEmail = async ({ db, to, template, data, key, category = 'transactional', now = new Date(), sendAfter = null }) => {
  const job = { _id: crypto.randomUUID(), key, to: lower(to), template, data, category, status: 'pending', attempts: 0, nextAttemptAt: sendAfter || now, createdAt: now };
  try { await db.collection('email_queue').insertOne(job); } catch (e) { if (e?.code === 11000) return { duplicate: true }; throw e; }
  return { queued: true, id: job._id };
};

const releaseStale = async (db, now) => {
  const stale = await db.collection('email_queue').find({ status: 'sending', lockedAt: { $lte: new Date(now.getTime() - STALE_LOCK_MS) } }).toArray();
  for (const j of stale) await db.collection('email_queue').updateOne({ _id: j._id, status: 'sending' }, { $set: { status: 'pending', nextAttemptAt: now } });
};

// Sends due emails with bounded retries. A provider outage never blocks checkout: failures stay in the queue.
export const processQueue = async ({ db, mailer, siteUrl, secret, now = new Date(), batch = 10 }) => {
  const out = { sent: 0, retried: 0, failed: 0, suppressed: 0 };
  if (!mailer?.configured) return out;           // jobs wait until email is configured
  await releaseStale(db, now);
  for (let i = 0; i < batch; i++) {
    const job = await db.collection('email_queue').findOneAndUpdate(
      { status: 'pending', nextAttemptAt: { $lte: now } }, { $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { createdAt: 1 } });
    if (!job) break;
    const prefs = (await db.collection('email_prefs').findOne({ email: job.to })) || {};
    const blocked = (await db.collection('email_suppressions').findOne({ email: job.to }))
      || (job.category === 'reminder' && prefs.optOut) || (job.category === 'marketing' && prefs.marketing !== true);
    if (blocked) { await db.collection('email_queue').updateOne({ _id: job._id }, { $set: { status: 'suppressed' } }); out.suppressed++; continue; }
    try {
      const unsubscribeUrl = job.category !== 'transactional' ? `${siteUrl}/api/email/unsubscribe?e=${encodeURIComponent(job.to)}&t=${unsubscribeToken(job.to, secret)}` : '';
      const msg = renderEmail(job.template, job.data, { siteUrl, unsubscribeUrl });
      const r = await mailer.send({ to: job.to, subject: msg.subject, html: msg.html, text: msg.text, tags: [{ name: 'template', value: job.template }],
        ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}) });
      if (!r.ok) throw Object.assign(new Error('provider rejected'), { code: `HTTP_${r.status || 'ERR'}` });
      await db.collection('email_queue').updateOne({ _id: job._id }, { $set: { status: 'sent', sentAt: now, providerId: r.id || null } });
      out.sent++;
    } catch (err) {
      const dead = job.attempts >= MAX_ATTEMPTS;
      await db.collection('email_queue').updateOne({ _id: job._id }, { $set: { status: dead ? 'failed' : 'pending', nextAttemptAt: new Date(now.getTime() + 2 ** job.attempts * 60_000), lastError: String(err?.code || 'SEND_FAILED') } });
      dead ? out.failed++ : out.retried++;
    }
  }
  return out;
};

export const retryFailed = async ({ db, now = new Date() }) => {
  const failed = await db.collection('email_queue').find({ status: 'failed' }).toArray();
  for (const j of failed) await db.collection('email_queue').updateOne({ _id: j._id }, { $set: { status: 'pending', attempts: 0, nextAttemptAt: now } });
  return failed.length;
};

export const queueStats = async ({ db }) => {
  const stats = {};
  for (const s of ['pending', 'sending', 'sent', 'failed', 'suppressed', 'bounced', 'complained']) stats[s] = await db.collection('email_queue').countDocuments({ status: s });
  const recent = await db.collection('email_queue').find({ status: 'failed' }).sort({ createdAt: -1 }).limit(10).toArray();
  return { ...stats, recentFailures: recent.map((j) => ({ template: j.template, attempts: j.attempts, error: j.lastError || '', at: j.createdAt })) };
};

// Resend delivery/bounce/complaint events. Complaints always suppress the address; bounces only when permanent.
export const handleMailEvent = async ({ db, svixId, event, now = new Date() }) => {
  try { await db.collection('webhook_events').insertOne({ eventId: `mail:${svixId}`, event: event?.type || '', receivedAt: now }); }
  catch (e) { if (e?.code === 11000) return { duplicate: true }; throw e; }
  const type = event?.type; const emailId = event?.data?.email_id;
  const job = emailId ? await db.collection('email_queue').findOne({ providerId: emailId }) : null;
  const addresses = [...new Set([...(Array.isArray(event?.data?.to) ? event.data.to : []), ...(job ? [job.to] : [])].map(lower).filter(Boolean))];
  if (type === 'email.delivered' && job) await db.collection('email_queue').updateOne({ _id: job._id }, { $set: { deliveredAt: now } });
  if (type === 'email.complained' || type === 'email.bounced') {
    const permanent = /perm|hard/i.test(String(event?.data?.bounce?.type || ''));
    if (job) await db.collection('email_queue').updateOne({ _id: job._id }, { $set: { status: type === 'email.complained' ? 'complained' : 'bounced' } });
    if (type === 'email.complained' || permanent) {
      for (const email of addresses) await db.collection('email_suppressions').updateOne({ email }, { $setOnInsert: { email, reason: type, at: now } }, { upsert: true });
      return { suppressed: addresses.length };
    }
  }
  return { handled: true };
};

// Abandoned-checkout reminder: at most 1 per 7 days and 3 in total per address; never after a purchase or opt-out.
export const maybeEnqueueAbandoned = async ({ db, order, now = new Date() }) => {
  const to = lower(order.customerEmail);
  if (!to) return { skipped: 'no_email' };
  if ((await db.collection('email_prefs').findOne({ email: to }))?.optOut) return { skipped: 'opted_out' };
  if (await db.collection('email_suppressions').findOne({ email: to })) return { skipped: 'suppressed' };
  if (await db.collection('orders').countDocuments({ customerEmail: to, paymentStatus: { $in: ['paid', 'advance_paid'] }, createdAt: { $gte: order.createdAt } })) return { skipped: 'purchased' };
  if (await db.collection('email_queue').countDocuments({ to, template: 'abandoned_cart', createdAt: { $gte: new Date(now.getTime() - 7 * 86_400_000) } })) return { skipped: 'recent' };
  if ((await db.collection('email_queue').countDocuments({ to, template: 'abandoned_cart' })) >= 3) return { skipped: 'limit' };
  return enqueueEmail({ db, to, template: 'abandoned_cart', key: `abandoned:${order.id}`, category: 'reminder', now,
    data: { name: order.customer?.name || 'there', itemsSummary: order.items.map((l) => `${l.title} x${l.quantity}`).join(', ').slice(0, 200) } });
};
