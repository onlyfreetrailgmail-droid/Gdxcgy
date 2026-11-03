import { escapeHtml } from '../../services/mailer.js';

// Operational alerts. Every alert is stored (visible in Admin > Alerts) and, outside the cooldown window, pushed to
// ALERT_EMAIL and/or ALERT_WEBHOOK_URL (Slack/Discord/Teams-compatible). Alerts are sent directly, not through the
// customer email queue, so a stuck queue or a database outage cannot hide them. Nothing here may ever throw.
const COOLDOWN_MS = 60 * 60_000;

const notify = async ({ config, mailer, fetchImpl, alert }) => {
  const tasks = [];
  const text = `[Printxyz ${alert.severity}] ${alert.title}\n${alert.message}`;
  if (config.alerts?.email && mailer?.configured) {
    tasks.push(mailer.send({ to: config.alerts.email, subject: `[Printxyz alert] ${alert.title}`,
      html: `<h3>${escapeHtml(alert.title)}</h3><p>${escapeHtml(alert.message)}</p><p style="color:#64748B">Key: ${escapeHtml(alert.key)} • Severity: ${escapeHtml(alert.severity)}</p>`, text, tags: [{ name: 'template', value: 'ops_alert' }] }));
  }
  if (config.alerts?.webhookUrl && fetchImpl) {
    tasks.push(fetchImpl(config.alerts.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(8000) }));
  }
  const results = await Promise.allSettled(tasks);
  return results.some((r) => r.status === 'fulfilled');
};

export const raiseAlert = async ({ db, config, mailer, fetchImpl = globalThis.fetch, key, title, message = '', severity = 'warning', cooldownMs = COOLDOWN_MS, now = new Date() }) => {
  try {
    const col = db.collection('alerts');
    const existing = await col.findOne({ key });
    const quiet = existing && existing.status === 'open' && existing.lastNotifiedAt && now - new Date(existing.lastNotifiedAt) < cooldownMs;
    if (existing) {
      await col.updateOne({ key }, { $set: { title, message: String(message).slice(0, 600), severity, lastSeenAt: now, status: 'open' }, $inc: { count: 1 } });
    } else {
      await col.insertOne({ key, title, message: String(message).slice(0, 600), severity, status: 'open', count: 1, firstSeenAt: now, lastSeenAt: now, lastNotifiedAt: null });
    }
    if (quiet) return { raised: true, notified: false };
    const sent = await notify({ config, mailer, fetchImpl, alert: { key, title, message, severity } });
    if (sent) await col.updateOne({ key }, { $set: { lastNotifiedAt: now } });
    return { raised: true, notified: sent };
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'alert failed', code: e?.code, detail: String(e?.message || '').slice(0, 120) }));
    return { raised: false, notified: false };
  }
};

export const resolveAlert = async ({ db, key, now = new Date() }) => {
  try { await db.collection('alerts').updateOne({ key, status: 'open' }, { $set: { status: 'resolved', resolvedAt: now } }); } catch { /* ignore */ }
};

export const listAlerts = async ({ db, status }) =>
  (await db.collection('alerts').find(status ? { status } : {}).sort({ lastSeenAt: -1 }).limit(100).toArray())
    .map((a) => ({ key: a.key, title: a.title, message: a.message, severity: a.severity, status: a.status, count: a.count, firstSeenAt: a.firstSeenAt, lastSeenAt: a.lastSeenAt }));

export const acknowledgeAlert = async ({ db, key, actor, now = new Date() }) => {
  const r = await db.collection('alerts').updateOne({ key, status: 'open' }, { $set: { status: 'resolved', resolvedAt: now, resolvedBy: actor?.email || '' } });
  return { resolved: Boolean(r.modifiedCount) };
};

// Called from the payment code paths.
export const recordPaymentFailure = async ({ db, orderId, code = '', description = '', now = new Date() }) => {
  try { await db.collection('payment_failures').insertOne({ orderId, code: String(code).slice(0, 80), description: String(description).slice(0, 200), at: now }); } catch { /* never affects payments */ }
};

