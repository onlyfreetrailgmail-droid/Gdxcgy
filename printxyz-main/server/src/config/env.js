// Central, validated configuration. In production, startup fails if a required
// variable is missing, still a placeholder, or too weak. No secret has a default.

const PLACEHOLDER = /(replace-with|changeme|change-me|your[-_ ]?secret|example|password123|admin123)/i;

const REQUIRED_IN_PRODUCTION = [
  'MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_URL', 'PUBLIC_SITE_URL',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'GOOGLE_CLIENT_ID', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'
];
const SECRETS_MIN_32 = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

export const validateAdminPassword = (value) => {
  const pw = String(value || '');
  const problems = [];
  if (pw.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) problems.push('a digit');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol');
  if (PLACEHOLDER.test(pw)) problems.push('not a placeholder or common password');
  return problems;
};

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const str = (env, key, fallback = '') => String(env[key] ?? fallback).trim();

// Not fatal, but a live store should set these. Printed at startup.
export const productionWarnings = (config) => {
  if (!config.isProduction) return [];
  const w = [];
  if (!config.support.email) w.push('SUPPORT_EMAIL is not set: contact pages and alert emails have no recipient.');
  if (!config.support.phone) w.push('SUPPORT_PHONE is not set.');
  if (!config.alerts.email && !config.alerts.webhookUrl) w.push('No ALERT_EMAIL / ALERT_WEBHOOK_URL: payment and uptime alerts are only stored in the admin panel.');
  if (!config.meta.pixelId) w.push('META_PIXEL_ID is not set: Meta Pixel is disabled.');
  if (config.meta.pixelId && !config.meta.accessToken) w.push('META_ACCESS_TOKEN is not set: server-side Conversions API events are disabled.');
  if (config.meta.testEventCode) w.push('META_TEST_EVENT_CODE is still set: clear it before launch.');
  if (!config.shipping.shiprocket.email && !config.shipping.delhivery.token) w.push('No courier configured (Shiprocket/Delhivery): shipments must be handled manually.');
  return w;
};

