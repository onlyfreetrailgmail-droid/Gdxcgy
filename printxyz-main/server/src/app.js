import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { AppError, requestId, errorHandler } from './middleware/errors.js';
import { originGuard, noSqlGuard, attachUser, requireAuth, requireRole, STAFF_ROLES, CATALOG_ROLES, ACCESS_COOKIE, REFRESH_COOKIE } from './middleware/security.js';
import { mongoRateLimit } from './middleware/rateLimit.js';
import { authCookieOptions } from './utils/cookies.js';
import { verifyWebhookSignature } from './utils/signature.js';
import { validateImageUpload, MAX_UPLOAD_BYTES } from './utils/fileType.js';
import { categories, publicSettings, policyPages } from './content.js';
import { priceCart, evaluateCoupon, cleanOptions, DEFAULT_SETTINGS } from './modules/pricing/pricing.js';
import { createOrder, toClientOrder, toTrackingView, canAccessOrder, expireStaleOrders } from './modules/orders/orderService.js';
import { applyStatusUpdate } from './modules/orders/orderStatus.js';
import { requestCancellation, approveCancellation, declineCancellation } from './modules/orders/cancellation.js';
import { quoteShipping } from './modules/shipping/rates.js';
import { createRazorpayOrder, createBalanceOrder, verifyCheckout, handleWebhookEvent } from './modules/payments/paymentService.js';
import { validateProduct } from './modules/products/productSchema.js';
import { escapeHtml } from './services/mailer.js';
import { getBusinessSettings, issueInvoice, issueReceipt, renderDocumentHtml } from './modules/billing/billing.js';
import { createRefund } from './modules/refunds/refundService.js';
import { respondToPreview } from './modules/orders/customApproval.js';
import { checkServiceability, createShipment, refreshShipment, handleShiprocketWebhook, handleDelhiveryWebhook } from './modules/shipping/shippingService.js';
import { timingSafeEqualStr } from './modules/orders/orderService.js';
import { enqueueEmail, processQueue, retryFailed, queueStats, handleMailEvent, maybeEnqueueAbandoned, verifyUnsubscribeToken } from './modules/notifications/queue.js';
import { verifySvix } from './utils/svix.js';
import { getPricingSettings, updateShippingSettings, getBusinessAdmin, updateBusiness } from './modules/settings/settings.js';
import { listCoupons, createCoupon, updateCoupon } from './modules/coupons/couponService.js';
import { salesReport, ordersCsv, customersReport, lowStock } from './modules/reports/reports.js';
import { submitReview, moderateReview, listApproved, listPending, listRecent, recordReviewUpload, MAX_REVIEW_PHOTOS } from './modules/reviews/reviewService.js';
import { planAdvance, DEFAULT_ADVANCE } from './modules/orders/advance.js';
import { requestBalance, sendBalanceReminders } from './modules/orders/balance.js';
import { requestReturn, returnsForOrder, listReturns, decideReturn } from './modules/returns/returnService.js';
import { listStaff, createStaff, changeRole, resetStaffPassword, ROLE_INFO } from './modules/staff/staffService.js';
import { activeBanners, listBanners, createBanner, updateBanner, deleteBanner, getHomeSections, setHomeSections, SECTION_CHOICES, getMaterials, setMaterials } from './modules/content/contentService.js';
import { createLink, listLinks, setLinkActive, resolveLink, PLACEMENTS } from './modules/links/linkService.js';
import { raiseAlert, listAlerts, acknowledgeAlert, runHealthChecks } from './modules/alerts/alerts.js';
import { createEnquiry, listEnquiries, setEnquiryStatus } from './modules/enquiries/enquiryService.js';
import * as account from './modules/account/accountService.js';
import { sendMetaPurchase, trackingHealth } from './modules/tracking/meta.js';
import { buildRobots, buildSitemap, productJsonLd, breadcrumbJsonLd, organizationJsonLd, renderSharePage } from './modules/seo/seo.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const createApp = ({ config, db, auth, tokens, mailer, razorpay, cloudinary, hasher = null, providers = {}, clientDist, pingDb = async () => true }) => {
  const app = express();
  const col = (n) => db.collection(n);
  const ipKey = (req) => req.ip || 'unknown';
  const limit = (name, windowMs, max, key = ipKey) => mongoRateLimit({ getDb: () => db, name, windowMs, max, key });

  app.set('trust proxy', config.http?.trustProxyHops ?? 1);   // TRUST_PROXY_HOPS: 1 behind Render only, 2 behind Vercel rewrites + Render
  app.disable('x-powered-by');
  app.use(requestId);
  // Staging and any non-production deployment stays out of search indexes; API JSON is never indexable either.
  const seoPublic = /^\/api\/(robots\.txt|sitemap\.xml|seo\/)/;
  app.use((req, res, next) => {
    if (!config.seo?.allowIndexing || (req.path.startsWith('/api/') && !seoPublic.test(req.path))) res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      // Tracking hosts are allowed only when that tracker is actually configured.
      scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://accounts.google.com', ...(config.meta?.pixelId ? ['https://connect.facebook.net'] : []), ...(config.ga?.measurementId ? ['https://www.googletagmanager.com'] : [])],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://accounts.google.com'],
      connectSrc: ["'self'", 'https://lumberjack.razorpay.com', 'https://accounts.google.com', ...(config.meta?.pixelId ? ['https://www.facebook.com', 'https://connect.facebook.net'] : []), ...(config.ga?.measurementId ? ['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'] : [])],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'", 'https://api.razorpay.com'], frameAncestors: ["'none'"]
    } }
  }));
  app.use(cors({
    origin: (origin, cb) => (!origin || config.corsOrigins.includes(origin) ? cb(null, true) : cb(new AppError(403, 'CORS', 'Not allowed by CORS'))),
    credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type']
  }));
  // Webhook needs the exact bytes Razorpay signed, so it gets a raw body parser before JSON.
  app.use(['/api/payments/webhook', '/api/hooks/mail'], express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit({ windowMs: 60_000, max: config.http?.globalRatePerMin ?? 300, standardHeaders: true, legacyHeaders: false }));
  app.use(attachUser(tokens));
  app.use(originGuard(config));
  app.use('/api', (req, res, next) => (['/payments/webhook', '/hooks/mail'].includes(req.path) ? next() : noSqlGuard(req, res, next)));

  // Counts server errors so a sudden spike raises an alert (see modules/alerts).
  app.locals.onServerError = (err, req) => { db.collection('server_errors').insertOne({ at: new Date(), code: String(err?.code || 'INTERNAL').slice(0, 40), path: String(req?.path || '').slice(0, 80) }).catch(() => {}); };

  // ---- health ----
  app.get('/api/health', (_req, res) => res.json({ ok: true, status: 'healthy' }));
  app.get('/api/ready', wrap(async (_req, res) => { await pingDb(); res.json({ ok: true, status: 'ready' }); }));

  // ---- auth ----
  const setSession = (res, s) => {
    res.cookie(ACCESS_COOKIE, s.accessToken, authCookieOptions(config, config.jwt.accessTtlSeconds));
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...authCookieOptions(config, config.jwt.refreshTtlSeconds), path: '/api/auth' });
    return { user: s.user };
  };
  const clearSession = (res) => { res.clearCookie(ACCESS_COOKIE, { path: '/' }); res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' }); };
  const loginLimit = limit('login', 15 * 60_000, 10, (req) => `${ipKey(req)}:${String(req.body?.email || '').toLowerCase()}`);
  app.post('/api/auth/login', loginLimit, wrap(async (req, res) => res.json(setSession(res, await auth.login({ ...req.body, role: 'admin' })))));
  app.post('/api/auth/user/login', loginLimit, wrap(async (req, res) => res.json(setSession(res, await auth.login({ ...req.body, role: 'user' })))));
  app.post('/api/auth/user/register', limit('register', 60 * 60_000, 10), wrap(async (req, res) => res.status(201).json(setSession(res, await auth.register(req.body || {})))));
  app.post('/api/auth/otp/request', limit('otp-ip', 60 * 60_000, 10), limit('otp-email', 60 * 60_000, 5, (req) => String(req.body?.email || '').toLowerCase()),
    wrap(async (req, res) => res.json({ ok: true, ...(await auth.requestOtp(req.body || {})), message: 'If the email is valid, a code has been sent.' })));
  app.post('/api/auth/otp/verify', limit('otp-verify', 15 * 60_000, 20), wrap(async (req, res) => res.json(setSession(res, await auth.verifyOtp(req.body || {})))));
  app.post('/api/auth/google', limit('google', 15 * 60_000, 30), wrap(async (req, res) => res.json(setSession(res, await auth.googleLogin(req.body || {})))));
  app.post('/api/auth/refresh', limit('refresh', 15 * 60_000, 60), wrap(async (req, res) => {
    try { res.json(setSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE]))); } catch (e) { clearSession(res); throw e; }
  }));
  app.post('/api/auth/logout', wrap(async (req, res) => { await auth.logout(req.cookies?.[REFRESH_COOKIE]); clearSession(res); res.json({ ok: true }); }));
  app.post('/api/auth/change-password', requireAuth, limit('chpw', 15 * 60_000, 10, (req) => req.user.sub), wrap(async (req, res) => res.json(setSession(res, await auth.changePassword(req.user.sub, req.body?.current, req.body?.next)))));
  app.post('/api/auth/2fa/setup', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json(await auth.beginTotp(req.user.sub))));
  app.post('/api/auth/2fa/enable', requireRole(...STAFF_ROLES), limit('2fa', 15 * 60_000, 10, (req) => req.user.sub), wrap(async (req, res) => res.json(await auth.enableTotp(req.user.sub, req.body?.code))));
  app.post('/api/auth/2fa/disable', requireRole(...STAFF_ROLES), limit('2fa', 15 * 60_000, 10, (req) => req.user.sub), wrap(async (req, res) => res.json(await auth.disableTotp(req.user.sub, req.body?.password, req.body?.code))));
  app.get('/api/auth/me', requireAuth, wrap(async (req, res) => res.json({ user: await auth.me(req.user.sub) })));

  // ---- catalogue ----
  app.get('/api/categories', (_req, res) => res.json({ items: categories }));
  app.get('/api/products', wrap(async (req, res) => {
    const { q, category, ids } = req.query;
    let list = await col('products').find({ published: { $ne: false } }).sort({ createdAt: -1 }).toArray();
    if (q) { const t = String(q).toLowerCase(); list = list.filter((p) => `${p.title} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(t)); }
    if (category) list = list.filter((p) => p.categorySlug === String(category));
    if (ids) { const s = String(ids).split(','); list = list.filter((p) => s.includes(p.id)); }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: list.map(({ _id, ...p }) => p), total: list.length, page: 1, limit: list.length });
  }));
  app.get('/api/products/suggest', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = q ? (await col('products').find({ published: { $ne: false } }).toArray()).filter((p) => `${p.title} ${p.category}`.toLowerCase().includes(q)).slice(0, 6) : [];
    res.json({ items: list.map((p) => ({ title: p.title, slug: p.slug })) });
  }));
  app.get('/api/products/:slug', wrap(async (req, res) => {
    const p = await col('products').findOne({ slug: req.params.slug });
    if (!p || (p.published === false && !STAFF_ROLES.includes(req.user?.role))) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    const { _id, ...rest } = p; res.json(rest);
  }));
  app.post('/api/products', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const doc = validateProduct(req.body);
    try { await col('products').insertOne({ ...doc }); } catch (e) { if (e?.code === 11000) throw new AppError(409, 'SLUG_EXISTS', 'A product with this name already exists.'); throw e; }
    await col('audit_logs').insertOne({ at: new Date(), actorId: req.user.sub, actorEmail: req.user.email, action: 'create_product', targetType: 'product', targetId: doc.id });
    res.status(201).json({ item: doc, message: 'Product added successfully.' });
  }));
  app.put('/api/products/:id', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const existing = await col('products').findOne({ id: req.params.id });
    if (!existing) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    const doc = validateProduct(req.body, { existing });
    await col('products').updateOne({ id: existing.id }, { $set: doc });
    await col('audit_logs').insertOne({ at: new Date(), actorId: req.user.sub, actorEmail: req.user.email, action: 'update_product', targetType: 'product', targetId: doc.id });
    res.json({ item: doc });
  }));
  app.delete('/api/products/:id', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const r = await col('products').deleteOne({ id: req.params.id });
    if (!r.deletedCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    await col('audit_logs').insertOne({ at: new Date(), actorId: req.user.sub, actorEmail: req.user.email, action: 'delete_product', targetType: 'product', targetId: req.params.id });
    res.json({ ok: true, message: 'Product deleted successfully.' });
  }));

  // ---- storefront content ----
  const support = { email: config.support.email, phone: config.support.phone };
  app.get('/api/settings/public', wrap(async (_req, res) => {
    const pricing = await getPricingSettings(db, config.pricing || DEFAULT_SETTINGS);
    const threshold = `₹${(pricing.freeShippingThresholdPaise / 100).toLocaleString('en-IN')}`;
    res.json({ ...publicSettings, announcement: publicSettings.announcement.replace('₹1,499', threshold), business: { name: 'Printxyz', ...support }, tracking: { metaPixelId: config.meta?.pixelId || '', gaMeasurementId: config.ga?.measurementId || '' },
      gst: await (async () => { const g = (await getBusinessSettings(db, config)).gst; return g.enabled ? { enabled: true, ratePercent: g.ratePercent } : { enabled: false }; })(),
      features: { advancePercent: config.orders?.advancePercent || 0, returnWindowDays: config.orders?.returnWindowDays || 0, materialGuide: ((await getMaterials({ db })).items || []).length > 0 } });
  }));
  app.get('/api/banners/active', wrap(async (_req, res) => { res.set('Cache-Control', 'no-cache'); res.json({ items: await activeBanners({ db }) }); }));
  app.get('/api/sections/home', wrap(async (_req, res) => res.json({ items: await getHomeSections({ db }) })));
  app.get('/api/materials', wrap(async (_req, res) => { res.set('Cache-Control', 'no-cache'); res.json(await getMaterials({ db })); }));
  app.get('/api/pages/:slug', (req, res) => {
    const page = policyPages[req.params.slug];
    if (!page) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
    const contact = [support.email && `Email: ${support.email}`, support.phone && `Phone: ${support.phone}`].filter(Boolean).join(' • ');
    res.json(req.params.slug === 'contact' ? { ...page, body: contact || 'Contact details are coming soon.' } : page);
  });

  // ---- pricing (server is the only source of money) ----
  const loadForPricing = async (items) => {
    const ids = [...new Set((Array.isArray(items) ? items : []).map((i) => String(i?.productId ?? i?.id ?? '')))];
    return col('products').find({ id: { $in: ids } }).toArray();
  };
  const loadCoupon = async (code) => (code ? col('coupons').findOne({ code: String(code).trim().toUpperCase() }) : null);
  const shippingFor = async (pincode) => {
    if (!/^[1-9]\d{5}$/.test(String(pincode || ''))) return null;
    try { return await quoteShipping({ providers, config, pincode: String(pincode) }); } catch { return null; }   // never block checkout on a courier outage
  };
  const quote = async (items, couponCode, pincode) => {
    const coupon = await loadCoupon(couponCode);
    if (couponCode && !coupon) throw new AppError(400, 'INVALID_COUPON', 'Coupon code not valid.');
    const sq = await shippingFor(pincode);
    const p = priceCart({ products: await loadForPricing(items), items, coupon, settings: await getPricingSettings(db, config.pricing || DEFAULT_SETTINGS), shippingQuotePaise: sq?.ratePaise ?? null });
    return { subtotal: p.subtotalPaise / 100, discount: p.discountPaise / 100, shipping: p.shippingPaise / 100, total: p.totalPaise / 100, couponCode: p.couponCode,
      advance: (() => { const a = planAdvance({ lines: p.lines, totalPaise: p.totalPaise, cfg: config.orders || DEFAULT_ADVANCE }); return { eligible: a.eligible, percent: a.percent, advance: a.advancePaise / 100, balance: a.balancePaise / 100 }; })(),
      pincode: /^[1-9]\d{5}$/.test(String(pincode || '')) ? String(pincode) : '', deliveryAvailable: sq ? sq.serviceable !== false : true, shippingCourier: sq?.courier || '', shippingEstimate: sq?.etd || '' };
  };
  app.post('/api/cart/quote', wrap(async (req, res) => res.json({ ok: true, ...(await quote(req.body?.items, req.body?.couponCode, req.body?.pincode)) })));
  app.post('/api/cart/coupon', wrap(async (req, res) => {
    const q = await quote(req.body?.items, req.body?.code, req.body?.pincode);
    res.json({ ok: true, discount: q.discount, message: 'Coupon applied successfully.', ...q });
  }));

  // ---- orders ----
  app.post('/api/orders', limit('order-create', 60 * 60_000, 30), wrap(async (req, res) => {
    const order = await createOrder({ db, input: req.body || {}, user: req.user, settings: await getPricingSettings(db, config.pricing || DEFAULT_SETTINGS), shippingQuote: await shippingFor(req.body?.customer?.pincode), advanceConfig: config.orders || DEFAULT_ADVANCE, client: { ip: req.ip, userAgent: req.get('user-agent') } });
    res.status(201).json({ item: toClientOrder(order, { includeToken: true }), message: 'Order created. Complete payment to confirm it.' });
  }));
  app.get('/api/customer/orders', requireAuth, wrap(async (req, res) => {
    // Only the signed-in customer's own orders. Never matched by email, which is not verified at registration.
    const rows = await col('orders').find({ userId: req.user.sub }).sort({ createdAt: -1 }).toArray();
    res.json({ items: rows.map((o) => toClientOrder(o, { includeToken: true })) });
  }));
  app.get('/api/customer/orders/:id', requireAuth, wrap(async (req, res) => {
    const o = await col('orders').findOne({ id: req.params.id });
    if (!canAccessOrder(o, { user: req.user })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found for this account.');
    res.json({ item: toClientOrder(o, { includeToken: true }) });
  }));
  app.get('/api/orders/track/:token', limit('track', 15 * 60_000, 60), wrap(async (req, res) => {
    const token = String(req.params.token || '');
    const o = token.length >= 32 ? await col('orders').findOne({ guestToken: token }) : null;
    if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found for this tracking link.');
    res.json({ item: toTrackingView(o) });
  }));
  app.get('/api/orders', requireRole(...STAFF_ROLES), wrap(async (_req, res) => {
    const rows = await col('orders').find({}).sort({ createdAt: -1 }).limit(500).toArray();
    res.json({ items: rows.map((o) => toClientOrder(o)) });
  }));
  app.get('/api/orders/:id', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const o = await col('orders').findOne({ id: req.params.id });
    if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    res.json({ item: toClientOrder(o) });
  }));

  // ---- payments ----
  app.post('/api/payments/create-order', limit('pay-create', 10 * 60_000, 20), wrap(async (req, res) => {
    const r = await createRazorpayOrder({ db, razorpay, orderId: req.body?.orderId, guestToken: req.body?.guestToken, user: req.user });
    res.json({ ok: true, keyId: config.razorpay.keyId, order: { id: r.razorpayOrderId }, amount: r.amountPaise, currency: r.currency, orderId: r.orderId });
  }));
  app.post('/api/payments/create-balance-order', limit('pay-balance', 10 * 60_000, 20), wrap(async (req, res) => {
    const r = await createBalanceOrder({ db, razorpay, orderId: req.body?.orderId, guestToken: req.body?.guestToken, user: req.user });
    res.json({ ok: true, keyId: config.razorpay.keyId, order: { id: r.razorpayOrderId }, amount: r.amountPaise, currency: r.currency, orderId: r.orderId });
  }));
  app.post('/api/payments/verify', limit('pay-verify', 10 * 60_000, 30), wrap(async (req, res) => {
    let r;
    try { r = await verifyCheckout({ db, keySecret: config.razorpay.keySecret, body: req.body }); }
    catch (e) {
      if (e?.code === 'INVALID_SIGNATURE') raiseAlert({ db, config, mailer, key: 'verify_bad_signature', severity: 'critical', title: 'Checkout signature check failed', message: 'A payment confirmation failed signature verification. If this repeats, RAZORPAY_KEY_SECRET may be wrong or someone is tampering with checkout.', cooldownMs: 6 * 3600_000 }).catch(() => {});
      throw e;
    }
    if (r.justPaid) notifyPaid(r.order, { balance: Boolean(r.balancePaid) }).catch(() => {});
    res.json({ ok: true, orderId: r.order.id, message: 'Payment verified successfully.' });
  }));
  app.post('/api/payments/webhook', wrap(async (req, res) => {
    if (!config.razorpay.webhookSecret) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Webhook verification is not configured.');
    const sig = req.get('X-Razorpay-Signature') || '';
    if (!verifyWebhookSignature({ rawBody: req.body, signature: sig, secret: config.razorpay.webhookSecret })) {
      raiseAlert({ db, config, mailer, key: 'webhook_bad_signature', severity: 'critical', title: 'Razorpay webhook signature rejected', message: 'A payment webhook failed signature verification. If this keeps happening, RAZORPAY_WEBHOOK_SECRET does not match the secret in the Razorpay dashboard and paid orders may not be confirmed.', cooldownMs: 6 * 3600_000 }).catch(() => {});
      throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
    }
    let payload; try { payload = JSON.parse(req.body.toString('utf8')); } catch { throw new AppError(400, 'INVALID_WEBHOOK', 'Webhook body is not valid JSON.'); }
    const eventId = req.get('X-Razorpay-Event-Id') || crypto.createHash('sha256').update(req.body).digest('hex');
    const r = await handleWebhookEvent({ db, payload, eventId });
    if (r.justPaid) {
      const pid = String(payload?.payload?.payment?.entity?.id || '');
      const o = r.balancePaid ? await col('orders').findOne({ balancePaymentId: pid }) : await col('orders').findOne({ paymentReference: pid });
      if (o) notifyPaid(o, { balance: Boolean(r.balancePaid) }).catch(() => {});
    }
    if (r.flagged) raiseAlert({ db, config, mailer, key: `payflag:${r.flagged}`, severity: 'critical', title: 'A payment needs review', message: `A payment was flagged (${r.flagged}). Open Admin > Orders and check the flagged order before shipping.`, cooldownMs: 3600_000 }).catch(() => {});
    res.json({ ok: true });
  }));

  // Runs only from a real pending->paid transition (justPaid): invoice, receipt, then the email. Never for pending/failed payments.
  const notifyPaid = async (order, { balance = false } = {}) => {
    const settings = await getBusinessSettings(db, config);
    const fresh = await col('orders').findOne({ _id: order._id });
    // Verified payment only (this function runs on a real payment transition). Fire and forget: tracking can never block the order.
    if (!balance) sendMetaPurchase({ db, order: fresh, config }).catch(() => {});
    const payId = balance ? fresh.balancePaymentId : fresh.paymentReference;
    const amountPaise = balance ? fresh.balancePaise : (fresh.paymentPlan === 'advance' ? fresh.advancePaise : fresh.paidAmountPaise);
    await issueReceipt({ db, order: fresh, paymentId: payId, amountPaise, settings });
    // The invoice covers the full order, so it is issued once everything is paid.
    const invoice = fresh.paymentStatus === 'paid' ? await issueInvoice({ db, order: fresh, settings }) : null;
    if (!fresh.customerEmail) return;
    const base = { name: fresh.customer.name, orderId: fresh.id, trackToken: fresh.guestToken };
    const invoiceUrl = invoice ? `${config.publicSiteUrl}/api/orders/${encodeURIComponent(fresh.id)}/invoice?token=${fresh.guestToken}` : '';
    if (fresh.paymentPlan === 'advance' && !balance) {
      await enqueueEmail({ db, to: fresh.customerEmail, template: 'advance_paid', key: `advance_paid:${fresh.id}`, data: { ...base, amount: fresh.advancePaise / 100, balance: fresh.balancePaise / 100 } });
    } else {
      await enqueueEmail({ db, to: fresh.customerEmail, template: 'order_paid', key: `order_paid:${fresh.id}`, data: { ...base, amount: balance ? fresh.balancePaise / 100 : fresh.totalPaise / 100, invoiceUrl } });
    }
  };

  app.get('/api/orders/:id/invoice', wrap(async (req, res) => {
    const order = await col('orders').findOne({ id: req.params.id });
    if (!canAccessOrder(order, { user: req.user, guestToken: String(req.query.token || '') })) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const doc = await col('invoices').findOne({ orderId: order.id, type: 'invoice' });
    if (!doc) throw new AppError(404, 'INVOICE_NOT_FOUND', 'The invoice is not ready yet.');
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).type('html').send(renderDocumentHtml(doc));
  }));

  app.post('/api/orders/:id/approval', limit('approval', 15 * 60_000, 30), wrap(async (req, res) => {
    const r = await respondToPreview({ db, orderId: req.params.id, user: req.user, guestToken: req.body?.guestToken, action: req.body?.action, note: req.body?.note });
    res.json({ ok: true, ...r });
  }));

  app.post('/api/orders/:id/cancel', limit('cancel', 15 * 60_000, 10), wrap(async (req, res) => {
    const r = await requestCancellation({ db, razorpay, orderId: req.params.id, user: req.user, guestToken: req.body?.guestToken, reason: req.body?.reason });
    if (r.outcome === 'cancelled' && r.order?.customerEmail) await enqueueEmail({ db, to: r.order.customerEmail, template: 'order_cancelled', key: `cancel:${r.order.id}`,
      data: { name: r.order.customer?.name || 'there', orderId: r.order.id, refundStarted: r.refundStarted, trackToken: r.order.guestToken } });
    res.json({ ok: true, outcome: r.outcome, message: r.message });
  }));

  // ---- returns ----
  const returnWindow = () => config.orders?.returnWindowDays || 0;
  app.get('/api/orders/:id/returns', limit('returns-read', 15 * 60_000, 60), wrap(async (req, res) => {
    res.json(await returnsForOrder({ db, orderId: req.params.id, user: req.user, guestToken: String(req.query.token || ''), windowDays: returnWindow() }));
  }));
  app.post('/api/orders/:id/returns', limit('returns', 60 * 60_000, 10), wrap(async (req, res) => {
    const r = await requestReturn({ db, orderId: req.params.id, user: req.user, guestToken: req.body?.guestToken, reason: req.body?.reason, details: req.body?.details, photos: req.body?.photos, items: req.body?.items, windowDays: returnWindow(), supportEmail: config.support.email });
    res.status(201).json({ ok: true, request: r, message: 'Return request received. We will email you once it is reviewed.' });
  }));

  // ---- saved carts (one per signed-in customer) ----
  const cleanCart = (items) => {
    if (!Array.isArray(items) || items.length > 50) throw new AppError(400, 'INVALID_CART', 'Cart is invalid.');
    const str = (v, n) => String(v ?? '').slice(0, n);
    return items.map((i) => {
      const quantity = Number(i?.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !i?.productId) throw new AppError(400, 'INVALID_CART', 'Cart is invalid.');
      return { id: str(i.id, 120), productId: str(i.productId, 80), slug: str(i.slug, 120), title: str(i.title, 200), image: str(i.image, 500),
        price: Number.isFinite(Number(i.price)) ? Number(i.price) : 0, quantity, variant: str(i.variant || 'Standard', 60), size: i.size ? str(i.size, 60) : null, options: cleanOptions(i.options) };
    });
  };
  app.get('/api/cart', requireAuth, wrap(async (req, res) => {
    const c = await col('user_carts').findOne({ userId: req.user.sub });
    res.json({ items: c?.items || [] });
  }));
  app.put('/api/cart', requireAuth, limit('cart-save', 60_000, 60, (req) => req.user?.sub || ipKey(req)), wrap(async (req, res) => {
    const items = cleanCart(req.body?.items);
    await col('user_carts').updateOne({ userId: req.user.sub }, { $set: { userId: req.user.sub, items, updatedAt: new Date() } }, { upsert: true });
    res.json({ ok: true });
  }));

  // ---- cancellation requests (staff) ----
  app.get('/api/admin/cancellations', requireRole(...STAFF_ROLES), wrap(async (_req, res) => {
    const open = await col('cancellation_requests').find({ status: 'open' }).sort({ createdAt: 1 }).toArray();
    const refundPending = await col('orders').find({ refundPending: true }).toArray();
    res.json({ requests: open.map((r) => ({ orderId: r.orderId, reason: r.reason, createdAt: r.createdAt })), refundPending: refundPending.map((o) => ({ orderId: o.id, total: o.totalPaise / 100 })) });
  }));
  app.post('/api/admin/cancellations/:orderId/approve', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const r = await approveCancellation({ db, razorpay, orderId: req.params.orderId, actor: req.user });
    if (r.order.customerEmail) await enqueueEmail({ db, to: r.order.customerEmail, template: 'order_cancelled', key: `cancel:${r.order.id}`,
      data: { name: r.order.customer?.name || 'there', orderId: r.order.id, refundStarted: r.refundStarted, trackToken: r.order.guestToken } });
    res.json({ ok: true, refundStarted: r.refundStarted });
  }));
  app.post('/api/admin/cancellations/:orderId/decline', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    await declineCancellation({ db, orderId: req.params.orderId, actor: req.user, note: req.body?.note });
    res.json({ ok: true });
  }));
  app.post('/api/admin/cancellations/:orderId/retry-refund', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    await createRefund({ db, razorpay, orderId: req.params.orderId, reason: 'Retry of refund after cancellation', actor: req.user });
    await col('orders').updateOne({ id: req.params.orderId }, { $unset: { refundPending: '' } });
    res.json({ ok: true });
  }));

  // ---- uploads (private, Cloudinary) ----
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 } });
  app.post('/api/uploads/order-images', limit('upload', 60 * 60_000, 20), upload.array('files', 5), wrap(async (req, res) => {
    if (!cloudinary?.configured) throw new AppError(503, 'UPLOADS_UNAVAILABLE', 'Photo uploads are not available right now.');
    if (!req.files?.length) throw new AppError(400, 'NO_FILES', 'No images were uploaded.');
    const out = [];
    for (const f of req.files) {
      const v = validateImageUpload(f.buffer);   // real type from bytes, never the client's MIME header
      if (!v.ok) throw new AppError(400, v.code, v.code === 'FILE_TOO_LARGE' ? 'Each photo must be 8 MB or smaller.' : 'Upload JPG, PNG or WebP photos only.');
      const r = await cloudinary.uploadPrivate(f.buffer, { ext: v.ext });
      out.push({ publicId: r.publicId, format: r.format, previewUrl: cloudinary.signedUrl(r.publicId, r.format, 900) });
    }
    res.json({ ok: true, files: out, message: 'Photos uploaded securely.' });
  }));

  app.post('/api/uploads/review-photos', requireAuth, limit('review-upload', 60 * 60_000, 15, (req) => req.user?.sub || ipKey(req)), upload.array('files', MAX_REVIEW_PHOTOS), wrap(async (req, res) => {
    if (!cloudinary?.configured) throw new AppError(503, 'UPLOADS_UNAVAILABLE', 'Photo uploads are not available right now.');
    if (!req.files?.length) throw new AppError(400, 'NO_FILES', 'No images were uploaded.');
    const out = [];
    for (const f of req.files) {
      const v = validateImageUpload(f.buffer);
      if (!v.ok) throw new AppError(400, v.code, v.code === 'FILE_TOO_LARGE' ? 'Each photo must be 8 MB or smaller.' : 'Upload JPG, PNG or WebP photos only.');
      const r = await cloudinary.uploadPublic(f.buffer, { folder: 'printxyz/review-photos', ext: v.ext });
      await recordReviewUpload({ db, userId: req.user.sub, publicId: r.publicId });
      out.push({ publicId: r.publicId, url: cloudinary.publicUrl(r.publicId, { width: 300 }) });
    }
    res.json({ ok: true, files: out });
  }));
  app.post('/api/admin/uploads/banner-image', requireRole(...CATALOG_ROLES), limit('banner-upload', 60 * 60_000, 30, (req) => req.user?.sub || ipKey(req)), upload.single('file'), wrap(async (req, res) => {
    if (!cloudinary?.configured) throw new AppError(503, 'UPLOADS_UNAVAILABLE', 'Image uploads are not available right now.');
    if (!req.file) throw new AppError(400, 'NO_FILES', 'No image was uploaded.');
    const v = validateImageUpload(req.file.buffer);
    if (!v.ok) throw new AppError(400, v.code, 'Upload a JPG, PNG or WebP image (8 MB or smaller).');
    const r = await cloudinary.uploadPublic(req.file.buffer, { folder: 'printxyz/banners', ext: v.ext });
    res.json({ ok: true, url: cloudinary.publicUrl(r.publicId, { width: 1600 }) });
  }));

  // ---- email: unsubscribe, provider events, admin health ----
  app.get('/api/email/unsubscribe', limit('unsub', 15 * 60_000, 30), wrap(async (req, res) => {
    const email = String(req.query.e || '').toLowerCase();
    if (!verifyUnsubscribeToken(email, req.query.t, config.jwt.accessSecret || 'dev')) throw new AppError(400, 'INVALID_LINK', 'This unsubscribe link is not valid.');
    await col('email_prefs').updateOne({ email }, { $set: { email, optOut: true } }, { upsert: true });
    res.set('Cache-Control', 'no-store').type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;padding:24px"><h2>You are unsubscribed</h2><p>You will no longer get reminder emails from Printxyz. Order updates about purchases you make will still reach you.</p></body>');
  }));
  app.post('/api/hooks/mail', wrap(async (req, res) => {
    if (!config.resend.webhookSecret) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Mail webhook is not configured.');
    if (!verifySvix({ rawBody: req.body, headers: req.headers, secret: config.resend.webhookSecret })) throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
    let event; try { event = JSON.parse(req.body.toString('utf8')); } catch { throw new AppError(400, 'INVALID_WEBHOOK', 'Invalid body.'); }
    await handleMailEvent({ db, svixId: req.get('svix-id'), event });
    res.json({ ok: true });
  }));
  app.get('/api/admin/email/health', requireRole('owner', 'admin'), wrap(async (_req, res) => res.json({ ok: true, configured: Boolean(mailer?.configured), ...(await queueStats({ db })) })));
  app.post('/api/admin/email/retry', requireRole('owner', 'admin'), wrap(async (_req, res) => res.json({ ok: true, requeued: await retryFailed({ db }) })));

  // ---- customer account ----
  const mine = [requireAuth];
  app.get('/api/account/profile', ...mine, wrap(async (req, res) => res.json({ profile: await account.getProfile({ db, userId: req.user.sub }) })));
  app.patch('/api/account/profile', ...mine, wrap(async (req, res) => res.json({ profile: await account.updateProfile({ db, userId: req.user.sub, body: req.body }) })));
  app.get('/api/account/addresses', ...mine, wrap(async (req, res) => res.json({ items: await account.listAddresses({ db, userId: req.user.sub }) })));
  app.post('/api/account/addresses', ...mine, wrap(async (req, res) => res.status(201).json({ item: await account.addAddress({ db, userId: req.user.sub, body: req.body }) })));
  app.put('/api/account/addresses/:id', ...mine, wrap(async (req, res) => res.json({ item: await account.updateAddress({ db, userId: req.user.sub, id: req.params.id, body: req.body }) })));
  app.post('/api/account/addresses/:id/default', ...mine, wrap(async (req, res) => { await account.setDefaultAddress({ db, userId: req.user.sub, id: req.params.id }); res.json({ ok: true }); }));
  app.delete('/api/account/addresses/:id', ...mine, wrap(async (req, res) => { await account.deleteAddress({ db, userId: req.user.sub, id: req.params.id }); res.json({ ok: true }); }));
  app.get('/api/account/wishlist', ...mine, wrap(async (req, res) => res.json({ productIds: await account.getWishlist({ db, userId: req.user.sub }) })));
  app.put('/api/account/wishlist/:productId', ...mine, wrap(async (req, res) => res.json({ productIds: await account.addToWishlist({ db, userId: req.user.sub, productId: req.params.productId }) })));
  app.delete('/api/account/wishlist/:productId', ...mine, wrap(async (req, res) => res.json({ productIds: await account.removeFromWishlist({ db, userId: req.user.sub, productId: req.params.productId }) })));
  app.get('/api/account/preferences', ...mine, wrap(async (req, res) => res.json({ preferences: await account.getPreferences({ db, userId: req.user.sub }) })));
  app.patch('/api/account/preferences', ...mine, wrap(async (req, res) => res.json({ preferences: await account.updatePreferences({ db, userId: req.user.sub, body: req.body }) })));
  app.get('/api/account/export', ...mine, limit('export', 60 * 60_000, 5, (req) => req.user?.sub || ipKey(req)), wrap(async (req, res) => res.set('Content-Disposition', 'attachment; filename="printxyz-my-data.json"').json(await account.exportData({ db, userId: req.user.sub }))));
  app.post('/api/account/delete', ...mine, limit('delete-acct', 60 * 60_000, 5, (req) => req.user?.sub || ipKey(req)), wrap(async (req, res) => {
    await account.deleteAccount({ db, userId: req.user.sub, confirm: req.body?.confirm });
    await auth.logout(req.cookies?.[REFRESH_COOKIE]); clearSession(res);
    res.json({ ok: true, message: 'Your account and personal data were deleted.' });
  }));

  // ---- shipping ----
  app.get('/api/shipping/serviceability', limit('serviceability', 10 * 60_000, 60), wrap(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, ...(await checkServiceability({ providers, config, pincode: req.query.pincode })) });
  }));
  app.post('/api/admin/orders/:id/shipment', requireRole(...CATALOG_ROLES, 'production'), wrap(async (req, res) => {
    const s = await createShipment({ db, providers, orderId: req.params.id, providerName: String(req.body?.provider || ''), parcel: req.body?.parcel, defaults: config.shipping.parcel, actor: req.user });
    res.status(201).json({ ok: true, shipment: { provider: s.provider, awb: s.awb, courier: s.courier, labelUrl: s.labelUrl, trackingUrl: s.trackingUrl }, message: 'Shipment created.' });
  }));
  app.get('/api/admin/orders/:id/shipment', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const s = await col('shipments').findOne({ orderId: req.params.id });
    if (!s) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'No shipment exists for this order.');
    res.json({ shipment: { provider: s.provider, awb: s.awb, courier: s.courier, labelUrl: s.labelUrl, trackingUrl: s.trackingUrl, lastStatusText: s.lastStatusText } });
  }));
  app.post('/api/admin/orders/:id/shipment/refresh', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const r = await refreshShipment({ db, providers, orderId: req.params.id });
    res.json({ ok: true, courierStatus: r.courierStatus, changed: Boolean(r.changed) });
  }));
  // Courier webhooks. Paths deliberately avoid courier names (Shiprocket rejects callback URLs containing "sr"/"kr"/"shiprocket").
  app.post('/api/hooks/track-a', wrap(async (req, res) => {
    const token = config.shipping.shiprocket.webhookToken;
    if (!token) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook token is not configured.');
    if (!timingSafeEqualStr(token, req.get('x-api-key'))) throw new AppError(401, 'UNAUTHORIZED', 'Invalid webhook token.');
    await handleShiprocketWebhook({ db, body: req.body || {} });
    res.status(200).json({ ok: true });
  }));
  app.post('/api/hooks/track-b/:secret', wrap(async (req, res) => {
    const secret = config.shipping.delhivery.webhookSecret;
    if (!secret) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook secret is not configured.');
    if (!timingSafeEqualStr(secret, req.params.secret)) throw new AppError(401, 'UNAUTHORIZED', 'Invalid webhook secret.');
    try { await handleDelhiveryWebhook({ db, providers, body: req.body || {} }); } catch (e) { console.error(JSON.stringify({ level: 'warn', msg: 'delhivery webhook pull failed', code: e?.code })); }
    res.status(200).json({ ok: true });
  }));

  // ---- admin ----
  app.get('/api/admin/summary', requireRole(...STAFF_ROLES), wrap(async (_req, res) => {
    const paid = await col('orders').find({ paymentStatus: 'paid' }).toArray();
    res.json({ totalRevenue: paid.reduce((s, o) => s + o.totalPaise, 0) / 100, orderCount: await col('orders').countDocuments({}), paidOrders: paid.length });
  }));
  app.patch('/api/admin/orders/:id/status', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const order = await col('orders').findOne({ id: req.params.id });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const r = await applyStatusUpdate({ db, order, body: req.body || {}, actor: req.user });
    // A part-paid order that is packed is ready: ask for the balance automatically (once).
    if (r.changed && req.body?.production_status === 'packed') requestBalance({ db, order: await col('orders').findOne({ _id: order._id }) }).catch(() => {});
    res.json({ ok: true, changed: r.changed, message: r.changed ? 'Order status updated successfully.' : 'Nothing to change.' });
  }));
  app.post('/api/admin/orders/:id/request-balance', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const order = await col('orders').findOne({ id: req.params.id });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const r = await requestBalance({ db, order });
    if (!r.requested && !r.already) throw new AppError(409, 'NO_BALANCE_DUE', 'This order has no balance to collect.');
    res.json({ ok: true, message: r.requested ? 'Balance request emailed to the customer.' : 'The balance was already requested.' });
  }));
  app.post('/api/admin/orders/:id/refund', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const raw = req.body?.amount;
    const amountPaise = raw === undefined || raw === null || raw === '' ? undefined : Math.round(Number(raw) * 100);
    if (amountPaise !== undefined && !Number.isFinite(amountPaise)) throw new AppError(400, 'INVALID_AMOUNT', 'Refund amount must be a number.');
    const refund = await createRefund({ db, razorpay, orderId: req.params.id, amountPaise, reason: req.body?.reason, actor: req.user });
    res.status(201).json({ ok: true, refund: { id: refund.id, status: refund.status, amount: refund.amountPaise / 100 }, message: 'Refund requested. The credit note is issued when the provider confirms it.' });
  }));
  app.get('/api/admin/orders/:id/documents', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const docs = await col('invoices').find({ orderId: req.params.id }).sort({ issuedAt: 1 }).toArray();
    res.json({ items: docs.map((d) => ({ type: d.type, number: d.number, issuedAt: d.issuedAt, amount: d.totalPaise / 100 })) });
  }));
  app.post('/api/admin/orders/:id/preview', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    const order = await col('orders').findOne({ id: req.params.id });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const previewUrl = String(req.body?.previewUrl || '').trim();
    if (previewUrl && !/^https:\/\//.test(previewUrl)) throw new AppError(400, 'INVALID_INPUT', 'Preview URL must start with https://');
    const note = String(req.body?.note || 'Your design preview is ready.').slice(0, 500);
    await applyStatusUpdate({ db, order, body: { custom_preview_status: 'preview-ready' }, actor: req.user });
    await col('orders').updateOne({ _id: order._id }, { $set: { previewUrl, previewNote: note } });
    if (order.customerEmail) await enqueueEmail({ db, to: order.customerEmail, template: 'preview_ready', key: `preview:${order.id}:${(order.revisionCount || 0)}`,
      data: { name: order.customer.name, orderId: order.id, note, previewUrl, trackToken: order.guestToken } });
    res.json({ ok: true, message: 'Preview update sent to the customer.' });
  }));

  // ---- SEO ----
  const siteUrl = config.publicSiteUrl;
  const allowIndexing = Boolean(config.seo?.allowIndexing);
  app.get(['/robots.txt', '/api/robots.txt'], (_req, res) => res.type('text/plain').send(buildRobots({ siteUrl, allowIndexing })));
  app.get(['/sitemap.xml', '/api/sitemap.xml'], wrap(async (_req, res) => {
    const products = await col('products').find({ published: { $ne: false } }).toArray();
    res.set('Cache-Control', 'public, max-age=600').type('application/xml').send(buildSitemap({ siteUrl, products, categories }));
  }));
  // Crawler-facing HTML (the host rewrites bot user agents here; see vercel.json). Same facts the page shows, no invented data.
  const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  app.get('/api/seo/product/:slug', wrap(async (req, res) => {
    const p = await col('products').findOne({ slug: req.params.slug });
    if (!p || p.published === false) {
      return res.status(404).type('html').send(renderSharePage({ siteUrl, path: `/product/${encodeURIComponent(req.params.slug)}`, title: 'Product not found | Printxyz', description: 'This product is no longer available.', noindex: true }));
    }
    const product = { ...p }; delete product._id;
    const trail = [{ name: 'Home', path: '/' }, { name: product.category || 'Shop', path: `/category/${encodeURIComponent(product.categorySlug || '')}` }, { name: product.title, path: `/product/${encodeURIComponent(product.slug)}` }];
    const desc = String(product.description || `${product.title} from Printxyz.`).slice(0, 300);
    res.set('Cache-Control', 'public, max-age=300').type('html').send(renderSharePage({
      siteUrl, path: `/product/${encodeURIComponent(product.slug)}`,
      title: `${product.title} | Printxyz`, description: desc, image: product.image || product.images?.[0],
      jsonLd: [productJsonLd({ product, siteUrl, reviews: product.reviews > 0 && product.rating > 0 ? { count: product.reviews, rating: product.rating } : null }), breadcrumbJsonLd({ siteUrl, trail })],
      heading: product.title, bodyHtml: `<p>${escapeHtml(desc)}</p><p>Price: ${money(product.price)} (INR). ${Number(product.stock) > 0 ? 'In stock.' : 'Currently out of stock.'}</p>`
    }));
  }));
  app.get('/api/seo/category/:slug', wrap(async (req, res) => {
    const c = categories.find((x) => x.slug === req.params.slug);
    if (!c) return res.status(404).type('html').send(renderSharePage({ siteUrl, path: `/category/${encodeURIComponent(req.params.slug)}`, title: 'Category not found | Printxyz', description: 'This category does not exist.', noindex: true }));
    const list = (await col('products').find({ published: { $ne: false }, categorySlug: c.slug }).toArray()).slice(0, 24);
    res.set('Cache-Control', 'public, max-age=300').type('html').send(renderSharePage({
      siteUrl, path: `/category/${encodeURIComponent(c.slug)}`,
      title: `${c.name} | Printxyz`, description: `Browse ${c.name.toLowerCase()} from Printxyz, 3D-printed in India.`, image: list[0]?.image,
      jsonLd: [breadcrumbJsonLd({ siteUrl, trail: [{ name: 'Home', path: '/' }, { name: c.name, path: `/category/${encodeURIComponent(c.slug)}` }] })],
      heading: c.name, bodyHtml: `<ul>${list.map((p) => `<li><a href="${escapeHtml(`${siteUrl}/product/${encodeURIComponent(p.slug)}`)}">${escapeHtml(p.title)}</a> ${money(p.price)}</li>`).join('')}</ul>`
    }));
  }));
  app.get('/api/seo/organization', (_req, res) => res.json(organizationJsonLd({ siteUrl, email: support.email, phone: support.phone })));

  // ---- admin tools: coupons, reports, customers, inventory, reviews, enquiries, settings ----
  const adminOnly = requireRole('owner', 'admin');
  const audited = (req, action, targetId) => col('audit_logs').insertOne({ at: new Date(), actorId: req.user.sub, actorEmail: req.user.email, action, targetType: 'settings', targetId: String(targetId || ''), reason: '', changes: [] });
  app.get('/api/admin/coupons', requireRole(...CATALOG_ROLES), wrap(async (_req, res) => res.json({ items: await listCoupons({ db }) })));
  app.post('/api/admin/coupons', requireRole(...CATALOG_ROLES), wrap(async (req, res) => { const c = await createCoupon({ db, body: req.body }); await audited(req, 'create_coupon', c.code); res.status(201).json({ item: c }); }));
  app.put('/api/admin/coupons/:id', requireRole(...CATALOG_ROLES), wrap(async (req, res) => { const c = await updateCoupon({ db, id: req.params.id, body: req.body }); await audited(req, 'update_coupon', c.code); res.json({ item: c }); }));
  const dateParam = (v, fallback) => { if (!v) return fallback; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', 'Dates must look like 2026-11-01.'); return d; };
  app.get('/api/admin/reports/sales', requireRole(...CATALOG_ROLES), wrap(async (req, res) => {
    const to = dateParam(req.query.to, new Date()); const from = dateParam(req.query.from, new Date(to.getTime() - 30 * 86_400_000));
    if (from > to || to - from > 366 * 86_400_000) throw new AppError(400, 'INVALID_RANGE', 'Choose a range of up to one year.');
    res.json({ from, to, ...(await salesReport({ db, from, to })) });
  }));
  app.get('/api/admin/reports/orders.csv', requireRole(...CATALOG_ROLES), limit('csv', 60 * 60_000, 20, (req) => req.user?.sub || ipKey(req)), wrap(async (req, res) => {
    const csv = await ordersCsv({ db, status: req.query.status ? String(req.query.status) : undefined, from: req.query.from ? dateParam(req.query.from) : undefined, to: req.query.to ? dateParam(req.query.to) : undefined });
    await audited(req, 'export_orders_csv', '');
    res.set({ 'Content-Disposition': 'attachment; filename="printxyz-orders.csv"', 'Cache-Control': 'no-store' }).type('text/csv').send(`\uFEFF${csv}`);
  }));
  app.get('/api/admin/customers', requireRole(...CATALOG_ROLES), wrap(async (_req, res) => res.json({ items: await customersReport({ db }) })));
  app.get('/api/admin/inventory/low-stock', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json({ items: await lowStock({ db, threshold: Math.min(Math.max(parseInt(req.query.threshold, 10) || 5, 0), 1000) }) })));

  app.get('/api/reviews/recent', wrap(async (_req, res) => { res.set('Cache-Control', 'public, max-age=300'); res.json({ items: await listRecent({ db }) }); }));
  app.get('/api/products/:slug/reviews', wrap(async (req, res) => {
    const p = await col('products').findOne({ slug: req.params.slug });
    if (!p || p.published === false) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    res.json({ items: await listApproved({ db, productId: p.id, urlFor: cloudinary?.configured ? (id) => cloudinary.publicUrl(id, { width: 800 }) : null }), rating: p.rating || 0, count: p.reviews || 0 });
  }));
  app.post('/api/products/:slug/reviews', requireAuth, limit('review', 60 * 60_000, 10, (req) => req.user?.sub || ipKey(req)), wrap(async (req, res) => {
    const p = await col('products').findOne({ slug: req.params.slug });
    if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    const r = await submitReview({ db, userId: req.user.sub, productId: p.id, ...req.body });
    res.status(201).json({ ok: true, ...r, message: 'Thanks. Your review will appear after a quick check.' });
  }));
  app.get('/api/admin/reviews', requireRole(...STAFF_ROLES), wrap(async (_req, res) => res.json({ items: await listPending({ db, urlFor: cloudinary?.configured ? (id) => cloudinary.publicUrl(id, { width: 400 }) : null }) })));
  app.post('/api/admin/reviews/:id/:action', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.json({ ok: true, ...(await moderateReview({ db, id: req.params.id, action: req.params.action, actor: req.user, cloudinary })) })));

  app.post('/api/enquiries', limit('enquiry', 60 * 60_000, 10), wrap(async (req, res) => {
    const r = await createEnquiry({ db, input: req.body || {} });
    if (!r.ignored && config.support.email) await enqueueEmail({ db, to: config.support.email, template: 'enquiry_alert', key: `enquiry:${r.id}`, data: { id: r.id, type: r.type, name: String(req.body?.name || '').slice(0, 120), email: String(req.body?.email || '').slice(0, 200), phone: String(req.body?.phone || '').slice(0, 20), message: String(req.body?.message || '').slice(0, 2000) } });
    res.status(201).json({ ok: true, id: r.id, message: 'Thanks. We have received your message and will reply by email.' });
  }));
  app.get('/api/admin/enquiries', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json({ items: await listEnquiries({ db, status: req.query.status ? String(req.query.status) : undefined }) })));
  app.patch('/api/admin/enquiries/:id', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json({ ok: true, ...(await setEnquiryStatus({ db, id: req.params.id, status: req.body?.status })) })));

  app.get('/api/admin/settings', adminOnly, wrap(async (_req, res) => {
    const p = await getPricingSettings(db, config.pricing || DEFAULT_SETTINGS);
    res.json({ shipping: { freeShippingThreshold: p.freeShippingThresholdPaise / 100, shippingFee: p.shippingFeePaise / 100 }, business: await getBusinessAdmin(db) });
  }));
  app.put('/api/admin/settings/shipping', adminOnly, wrap(async (req, res) => {
    const p = await updateShippingSettings({ db, body: req.body, actor: req.user, defaults: config.pricing || DEFAULT_SETTINGS });
    res.json({ shipping: { freeShippingThreshold: p.freeShippingThresholdPaise / 100, shippingFee: p.shippingFeePaise / 100 } });
  }));
  app.put('/api/admin/settings/business', adminOnly, wrap(async (req, res) => res.json({ business: await updateBusiness({ db, body: req.body, actor: req.user }) })));

  // ---- returns (staff) ----
  app.get('/api/admin/returns', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json({ items: await listReturns({ db, status: req.query.status ? String(req.query.status) : undefined, cloudinary }) })));
  app.post('/api/admin/returns/:id/:action', requireRole(...STAFF_ROLES), wrap(async (req, res) => {
    if (req.params.action === 'refund' && !CATALOG_ROLES.includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Only owners, admins and managers can issue refunds.');
    const raw = req.body?.amount;
    const refundAmountPaise = raw === undefined || raw === null || raw === '' ? undefined : Math.round(Number(raw) * 100);
    res.json({ ok: true, ...(await decideReturn({ db, razorpay, id: req.params.id, action: req.params.action, note: req.body?.note, refundAmountPaise, actor: req.user })) });
  }));

  // ---- staff and roles (owner/admin) ----
  app.get('/api/admin/staff', adminOnly, wrap(async (req, res) => res.json({ items: await listStaff({ db }), roles: ROLE_INFO, you: req.user.sub })));
  app.post('/api/admin/staff', adminOnly, limit('staff-create', 60 * 60_000, 20, (req) => req.user.sub), wrap(async (req, res) => {
    if (!hasher) throw new AppError(503, 'UNAVAILABLE', 'Staff creation is not available.');
    res.status(201).json(await createStaff({ db, hasher, actor: req.user, body: req.body }));
  }));
  app.put('/api/admin/staff/:id/role', adminOnly, wrap(async (req, res) => res.json({ ok: true, user: await changeRole({ db, actor: req.user, id: req.params.id, role: req.body?.role }) })));
  app.post('/api/admin/staff/:id/reset-password', adminOnly, limit('staff-reset', 60 * 60_000, 20, (req) => req.user.sub), wrap(async (req, res) => {
    if (!hasher) throw new AppError(503, 'UNAVAILABLE', 'Not available.');
    res.json({ ok: true, ...(await resetStaffPassword({ db, hasher, actor: req.user, id: req.params.id })) });
  }));

  // ---- storefront content: banners, home sections, material guide ----
  app.get('/api/admin/banners', requireRole(...CATALOG_ROLES), wrap(async (_req, res) => res.json({ items: await listBanners({ db }) })));
  app.post('/api/admin/banners', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.status(201).json({ item: await createBanner({ db, body: req.body, actor: req.user }) })));
  app.put('/api/admin/banners/:id', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.json({ item: await updateBanner({ db, id: req.params.id, body: req.body, actor: req.user }) })));
  app.delete('/api/admin/banners/:id', requireRole(...CATALOG_ROLES), wrap(async (req, res) => { await deleteBanner({ db, id: req.params.id, actor: req.user }); res.json({ ok: true }); }));
  app.get('/api/admin/sections', requireRole(...CATALOG_ROLES), wrap(async (_req, res) => res.json({ items: await getHomeSections({ db }), choices: SECTION_CHOICES })));
  app.put('/api/admin/sections', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.json({ items: await setHomeSections({ db, items: req.body?.items, actor: req.user }) })));
  app.put('/api/admin/materials', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.json(await setMaterials({ db, body: req.body, actor: req.user }))));

  // ---- share links for ads (Instagram, YouTube, WhatsApp ...) ----
  app.get('/s/:code', wrap(async (req, res) => {
    const target = await resolveLink({ db, code: req.params.code, query: req.query });
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }).redirect(302, target || '/');
  }));
  app.get('/api/admin/links', requireRole(...CATALOG_ROLES), wrap(async (_req, res) => res.json({ items: await listLinks({ db, siteUrl: config.publicSiteUrl }), placements: PLACEMENTS })));
  app.post('/api/admin/links', requireRole(...CATALOG_ROLES), limit('links', 60 * 60_000, 120, (req) => req.user.sub), wrap(async (req, res) => res.status(201).json({ item: await createLink({ db, siteUrl: config.publicSiteUrl, body: req.body, actor: req.user }) })));
  app.post('/api/admin/links/:code/:state', requireRole(...CATALOG_ROLES), wrap(async (req, res) => { await setLinkActive({ db, code: req.params.code, active: req.params.state === 'enable' }); res.json({ ok: true }); }));

  // ---- alerts ----
  app.get('/api/admin/alerts', requireRole(...STAFF_ROLES), wrap(async (req, res) => res.json({ items: await listAlerts({ db, status: req.query.status ? String(req.query.status) : undefined }), notify: { email: Boolean(config.alerts?.email && mailer?.configured), webhook: Boolean(config.alerts?.webhookUrl), heartbeat: Boolean(config.alerts?.heartbeatUrl) } })));
  app.post('/api/admin/alerts/:key/resolve', requireRole(...CATALOG_ROLES), wrap(async (req, res) => res.json({ ok: true, ...(await acknowledgeAlert({ db, key: req.params.key, actor: req.user })) })));
  app.post('/api/admin/alerts/test', adminOnly, limit('alert-test', 60 * 60_000, 5, (req) => req.user.sub), wrap(async (_req, res) => {
    const r = await raiseAlert({ db, config, mailer, key: `test:${Date.now()}`, severity: 'info', title: 'Test alert from Printxyz', message: 'If you can read this, alert delivery works.', cooldownMs: 0 });
    res.json({ ok: true, ...r });
  }));

  // ---- Meta tracking diagnostics (admin only) ----
  app.get('/api/admin/tracking/health', requireRole('owner', 'admin'), wrap(async (_req, res) => res.json({ ok: true, ...(await trackingHealth({ db, config })) })));

  // ---- frontend ----
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'API route not found.')));
  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  app.use(errorHandler);
  app.locals.expireStaleOrders = () => expireStaleOrders({ db, onExpired: (o) => maybeEnqueueAbandoned({ db, order: o }) });
  app.locals.balanceReminders = () => sendBalanceReminders({ db });
  app.locals.runHealthChecks = () => runHealthChecks({ db, config, mailer, pingDb });
  app.locals.processEmails = () => processQueue({ db, mailer, siteUrl: config.publicSiteUrl, secret: config.jwt.accessSecret || 'dev' });
  return app;
};
