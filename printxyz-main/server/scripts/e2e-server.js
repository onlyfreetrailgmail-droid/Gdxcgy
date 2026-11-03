// Browser-test server. Boots the REAL Express app and serves the REAL built client (client/dist), with an in-memory
// database and fake Razorpay / Cloudinary so tests are fast, offline and deterministic. Never used in production.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/modules/auth/authService.js';
import { createTokens } from '../src/services/tokens.js';
import { createFakeDb } from '../tests/helpers/fakeDb.js';
import { createOrder } from '../src/modules/orders/orderService.js';

if (process.env.NODE_ENV === 'production') { console.error('e2e-server must not run in production'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4010);
export const E2E = { keySecret: 'e2e_secret', ownerEmail: 'owner@printxyz.test', ownerPassword: 'Owner#Pass12345' };

const config = loadEnv({ NODE_ENV: 'development', PORT: String(PORT), CLIENT_URL: `http://127.0.0.1:${PORT}`, PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
  JWT_SECRET: 'e'.repeat(48), JWT_REFRESH_SECRET: 'f'.repeat(48), RAZORPAY_KEY_ID: 'rzp_test_e2e', RAZORPAY_KEY_SECRET: E2E.keySecret, RAZORPAY_WEBHOOK_SECRET: 'whsec_e2e',
  META_PIXEL_ID: '123456789012345', SUPPORT_EMAIL: 'support@printxyz.test', ADVANCE_PERCENT: '50', ADVANCE_MIN_TOTAL_RUPEES: '2000', RETURN_WINDOW_DAYS: '7', RATE_LIMIT_PER_MIN: '100000' });

const db = createFakeDb({ unique: { users: ['email'], payments: ['paymentId'], webhook_events: ['eventId'], coupons: ['code'], alerts: ['key'], email_queue: ['key'], invoices: ['number'], review_uploads: ['publicId'] } });
const hasher = { hash: async (p) => `h:${p}`, compare: async (p, h) => h === `h:${p}` };
const tokens = createTokens(config);
const auth = createAuthService({ db, config, tokens, mailer: { configured: false }, hasher, googleVerifier: null, dummyHash: 'h:x' });

const product = (o) => ({ mrp: o.price, rating: 0, reviews: 0, tags: [], published: true, stock: 50, images: [o.image], description: `${o.title} description`, ...o });
const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
for (const p of [
  product({ id: 'p1', slug: 'ganesha-lamp', title: 'Ganesha 3D Lamp', category: 'Devotional', categorySlug: 'devotional', price: 1799, image: IMG, section: 'trending' }),
  product({ id: 'p2', slug: 'name-plate', title: 'Desk Name Plate', category: 'Decor', categorySlug: 'decor', price: 499, image: IMG, section: 'most-loved' }),
  product({ id: 'p3', slug: 'photo-lithophane', title: 'Photo Lithophane Lamp', category: 'Custom Statues', categorySlug: 'custom-statues', tags: ['custom', 'lithophane'], price: 2499, image: IMG, section: 'trending' })
]) await db.collection('products').insertOne(p);
const owner = { _id: 'u-owner', id: 'u-owner', name: 'Owner', email: E2E.ownerEmail, role: 'owner', passwordHash: await hasher.hash(E2E.ownerPassword), mustChangePassword: false, createdAt: new Date() };
await db.collection('users').insertOne(owner);

// A delivered order the returns test can use (token printed via /__e2e/delivered).
const customer = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', street: '12 MG Road', city: 'Patna', state: 'Bihar', pincode: '800001' };
const makeDelivered = async () => {
  const o = await createOrder({ db, input: { customer, items: [{ productId: 'p2', quantity: 1 }] } });
  await db.collection('orders').updateOne({ id: o.id }, { $set: { paymentStatus: 'paid', status: 'completed', shippingStatus: 'delivered', paymentReference: `pay_${o.id}`, paidAmountPaise: o.totalPaise, paidAt: new Date(), deliveredAt: new Date().toISOString() } });
  return o;
};

let n = 0;
const razorpay = { orders: { create: async ({ amount }) => ({ id: `order_e2e_${++n}`, amount }) }, payments: { refund: async () => ({ id: `rfnd_e2e_${++n}` }) } };
const cloudinary = {
  configured: true,
  uploadPrivate: async () => ({ publicId: `printxyz/customer-photos/e2e${++n}`, format: 'jpg', bytes: 10 }),
  signedUrl: () => IMG,
  uploadPublic: async () => ({ publicId: `printxyz/review-photos/e2e${++n}`, format: 'jpg', bytes: 10, url: IMG }),
  publicUrl: () => IMG, destroy: async () => {}, destroyPublic: async () => {}
};

const app = createApp({ config, db, auth, tokens, mailer: { configured: false }, razorpay, cloudinary, hasher, providers: {}, clientDist: path.resolve(here, '../../client/dist'), pingDb: async () => true });
// Test-only helpers: never mounted outside this script.
app.get('/__e2e/delivered', async (_req, res) => { const o = await makeDelivered(); res.json({ id: o.id, token: o.guestToken }); });
app.get('/__e2e/order/:id', async (req, res) => { const o = await db.collection('orders').findOne({ id: req.params.id }); res.json(o ? { paymentStatus: o.paymentStatus, paidAmountPaise: o.paidAmountPaise, paymentPlan: o.paymentPlan } : {}); });
app.get('/__e2e/reset-content', async (_req, res) => { await db.collection('settings').deleteOne({ _id: 'materials' }); await db.collection('banners').deleteMany({}); res.json({ ok: true }); });
app.get('/__e2e/last-order', async (_req, res) => { const rows = await db.collection('orders').find({}).toArray(); const o = rows[rows.length - 1]; res.json({ id: o.id, token: o.guestToken }); });
// Express registered the SPA catch-all first; move the test routes in front of it.
const stack = app._router.stack; const mine = stack.splice(stack.length - 4, 4); const idx = stack.findIndex((l) => l.route?.path === '*'); stack.splice(idx, 0, ...mine);

app.listen(PORT, '127.0.0.1', () => console.log(`e2e server on ${PORT}`));
