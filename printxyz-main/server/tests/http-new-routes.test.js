process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { loadEnv } from '../src/config/env.js';

const { createApp } = await import('../src/app.js');
const config = loadEnv({ NODE_ENV: 'test', RAZORPAY_WEBHOOK_SECRET: 'whsec', RAZORPAY_KEY_SECRET: 'ks', RAZORPAY_KEY_ID: 'rzp_test_x', JWT_SECRET: 'x'.repeat(40), META_PIXEL_ID: '123456789012' });
const tokens = { signAccess: (p) => `t.${p.sub}.${p.role}`, verifyAccess: (t) => { const [k, sub, role] = String(t).split('.'); return k === 't' ? { sub, role, email: `${sub}@x.com` } : null; } };
const hasher = { hash: async (p) => `h:${p}`, compare: async (p, h) => h === `h:${p}` };

const boot = async () => {
  const db = createFakeDb({ unique: { users: ['email'], alerts: ['key'] } });
  const app = createApp({ config, db, auth: {}, tokens, mailer: { configured: false }, razorpay: null, cloudinary: null, hasher });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, as } = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: `px_at=t.${as}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, server, call };
};

test('new admin routes: anonymous 401, customer 403, and the right staff roles allowed', async () => {
  const { server, call } = await boot();
  try {
    const adminPaths = ['/api/admin/staff', '/api/admin/banners', '/api/admin/sections', '/api/admin/returns', '/api/admin/alerts'];
    for (const p of adminPaths) {
      assert.equal((await call(p)).status, 401, `${p} anonymous`);
      assert.equal((await call(p, { as: 'u1.user' })).status, 403, `${p} customer`);
    }
    assert.equal((await call('/api/admin/staff', { as: 'm1.manager' })).status, 403);            // roles screen: owner/admin only
    assert.equal((await call('/api/admin/staff', { as: 'o1.owner' })).status, 200);
    assert.equal((await call('/api/admin/banners', { as: 'm1.manager' })).status, 200);
    assert.equal((await call('/api/admin/returns', { as: 's1.support' })).status, 200);
    assert.equal((await call('/api/admin/banners', { as: 's1.support' })).status, 403);
    assert.equal((await call('/api/admin/returns/RET-1/refund', { method: 'POST', as: 's1.support', body: {} })).status, 403);   // support cannot refund
    assert.equal((await call('/api/admin/staff/x/role', { method: 'PUT', as: 'm1.manager', body: { role: 'admin' } })).status, 403);
  } finally { server.close(); }
});

test('public content: banners, sections and materials are served; unsafe banners cannot be created', async () => {
  const { server, call } = await boot();
  try {
    assert.deepEqual((await (await call('/api/banners/active')).json()).items, []);
    assert.deepEqual((await (await call('/api/materials')).json()).items, []);
    const bad = await call('/api/admin/banners', { method: 'POST', as: 'o1.owner', body: { title: 'x', imageDesktop: 'https://a.com/i.jpg', link: 'javascript:alert(1)' } });
    assert.equal(bad.status, 400);
    const ok = await call('/api/admin/banners', { method: 'POST', as: 'o1.owner', body: { title: 'Sale', imageDesktop: 'https://a.com/i.jpg', link: '/search' } });
    assert.equal(ok.status, 201);
    assert.equal((await (await call('/api/banners/active')).json()).items[0].title, 'Sale');
    await call('/api/admin/materials', { method: 'PUT', as: 'o1.owner', body: { items: [{ name: 'PLA', care: 'Keep cool' }] } });
    assert.equal((await (await call('/api/settings/public')).json()).features.materialGuide, true);
  } finally { server.close(); }
});

test('staff creation over HTTP returns a one-time password; role change is enforced server-side', async () => {
  const { server, call, db } = await boot();
  try {
    const r = await call('/api/admin/staff', { method: 'POST', as: 'o1.owner', body: { name: 'Ravi', email: 'ravi@x.com', role: 'support' } });
    assert.equal(r.status, 201); const j = await r.json(); assert.ok(j.temporaryPassword);
    const id = j.user.id;
    assert.equal((await call(`/api/admin/staff/${id}/role`, { method: 'PUT', as: 'a1.admin', body: { role: 'owner' } })).status, 403);
    assert.equal((await call(`/api/admin/staff/${id}/role`, { method: 'PUT', as: 'a1.admin', body: { role: 'production' } })).status, 200);
    assert.equal((await db.collection('users').findOne({ id })).role, 'production');
  } finally { server.close(); }
});

test('alerts and tracking: test alert endpoint is admin-only and the pixel id reaches the browser config', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('/api/admin/alerts/test', { method: 'POST', as: 'm1.manager' })).status, 403);
    assert.equal((await call('/api/admin/alerts/test', { method: 'POST', as: 'o1.owner' })).status, 200);
    assert.equal((await (await call('/api/settings/public')).json()).tracking.metaPixelId, '123456789012');
    const csp = (await call('/api/health')).headers.get('content-security-policy');
    assert.match(csp, /connect\.facebook\.net/); assert.match(csp, /accounts\.google\.com\/gsi\/style/);
  } finally { server.close(); }
});

test('CSP: Meta hosts are absent when the pixel is not configured', async () => {
  const db = createFakeDb();
  const c2 = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40) });
  const app = createApp({ config: c2, db, auth: {}, tokens, mailer: { configured: false }, razorpay: null, cloudinary: null });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  try { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/health`); assert.ok(!r.headers.get('content-security-policy').includes('facebook')); } finally { server.close(); }
});
