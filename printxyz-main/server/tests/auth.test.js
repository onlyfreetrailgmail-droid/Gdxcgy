import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fakeDb.js';
import { createAuthService } from '../src/modules/auth/authService.js';
import { OTP_MAX_ATTEMPTS } from '../src/utils/otp.js';

const config = { exposeDevOtp: false, jwt: { accessSecret: 's'.repeat(40), refreshTtlSeconds: 3600 }, google: { clientId: 'gid' } };
const hasher = { hash: async (p) => `h(${p})`, compare: async (p, h) => h === `h(${p})` };
const tokens = { signAccess: (p) => `jwt.${p.sub}.${p.role}` };
const build = (over = {}) => {
  const db = createFakeDb({ unique: { users: ['email'], refresh_tokens: ['tokenHash'] } });
  const sent = [];
  const mailer = { configured: true, sendOtp: async (email, otp) => { sent.push({ email, otp }); return true; } };
  const svc = createAuthService({ db, config: over.config || config, hasher, tokens, mailer: over.mailer || mailer, googleVerifier: over.googleVerifier, dummyHash: 'dummy' });
  return { db, svc, sent };
};

test('register: creates customer, hashed password, rejects duplicate and weak password', async () => {
  const { svc, db } = build();
  const s = await svc.register({ name: 'Asha', email: 'A@x.com', password: 'longenough1' });
  assert.equal(s.user.role, 'user'); assert.ok(s.refreshToken && s.accessToken);
  assert.notEqual((await db.collection('users').findOne({ email: 'a@x.com' })).passwordHash, 'longenough1');
  await assert.rejects(svc.register({ name: 'B', email: 'a@x.com', password: 'longenough1' }), (e) => e.code === 'EMAIL_EXISTS');
  await assert.rejects(svc.register({ name: 'B', email: 'b@x.com', password: 'short' }), (e) => e.code === 'WEAK_PASSWORD');
});
test('login: wrong password and unknown user give the same error; customers cannot use admin login', async () => {
  const { svc } = build();
  await svc.register({ name: 'Asha', email: 'a@x.com', password: 'longenough1' });
  await assert.rejects(svc.login({ email: 'a@x.com', password: 'nope' }), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(svc.login({ email: 'ghost@x.com', password: 'nope' }), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(svc.login({ email: 'a@x.com', password: 'longenough1', role: 'admin' }), (e) => e.code === 'INVALID_CREDENTIALS');
  assert.equal((await svc.login({ email: 'a@x.com', password: 'longenough1' })).user.email, 'a@x.com');
});
test('otp: code is never in the response in production; stored hashed; works once', async () => {
  const { svc, sent, db } = build();
  const r = await svc.requestOtp({ email: 'n@x.com' });
  assert.deepEqual(r, { sent: true });
  const code = sent[0].otp;
  assert.ok(!JSON.stringify(await db.collection('otps').find({}).toArray()).includes(code));
  const s = await svc.verifyOtp({ email: 'n@x.com', otp: code });
  assert.equal(s.user.email, 'n@x.com');
  await assert.rejects(svc.verifyOtp({ email: 'n@x.com', otp: code }), (e) => e.code === 'INVALID_OTP');
});
test('otp: without email delivery in production the request fails instead of leaking the code', async () => {
  const { svc } = build({ mailer: { configured: false } });
  await assert.rejects(svc.requestOtp({ email: 'n@x.com' }), (e) => e.code === 'EMAIL_UNAVAILABLE');
});
test('otp: locks after max wrong attempts, then even the right code is refused', async () => {
  const { svc, sent } = build();
  await svc.requestOtp({ email: 'n@x.com' });
  const wrong = sent[0].otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await assert.rejects(svc.verifyOtp({ email: 'n@x.com', otp: wrong }));
  await assert.rejects(svc.verifyOtp({ email: 'n@x.com', otp: sent[0].otp }), (e) => e.code === 'OTP_LOCKED');
});
test('refresh: rotates once; reuse of an old token revokes the whole session family', async () => {
  const { svc } = build();
  const s1 = await svc.register({ name: 'Asha', email: 'a@x.com', password: 'longenough1' });
  const s2 = await svc.refresh(s1.refreshToken);
  assert.notEqual(s2.refreshToken, s1.refreshToken);
  await assert.rejects(svc.refresh(s1.refreshToken), (e) => e.code === 'SESSION_EXPIRED');
  await assert.rejects(svc.refresh(s2.refreshToken), (e) => e.code === 'SESSION_EXPIRED');
});
test('logout invalidates the refresh token; expired tokens are refused', async () => {
  const { svc } = build();
  const s = await svc.register({ name: 'Asha', email: 'a@x.com', password: 'longenough1' });
  await svc.logout(s.refreshToken);
  await assert.rejects(svc.refresh(s.refreshToken), (e) => e.code === 'SESSION_EXPIRED');
  const s2 = await svc.login({ email: 'a@x.com', password: 'longenough1' });
  await assert.rejects(svc.refresh(s2.refreshToken, new Date(Date.now() + 2 * 3600 * 1000)), (e) => e.code === 'SESSION_EXPIRED');
});
test('google: unverified or invalid tokens rejected; valid creates a customer', async () => {
  const { svc } = build({ googleVerifier: async (c) => { if (c === 'bad') throw new Error('x'); return { email: 'g@x.com', emailVerified: c !== 'unverified', name: 'G' }; } });
  await assert.rejects(svc.googleLogin({ credential: 'bad' }), (e) => e.code === 'INVALID_GOOGLE_TOKEN');
  await assert.rejects(svc.googleLogin({ credential: 'unverified' }), (e) => e.code === 'INVALID_GOOGLE_TOKEN');
  assert.equal((await svc.googleLogin({ credential: 'ok' })).user.email, 'g@x.com');
});