const THRESHOLDS = { paymentFailures: { count: 3, windowMs: 30 * 60_000 }, serverErrors: { count: 10, windowMs: 5 * 60_000 }, emailFailed: 5, refundStuckMs: 3 * 24 * 3600_000 };

// Runs every few minutes. Each check raises a keyed alert (deduplicated by cooldown) or resolves it when healthy.
export const runHealthChecks = async ({ db, config, mailer, pingDb, fetchImpl = globalThis.fetch, now = new Date() }) => {
  const ctx = { db, config, mailer, fetchImpl, now };
  const found = [];
  const check = async (key, bad, title, message, severity = 'warning') => {
    if (bad) { found.push(key); await raiseAlert({ ...ctx, key, title, message, severity }); } else await resolveAlert({ db, key, now });
  };
  try {
    let dbOk = true; try { await pingDb(); } catch { dbOk = false; }
    if (!dbOk) { await raiseAlert({ ...ctx, key: 'db_down', title: 'Database is unreachable', message: 'The API cannot reach MongoDB. Orders and payments will fail until it is back.', severity: 'critical' }); return { found: ['db_down'] }; }
    await resolveAlert({ db, key: 'db_down', now });

    const failures = await db.collection('payment_failures').countDocuments({ at: { $gte: new Date(now - THRESHOLDS.paymentFailures.windowMs) } });
    await check('payment_failures', failures >= THRESHOLDS.paymentFailures.count, 'Payment failures are spiking', `${failures} payments failed in the last 30 minutes. Check Razorpay status and keys.`, 'critical');

    const flagged = await db.collection('orders').find({ paymentFlag: { $in: ['amount_mismatch', 'second_payment_needs_refund'] } }).limit(20).toArray();
    await check('payment_flagged', flagged.length > 0, 'Orders need payment review', `${flagged.length} order(s) have a payment flag: ${flagged.map((o) => `${o.id} (${o.paymentFlag})`).slice(0, 5).join(', ')}.`, 'critical');

    const errors = await db.collection('server_errors').countDocuments({ at: { $gte: new Date(now - THRESHOLDS.serverErrors.windowMs) } });
    await check('server_errors', errors >= THRESHOLDS.serverErrors.count, 'Server errors are spiking', `${errors} server errors in the last 5 minutes.`, 'critical');

    const failedMail = await db.collection('email_queue').countDocuments({ status: 'failed' });
    await check('email_failed', failedMail >= THRESHOLDS.emailFailed, 'Emails are failing to send', `${failedMail} emails permanently failed. Check Resend (key, domain) in Admin > Settings, then retry.`);

    const stuck = await db.collection('refunds').countDocuments({ status: { $in: ['processing', 'requested'] }, createdAt: { $lte: new Date(now - THRESHOLDS.refundStuckMs) } });
    const failedRefunds = await db.collection('orders').countDocuments({ refundPending: true });
    await check('refunds_stuck', stuck + failedRefunds > 0, 'Refunds need attention', `${stuck} refund(s) have been processing for 3+ days and ${failedRefunds} cancelled order(s) still need a refund.`);

    const badHook = await db.collection('alerts').findOne({ key: 'webhook_bad_signature', status: 'open' });
    if (badHook) found.push('webhook_bad_signature');
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'health checks failed', detail: String(e?.message || '').slice(0, 120) }));
  }
  return { found };
};

// Dead-man's switch: an external service (Healthchecks.io, BetterStack, UptimeRobot heartbeat) alerts you if these pings stop.
export const sendHeartbeat = async ({ config, pingDb, fetchImpl = globalThis.fetch }) => {
  if (!config.alerts?.heartbeatUrl) return { sent: false };
  try { await pingDb(); } catch { return { sent: false, reason: 'db_down' }; }
  try { await fetchImpl(config.alerts.heartbeatUrl, { method: 'GET', signal: AbortSignal.timeout(8000) }); return { sent: true }; } catch { return { sent: false, reason: 'unreachable' }; }
};
