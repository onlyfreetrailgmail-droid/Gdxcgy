import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { createAuthService } from '../src/modules/auth/authService.js';
import { hotp, verifyTotp, base32Encode, base32Decode, generateTotpSecret, otpauthUrl, encryptSecret, decryptSecret } from '../src/utils/totp.js';
import { requireRole } from '../src/middleware/security.js';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
test('totp: matches the RFC 6238 test vectors (6-digit truncation)', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(hotp(RFC_SECRET, Math.floor(t / 30)), code, `t=${t}`);
    assert.equal(verifyTotp(RFC_SECRET, code, t * 1000), Math.floor(t / 30));
  }
});
test('totp: window of one step, rejects wrong, malformed and stale codes', () => {
  const t = 1234567890 * 1000;
  assert.equal(verifyTotp(RFC_SECRET, '005924', t + 30_000), Math.floor(1234567890 / 30));
  assert.equal(verifyTotp(RFC_SECRET, '005924', t + 90_000), null);
  for (const bad of ['000000', '12345', '1234567', 'abcdef', '', null, undefined]) assert.equal(verifyTotp(RFC_SECRET, bad, t), null);
  assert.deepEqual(base32Decode(base32Encode(Buffer.from('hello'))), Buffer.from('hello'));
  assert.match(generateTotpSecret(), /^[A-Z2-7]{32}$/);
  assert.ok(otpauthUrl({ secret: 'ABC', email: 'a@x.com' }).startsWith('otpauth://totp/Printxyz:a%40x.com?secret=ABC'));
});
test('totp: secrets are encrypted at rest and need the right key', () => {
  const enc = encryptSecret('SECRETVALUE', 'k1'.repeat(20));
  assert.ok(!enc.includes('SECRETVALUE')); assert.equal(decryptSecret(enc, 'k1'.repeat(20)), 'SECRETVALUE');
  assert.throws(() => decryptSecret(enc, 'k2'.repeat(20)));
  const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA'); assert.throws(() => decryptSecret(tampered, 'k1'.repeat(20)));
});

const config = { exposeDevOtp: false, jwt: { accessSecret: 's'.repeat(40), refreshSecret: 'r'.repeat(40), refreshTtlSeconds: 3600 }, google: { clientId: '' } };
const hasher = { hash: async (p) => `h(${p})`, compare: async (p, h) => h === `h(${p})` };
const tokens = { signAccess: (p) => `jwt:${JSON.stringify(p)}` };
const STRONG = 'Xk9#mPq2$vLw';
const build = async (user = {}) => {
  const db = createFakeDb({ unique: { users: ['email'], refresh_tokens: ['tokenHash'] } });
  await db.collection('users').insertOne({ _id: 'a1', id: 'a1', name: 'Owner', email: 'owner@x.com', role: 'owner', passwordHash: `h(${STRONG})`, ...user });
  return { db, svc: createAuthService({ db, config, hasher, tokens, mailer: { configured: false }, dummyHash: 'd' }) };
};
const enable = async (svc) => { const { secret } = await svc.beginTotp('a1'); const now = Date.now(); await svc.enableTotp('a1', hotp(secret, Math.floor(now / 30_000))); return secret; };

