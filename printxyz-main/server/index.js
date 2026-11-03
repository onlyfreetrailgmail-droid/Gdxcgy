import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { loadEnv, productionWarnings } from './src/config/env.js';
import { setErrorReporter } from './src/middleware/errors.js';
import { connectDb, pingDb, closeDb } from './src/db/connect.js';
import { ensureIndexes } from './src/db/indexes.js';
import { createApp } from './src/app.js';
import { createAuthService } from './src/modules/auth/authService.js';
import { createTokens } from './src/services/tokens.js';
import { createMailer } from './src/services/mailer.js';
import { createRazorpay } from './src/services/razorpay.js';
import { createCloudinary } from './src/services/cloudinary.js';
import { createGoogleVerifier } from './src/services/google.js';
import { createShiprocket } from './src/modules/shipping/providers/shiprocket.js';
import { createDelhivery } from './src/modules/shipping/providers/delhivery.js';
import { purgeExpiredPhotos } from './src/modules/orders/retention.js';
import { purgeUnusedReviewUploads } from './src/modules/reviews/reviewService.js';
import { sendHeartbeat } from './src/modules/alerts/alerts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });
dotenv.config();

let config;
try {
  config = loadEnv();                       // fails fast in production if anything required is missing or weak
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// Optional error monitoring. Personal data (cookies, bodies, headers) is stripped before anything leaves the server.
if (config.sentryDsn) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn: config.sentryDsn, environment: config.nodeEnv, sendDefaultPii: false, tracesSampleRate: 0,
      beforeSend: (event) => { if (event.request) { delete event.request.cookies; delete event.request.data; delete event.request.headers; delete event.request.query_string; } return event; } });
    setErrorReporter((err, req) => Sentry.captureException(err, { tags: { requestId: req?.id } }));
  } catch { console.error('SENTRY_DSN is set but @sentry/node could not be loaded; continuing without it.'); }
}

for (const w of productionWarnings(config)) console.warn(JSON.stringify({ level: 'warn', msg: w }));
const db = await connectDb(config.mongo);
await ensureIndexes(db);

const hasher = { hash: (p) => bcrypt.hash(p, 12), compare: (p, h) => bcrypt.compare(p, h) };
const auth = createAuthService({
  db, config, tokens: createTokens(config), mailer: createMailer(config),
  hasher,
  googleVerifier: config.google.clientId ? createGoogleVerifier(config) : null,
  dummyHash: bcrypt.hashSync('timing-equaliser', 12)
});

const cloudinary = createCloudinary(config);
const app = createApp({
  config, db, auth, tokens: createTokens(config), mailer: createMailer(config), razorpay: createRazorpay(config),
  cloudinary, hasher,
  providers: { shiprocket: createShiprocket(config.shipping.shiprocket), delhivery: createDelhivery(config.shipping.delhivery) }, clientDist: path.resolve(here, '../client/dist'), pingDb
});

// Release stock and coupons held by unpaid orders.
const sweeper = setInterval(() => app.locals.expireStaleOrders().catch((e) => console.error('expire sweep failed', e.message)), 5 * 60_000);
sweeper.unref();
// Durable email queue: bounded retries with backoff; a provider outage never affects checkout.
const mailWorker = setInterval(() => app.locals.processEmails().catch((e) => console.error('email queue failed', e.message)), 15_000);
mailWorker.unref();
// Customer photos are deleted after the retention period (90 days after a finished order).
const photoJob = setInterval(() => cloudinary.configured && purgeExpiredPhotos({ db, cloudinary }).catch((e) => console.error('photo purge failed', e.message)), 24 * 60 * 60_000);
photoJob.unref();

// Review photos that were uploaded but never submitted are removed after a week.
const reviewPhotoJob = setInterval(() => cloudinary.configured && purgeUnusedReviewUploads({ db, cloudinary }).catch((e) => console.error('review photo purge failed', e.message)), 24 * 60 * 60_000);
reviewPhotoJob.unref();
// Balance reminders for part-paid orders (max 3, one every 3 days).
const balanceJob = setInterval(() => app.locals.balanceReminders().catch((e) => console.error('balance reminders failed', e.message)), 60 * 60_000);
balanceJob.unref();
// Alerts: payment failures, webhook problems, email backlog, stuck refunds, database down. Plus an external heartbeat (dead-man's switch).
const healthJob = setInterval(() => app.locals.runHealthChecks().catch((e) => console.error('health checks failed', e.message)), 5 * 60_000);
healthJob.unref();
const heartbeatJob = setInterval(() => sendHeartbeat({ config, pingDb }).catch(() => {}), 5 * 60_000);
heartbeatJob.unref();
sendHeartbeat({ config, pingDb }).catch(() => {});

const server = app.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ level: 'info', msg: 'server started', port: config.port, env: config.nodeEnv })));
const shutdown = () => { clearInterval(sweeper); clearInterval(mailWorker); clearInterval(healthJob); clearInterval(heartbeatJob); clearInterval(balanceJob); server.close(async () => { await closeDb(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