export const loadEnv = (env = process.env) => {
  const nodeEnv = str(env, 'NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const errors = [];

  if (isProduction) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!str(env, key)) errors.push(`${key} is required in production`);
    }
    for (const key of SECRETS_MIN_32) {
      const v = str(env, key);
      if (v && v.length < 32) errors.push(`${key} must be at least 32 characters`);
    }
    for (const key of REQUIRED_IN_PRODUCTION) {
      const v = str(env, key);
      if (v && PLACEHOLDER.test(v)) errors.push(`${key} still looks like a placeholder`);
    }
    if (str(env, 'JWT_SECRET') && str(env, 'JWT_SECRET') === str(env, 'JWT_REFRESH_SECRET')) {
      errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
    }
    if (!list(env.CORS_ORIGINS).length && !str(env, 'CLIENT_URL')) {
      errors.push('CORS_ORIGINS or CLIENT_URL is required in production');
    }
    for (const key of ['ALERT_WEBHOOK_URL', 'UPTIME_HEARTBEAT_URL']) if (str(env, key) && !/^https:\/\//.test(str(env, key))) errors.push(`${key} must be an https URL`);
    for (const key of ['CLIENT_URL', 'PUBLIC_SITE_URL']) {
      const v = str(env, key);
      if (v && !/^https:\/\//.test(v)) errors.push(`${key} must be an https URL in production`);
    }
  }

  const port = Number(env.PORT || 4001);
  if (!Number.isInteger(port) || port <= 0) errors.push('PORT must be a positive integer');

  if (errors.length) {
    const error = new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
    error.code = 'INVALID_ENV';
    error.details = errors;
    throw error;
  }

  const clientUrl = str(env, 'CLIENT_URL') || str(env, 'FRONTEND_URL') || 'http://localhost:5173';
  const devOrigins = isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  return Object.freeze({
    nodeEnv, isProduction, isTest, port,
    clientUrl,
    publicSiteUrl: str(env, 'PUBLIC_SITE_URL') || clientUrl,
    corsOrigins: [...new Set([...list(env.CORS_ORIGINS), clientUrl, ...devOrigins])],
    mongo: { uri: str(env, 'MONGODB_URI'), dbName: str(env, 'MONGODB_DB', 'printxyz') },
    jwt: {
      accessSecret: str(env, 'JWT_SECRET'),
      refreshSecret: str(env, 'JWT_REFRESH_SECRET'),
      accessTtlSeconds: 15 * 60,
      refreshTtlSeconds: 30 * 24 * 60 * 60
    },
    razorpay: {
      keyId: str(env, 'RAZORPAY_KEY_ID'),
      keySecret: str(env, 'RAZORPAY_KEY_SECRET'),
      webhookSecret: str(env, 'RAZORPAY_WEBHOOK_SECRET')
    },
    cloudinary: {
      cloudName: str(env, 'CLOUDINARY_CLOUD_NAME'),
      apiKey: str(env, 'CLOUDINARY_API_KEY'),
      apiSecret: str(env, 'CLOUDINARY_API_SECRET')
    },
    google: { clientId: str(env, 'GOOGLE_CLIENT_ID') },
    // Meta Pixel id is public (it ships to browsers); the access token stays on the server.
    ga: { measurementId: str(env, 'GA_MEASUREMENT_ID') },
    sentryDsn: str(env, 'SENTRY_DSN'),
    meta: { pixelId: str(env, 'META_PIXEL_ID'), accessToken: str(env, 'META_ACCESS_TOKEN'), testEventCode: str(env, 'META_TEST_EVENT_CODE') },
    // Only the production deployment may be indexed. Set ALLOW_INDEXING=false to block even production (e.g. soft launch).
    seo: { allowIndexing: isProduction && str(env, 'ALLOW_INDEXING') !== 'false' },
    support: { email: str(env, 'SUPPORT_EMAIL'), phone: str(env, 'SUPPORT_PHONE') },
    resend: { apiKey: str(env, 'RESEND_API_KEY'), from: str(env, 'RESEND_FROM_EMAIL'), webhookSecret: str(env, 'RESEND_WEBHOOK_SECRET') },
    // Couriers are optional: a provider with missing credentials is simply disabled.
    shipping: {
      pickupPincode: str(env, 'PICKUP_PINCODE'),
      parcel: { weightKg: Number(env.SHIPPING_DEFAULT_WEIGHT_KG || 0.5), lengthCm: Number(env.SHIPPING_DEFAULT_LENGTH_CM || 15), breadthCm: Number(env.SHIPPING_DEFAULT_BREADTH_CM || 15), heightCm: Number(env.SHIPPING_DEFAULT_HEIGHT_CM || 10) },
      shiprocket: { email: str(env, 'SHIPROCKET_EMAIL'), password: str(env, 'SHIPROCKET_PASSWORD'), pickupLocation: str(env, 'SHIPROCKET_PICKUP_LOCATION'), webhookToken: str(env, 'SHIPROCKET_WEBHOOK_TOKEN') },
      delhivery: { token: str(env, 'DELHIVERY_TOKEN'), mode: str(env, 'DELHIVERY_MODE', 'staging') === 'production' ? 'production' : 'staging', pickupLocation: str(env, 'DELHIVERY_PICKUP_LOCATION'), webhookSecret: str(env, 'DELHIVERY_WEBHOOK_SECRET') }
    },
    pricing: {
      freeShippingThresholdPaise: Math.round(Number(env.FREE_SHIPPING_THRESHOLD_RUPEES || 1499) * 100),
      shippingFeePaise: Math.round(Number(env.SHIPPING_FEE_RUPEES || 0) * 100)
    },
    // Advance payments for custom and bulk orders (ADVANCE_PERCENT=0 switches the feature off).
    orders: {
      advancePercent: Math.min(Math.max(Math.round(Number(env.ADVANCE_PERCENT ?? 50)) || 0, 0), 90),
      advanceMinTotalPaise: Math.round(Number(env.ADVANCE_MIN_TOTAL_RUPEES || 2000) * 100),
      bulkMinQuantity: Math.max(Math.round(Number(env.BULK_MIN_QUANTITY || 10)), 2),
      returnWindowDays: Math.min(Math.max(Math.round(Number(env.RETURN_WINDOW_DAYS ?? 7)) || 0, 0), 60)
    },
    // Proxies in front of the API: 1 = Render only; 2 = Vercel rewrites -> Render. Wrong value makes all visitors share one IP.
    http: { trustProxyHops: Math.min(Math.max(Math.round(Number(env.TRUST_PROXY_HOPS ?? 1)) || 1, 1), 3), globalRatePerMin: Math.max(Math.round(Number(env.RATE_LIMIT_PER_MIN || 300)) || 300, 30) },
    // Operational alerts (payment failures, webhook problems, email backlog, database down).
    alerts: { email: str(env, 'ALERT_EMAIL') || str(env, 'SUPPORT_EMAIL'), webhookUrl: str(env, 'ALERT_WEBHOOK_URL'), heartbeatUrl: str(env, 'UPTIME_HEARTBEAT_URL') },
    // Local-only convenience; never true in production.
    exposeDevOtp: !isProduction && str(env, 'EXPOSE_DEV_OTP') === 'true'
  });
};