test('2fa: customers cannot set it up; enabling needs a valid code; secret never stored in plain text', async () => {
  const { svc, db } = await build();
  await db.collection('users').insertOne({ _id: 'c1', id: 'c1', email: 'c@x.com', role: 'user', passwordHash: 'x' });
  await assert.rejects(svc.beginTotp('c1'), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(svc.enableTotp('a1', '123456'), (e) => e.code === 'NO_SETUP');
  const { secret, otpauthUrl: url } = await svc.beginTotp('a1'); assert.ok(url.includes(secret));
  await assert.rejects(svc.enableTotp('a1', '000000'), (e) => e.code === 'INVALID_TOTP');
  await svc.enableTotp('a1', hotp(secret, Math.floor(Date.now() / 30_000)));
  const u = await db.collection('users').findOne({ id: 'a1' });
  assert.equal(u.totpEnabled, true); assert.ok(!JSON.stringify(u).includes(secret));
});
test('2fa: admin login needs the code; wrong code refused; a used code cannot be replayed; customers unaffected', async () => {
  const { svc } = await build(); const secret = await enable(svc);
  await assert.rejects(svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin' }), (e) => e.code === 'TOTP_REQUIRED');
  await assert.rejects(svc.login({ email: 'owner@x.com', password: 'wrong', role: 'admin', totp: hotp(secret, Math.floor(Date.now() / 30_000)) }), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin', totp: '000000' }), (e) => e.code === 'INVALID_TOTP');
  const next = hotp(secret, Math.floor(Date.now() / 30_000) + 1);                     // the enable step is already used
  assert.equal((await svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin', totp: next })).user.email, 'owner@x.com');
  await assert.rejects(svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin', totp: next }), (e) => e.code === 'INVALID_TOTP');
});
test('2fa: disabling needs password and a code', async () => {
  const { svc, db } = await build(); const secret = await enable(svc);
  const code = hotp(secret, Math.floor(Date.now() / 30_000) + 1);
  await assert.rejects(svc.disableTotp('a1', 'wrong', code), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(svc.disableTotp('a1', STRONG, '000000'), (e) => e.code === 'INVALID_TOTP');
  assert.deepEqual(await svc.disableTotp('a1', STRONG, code), { enabled: false });
  assert.equal((await db.collection('users').findOne({ id: 'a1' })).totpEnabled, false);
  assert.equal((await svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin' })).user.totpEnabled, false);
});

test('forced password change: flag travels in the token, staff routes refuse until changed', async () => {
  const { svc } = await build({ mustChangePassword: true });
  const s = await svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin' });
  assert.equal(s.user.mustChangePassword, true); assert.equal(JSON.parse(s.accessToken.slice(4)).mcp, true);
  let err = null; requireRole('owner')({ user: { role: 'owner', mcp: true } }, {}, (e) => { err = e; });
  assert.equal(err.code, 'PASSWORD_CHANGE_REQUIRED');
  err = 'unset'; requireRole('owner')({ user: { role: 'owner' } }, {}, (e) => { err = e; }); assert.equal(err, undefined);
});
test('change password: checks current, enforces the staff policy, clears the flag, ends old sessions', async () => {
  const { svc, db } = await build({ mustChangePassword: true });
  const old = await svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin' });
  await assert.rejects(svc.changePassword('a1', 'wrong', 'Another#Good9pw'), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(svc.changePassword('a1', STRONG, 'admin123'), (e) => e.code === 'WEAK_PASSWORD');
  await assert.rejects(svc.changePassword('a1', STRONG, STRONG), (e) => e.code === 'SAME_PASSWORD');
  const fresh = await svc.changePassword('a1', STRONG, 'Another#Good9pw');
  assert.equal(fresh.user.mustChangePassword, false); assert.equal(JSON.parse(fresh.accessToken.slice(4)).mcp, undefined);
  assert.equal((await db.collection('users').findOne({ id: 'a1' })).mustChangePassword, false);
  await assert.rejects(svc.refresh(old.refreshToken), (e) => e.code === 'SESSION_EXPIRED');
  assert.ok(await svc.refresh(fresh.refreshToken));
  await assert.rejects(svc.login({ email: 'owner@x.com', password: STRONG, role: 'admin' }), (e) => e.code === 'INVALID_CREDENTIALS');
});
test('change password: customers only need 8 characters', async () => {
  const { svc, db } = await build(); await db.collection('users').insertOne({ _id: 'c1', id: 'c1', email: 'c@x.com', role: 'user', passwordHash: 'h(oldpassword)' });
  await assert.rejects(svc.changePassword('c1', 'oldpassword', 'short'), (e) => e.code === 'WEAK_PASSWORD');
  assert.ok(await svc.changePassword('c1', 'oldpassword', 'newpassword1'));
});
