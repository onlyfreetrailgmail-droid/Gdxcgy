import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadEnv, validateAdminPassword } from '../src/config/env.js';
import { generateOtp, createOtpRecord, checkOtp, OTP_MAX_ATTEMPTS, OTP_TTL_MS } from '../src/utils/otp.js';
import { verifyWebhookSignature, verifyCheckoutSignature } from '../src/utils/signature.js';
import { sniffImageType, validateImageUpload, MAX_UPLOAD_BYTES } from '../src/utils/fileType.js';
import { parseCookies } from '../src/utils/cookies.js';
import { errorHandler, AppError } from '../src/middleware/errors.js';

const prodEnv = () => ({
  NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@c.mongodb.net/x',
  JWT_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLIENT_URL: 'https://www.printxyz.in', PUBLIC_SITE_URL: 'https://www.printxyz.in',
  RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 'k'.repeat(24), RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24),
  CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: '1', CLOUDINARY_API_SECRET: 's'.repeat(20),
  GOOGLE_CLIENT_ID: 'g.apps.googleusercontent.com', RESEND_API_KEY: 're_x', RESEND_FROM_EMAIL: 'hello@printxyz.in'
});

test('env: valid production config loads, no localhost origins', () => {
  const c = loadEnv(prodEnv());
  assert.equal(c.isProduction, true);
  assert.deepEqual(c.corsOrigins, ['https://www.printxyz.in']);
  assert.equal(c.exposeDevOtp, false);
});
test('env: production fails fast when a secret is missing', () => {
  const e = prodEnv(); delete e.RAZORPAY_WEBHOOK_SECRET;
  assert.throws(() => loadEnv(e), /RAZORPAY_WEBHOOK_SECRET is required/);
});
test('env: production rejects short, placeholder and reused JWT secrets', () => {
  assert.throws(() => loadEnv({ ...prodEnv(), JWT_SECRET: 'short' }), /at least 32/);
  assert.throws(() => loadEnv({ ...prodEnv(), JWT_SECRET: 'replace-with-strong-random-secret-xxxxxxxx' }), /placeholder/);
  assert.throws(() => loadEnv({ ...prodEnv(), JWT_REFRESH_SECRET: 'a'.repeat(40) }), /must be different/);
});
test('env: production requires https URLs; dev OTP never exposed in production', () => {
  assert.throws(() => loadEnv({ ...prodEnv(), CLIENT_URL: 'http://printxyz.in' }), /https/);
  assert.equal(loadEnv({ ...prodEnv(), EXPOSE_DEV_OTP: 'true' }).exposeDevOtp, false);
  assert.equal(loadEnv({ NODE_ENV: 'development', EXPOSE_DEV_OTP: 'true' }).exposeDevOtp, true);
});
test('env: admin password strength', () => {
  assert.ok(validateAdminPassword('admin123').length > 0);
  assert.deepEqual(validateAdminPassword('Xk9#mPq2$vLw'), []);
});

test('otp: 6 digits, stored hashed, correct code accepted once', () => {
  const otp = generateOtp(); assert.match(otp, /^\d{6}$/);
  const rec = createOtpRecord({ otp, email: 'A@x.com', secret: 's' });
  assert.ok(!JSON.stringify(rec).includes(otp));
  const r1 = checkOtp({ record: rec, input: otp, email: 'a@x.com', secret: 's' });
  assert.equal(r1.ok, true);
  assert.equal(checkOtp({ record: r1.next, input: otp, email: 'a@x.com', secret: 's' }).ok, false);
});
test('otp: expires after 10 minutes', () => {
  const now = Date.now(); const rec = createOtpRecord({ otp: '123456', email: 'a@x.com', secret: 's', now });
  assert.equal(checkOtp({ record: rec, input: '123456', email: 'a@x.com', secret: 's', now: now + OTP_TTL_MS + 1 }).reason, 'EXPIRED');
});
test('otp: locks after 5 wrong attempts, even if the right code follows', () => {
  let rec = createOtpRecord({ otp: '123456', email: 'a@x.com', secret: 's' });
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    const r = checkOtp({ record: rec, input: '000000', email: 'a@x.com', secret: 's' }); assert.equal(r.ok, false); rec = r.next;
  }
  const late = checkOtp({ record: rec, input: '123456', email: 'a@x.com', secret: 's' });
  assert.equal(late.ok, false); assert.equal(late.reason, 'LOCKED');
});

test('razorpay: webhook signature over raw body; forged/missing/tampered rejected', () => {
  const secret = 'whsec'; const body = Buffer.from('{"event":"payment.captured"}');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: sig, secret }), true);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: 'deadbeef', secret }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: '', secret }), false);
  assert.equal(verifyWebhookSignature({ rawBody: Buffer.from('{"event":"payment.captured "}'), signature: sig, secret }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: sig, secret: '' }), false);
  assert.equal(verifyWebhookSignature({ rawBody: { event: 'x' }, signature: sig, secret }), false);
});
test('razorpay: checkout signature', () => {
  const secret = 'ks'; const sig = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
  assert.equal(verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig, secret }), true);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: sig, secret }), false);
});

test('uploads: real type sniffed from bytes, not the name or header', () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
  assert.equal(sniffImageType(jpg).mime, 'image/jpeg');
  assert.equal(sniffImageType(png).mime, 'image/png');
  assert.equal(sniffImageType(webp).mime, 'image/webp');
  assert.equal(validateImageUpload(Buffer.from('<?php echo 1; ?> not an image at all')).code, 'UNSUPPORTED_TYPE');
  assert.equal(validateImageUpload(Buffer.concat([jpg, Buffer.alloc(MAX_UPLOAD_BYTES)])).code, 'FILE_TOO_LARGE');
  assert.equal(validateImageUpload(Buffer.alloc(0)).code, 'EMPTY_FILE');
});

test('cookies: parsed; malformed encoding does not throw', () => {
  assert.deepEqual(parseCookies('a=1; b=hello%20world'), { a: '1', b: 'hello world' });
  assert.doesNotThrow(() => parseCookies('x=%E0%A4%A'));
});

test('errors: consistent shape, no internals leaked on 500', () => {
  const out = {}; const res = { status(s) { out.s = s; return this; }, json(b) { out.b = b; } };
  const origErr = console.error; console.error = () => {};
  errorHandler(new Error('mongo password is hunter2'), { id: 'req1' }, res, () => {});
  console.error = origErr;
  assert.equal(out.s, 500); assert.equal(out.b.error.code, 'INTERNAL_ERROR');
  assert.ok(!out.b.error.message.includes('hunter2')); assert.equal(out.b.error.requestId, 'req1');
  errorHandler(new AppError(429, 'RATE_LIMITED', 'slow down'), { id: 'r2' }, res, () => {});
  assert.equal(out.s, 429); assert.equal(out.b.error.code, 'RATE_LIMITED');
});
