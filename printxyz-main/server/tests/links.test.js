process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { loadEnv } from '../src/config/env.js';
import { createLink, listLinks, setLinkActive, resolveLink, buildUtm } from '../src/modules/links/linkService.js';

const actor = { sub: 'o', email: 'o@x.com', role: 'owner' }; const SITE = 'https://printxyz.in';
const seed = async () => { const db = createFakeDb({ unique: { short_links: ['_id'] } });
  await db.collection('products').insertOne({ id: 'p1', slug: 'ganesha-lamp', title: 'Ganesha Lamp', category: 'Devotional', categorySlug: 'devotional', published: true });
  await db.collection('products').insertOne({ id: 'p2', slug: 'hidden', title: 'Hidden', category: 'Draft', categorySlug: 'draft', published: false });
  return db; };

test('utm tags follow the placement and are made URL-safe', () => {
  assert.deepEqual(buildUtm({ placement: 'instagram_ad', campaign: 'Diwali Sale 2026!', content: 'Reel #1' }), { utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'diwali-sale-2026', utm_content: 'reel-1' });
  assert.deepEqual(buildUtm({ placement: 'youtube_description', campaign: '', content: '' }), { utm_source: 'youtube', utm_medium: 'video', utm_campaign: 'general' });
});
test('links: only real, published products and existing categories; placement and campaign are required', async () => {
  const db = await seed();
  const ok = await createLink({ db, siteUrl: SITE, actor, body: { type: 'product', value: 'ganesha-lamp', placement: 'instagram_ad', campaign: 'diwali', content: 'reel1' } });
  assert.match(ok.shortUrl, /^https:\/\/printxyz\.in\/s\/[a-z0-9]{7}$/);
  assert.equal(ok.longUrl, 'https://printxyz.in/product/ganesha-lamp?utm_source=instagram&utm_medium=paid_social&utm_campaign=diwali&utm_content=reel1');
  const cat = await createLink({ db, siteUrl: SITE, actor, body: { type: 'category', value: 'devotional', placement: 'youtube_description', campaign: 'diwali' } });
  assert.equal(cat.path, '/category/devotional');
  for (const body of [{ type: 'product', value: 'hidden' }, { type: 'product', value: 'nope' }, { type: 'category', value: 'nope' }, { type: 'page', value: 'https://evil.com' }, { type: 'page', value: '//evil.com' }, { type: 'product', value: 'ganesha-lamp', placement: 'tiktok', campaign: 'x' }, { type: 'product', value: 'ganesha-lamp', placement: 'whatsapp', campaign: '' }])
    await assert.rejects(createLink({ db, siteUrl: SITE, actor, body: { placement: 'whatsapp', campaign: 'c', ...body } }), (e) => e.code === 'INVALID_LINK', JSON.stringify(body));
  assert.equal((await listLinks({ db, siteUrl: SITE })).length, 2);
});
test('redirect: keeps saved tags, lets ad-platform click ids and tags win, counts clicks, honours disable', async () => {
  const db = await seed();
  const l = await createLink({ db, siteUrl: SITE, actor, body: { type: 'product', value: 'ganesha-lamp', placement: 'instagram_ad', campaign: 'diwali' } });
  const url = await resolveLink({ db, code: l.code, query: { fbclid: 'AbC123', utm_content: 'story2', evil: '<script>', utm_source: 'x'.repeat(500) } });
  const q = new URL(`https://x${url}`);
  assert.equal(q.pathname, '/product/ganesha-lamp'); assert.equal(q.searchParams.get('fbclid'), 'AbC123'); assert.equal(q.searchParams.get('utm_content'), 'story2');
  assert.equal(q.searchParams.get('utm_source'), 'instagram'); assert.equal(q.searchParams.get('evil'), null); assert.equal(q.searchParams.get('utm_campaign'), 'diwali');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await listLinks({ db, siteUrl: SITE }))[0].clicks, 1);
  assert.equal(await resolveLink({ db, code: 'unknown1' }), null);
  await setLinkActive({ db, code: l.code, active: false });
  assert.equal(await resolveLink({ db, code: l.code }), null);
});

const { createApp } = await import('../src/app.js');
test('HTTP: /s/:code redirects (302, no-store) and unknown codes go home; admin API needs a staff role', async () => {
  const config = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), PUBLIC_SITE_URL: SITE });
  const tokens = { signAccess: (p) => `t.${p.sub}.${p.role}`, verifyAccess: (t) => { const [k, sub, role] = String(t).split('.'); return k === 't' ? { sub, role, email: `${sub}@x.com` } : null; } };
  const db = await seed();
  const app = createApp({ config, db, auth: {}, tokens, mailer: { configured: false }, razorpay: null, cloudinary: null });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, o = {}) => fetch(base + p, { redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(o.as ? { Cookie: `px_at=t.${o.as}` } : {}) }, method: o.method, body: o.body && JSON.stringify(o.body) });
  try {
    assert.equal((await call('/api/admin/links')).status, 401); assert.equal((await call('/api/admin/links', { as: 'u.user' })).status, 403);
    assert.equal((await call('/api/admin/links', { as: 's.support' })).status, 403);
    const made = await call('/api/admin/links', { method: 'POST', as: 'o.owner', body: { type: 'product', value: 'ganesha-lamp', placement: 'youtube_description', campaign: 'launch' } });
    assert.equal(made.status, 201); const { item } = await made.json();
    const r = await call(`/s/${item.code}?fbclid=zz`); assert.equal(r.status, 302); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('location'), /^\/product\/ganesha-lamp\?utm_source=youtube&utm_medium=video&utm_campaign=launch&fbclid=zz$/);
    assert.equal((await call('/s/doesnotexist')).headers.get('location'), '/');
  } finally { server.close(); }
});
