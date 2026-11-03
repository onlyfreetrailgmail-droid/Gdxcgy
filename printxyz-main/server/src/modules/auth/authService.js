import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';
import { enqueueEmail } from '../notifications/queue.js';
import { validateAdminPassword } from '../../config/env.js';
import { generateTotpSecret, verifyTotp, otpauthUrl, encryptSecret, decryptSecret } from '../../utils/totp.js';
import { generateOtp, createOtpRecord, checkOtp } from '../../utils/otp.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const isDup = (e) => e?.code === 11000;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: Boolean(u.mustChangePassword), totpEnabled: Boolean(u.totpEnabled) });
const STAFF = ['owner', 'admin', 'manager', 'production', 'support'];
const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

// Collaborators are injected so the logic is testable without bcrypt/JWT/Resend/Google.
export const createAuthService = ({ db, config, hasher, tokens, mailer, googleVerifier, dummyHash = '' }) => {
  const users = () => db.collection('users');

  const newUser = async ({ name, email, password, role = 'user', picture = '', mustChangePassword = false }) => {
    const user = {
      _id: crypto.randomUUID(), name: String(name || email.split('@')[0]).trim().slice(0, 120), email, role, picture,
      passwordHash: await hasher.hash(password || crypto.randomBytes(24).toString('hex')),
      mustChangePassword, createdAt: new Date()
    };
    user.id = user._id;
    try { await users().insertOne(user); } catch (e) { if (isDup(e)) return null; throw e; }
    if (role === 'user') await enqueueEmail({ db, to: email, template: 'welcome', key: `welcome:${user.id}`, data: { name: user.name } }).catch(() => {});
    return user;
  };
  const findOrCreate = async ({ email, name, picture }) => (await users().findOne({ email })) || (await newUser({ name, email, picture })) || (await users().findOne({ email }));

  const issueSession = async (user, familyId = crypto.randomUUID(), now = new Date()) => {
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    await db.collection('refresh_tokens').insertOne({
      tokenHash: sha256(refreshToken), userId: user.id, familyId, used: false, revoked: false,
      createdAt: now, expiresAt: new Date(now.getTime() + config.jwt.refreshTtlSeconds * 1000)
    });
    return { accessToken: tokens.signAccess({ sub: user.id, email: user.email, role: user.role, ...(user.mustChangePassword ? { mcp: true } : {}) }), refreshToken, user: publicUser(user) };
  };

  return {
    issueSession,

    async register({ name, email, password }) {
      email = normEmail(email);
      if (!String(name || '').trim() || !EMAIL.test(email)) throw new AppError(400, 'INVALID_INPUT', 'Name and a valid email are required.');
      if (String(password || '').length < 8) throw new AppError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters.');
      const user = await newUser({ name, email, password });
      if (!user) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
      return issueSession(user);
    },

    async login({ email, password, role = 'user', totp }) {
      const user = await users().findOne({ email: normEmail(email) });
      // Always run a hash comparison so response time does not reveal whether the account exists.
      const ok = await hasher.compare(String(password || ''), user ? user.passwordHash : dummyHash);
      if (!user || !ok || (role === 'admin' ? !['owner', 'admin', 'manager', 'production', 'support'].includes(user.role) : user.role !== 'user')) throw invalid();
      if (role === 'admin' && user.totpEnabled) {
        if (!totp) throw new AppError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
        const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.jwt.refreshSecret), String(totp).trim());
        // A used step can never be reused, so a shoulder-surfed code is worthless.
        const claimed = step != null && (await users().updateOne({ id: user.id, totpLastStep: { $lt: step } }, { $set: { totpLastStep: step } })).modifiedCount;
        if (!claimed) throw new AppError(401, 'INVALID_TOTP', 'That code is not valid. Try the next one.');
      }
      return issueSession(user);
    },

    async beginTotp(userId) {
      const user = await users().findOne({ id: userId });
      if (!user || !STAFF.includes(user.role)) throw new AppError(403, 'FORBIDDEN', 'Two-factor login is for staff accounts.');
      const secret = generateTotpSecret();
      await users().updateOne({ id: userId }, { $set: { totpPendingEnc: encryptSecret(secret, config.jwt.refreshSecret) } });
      return { secret, otpauthUrl: otpauthUrl({ secret, email: user.email }) };
    },
    async enableTotp(userId, code) {
      const user = await users().findOne({ id: userId });
      if (!user?.totpPendingEnc) throw new AppError(409, 'NO_SETUP', 'Start the setup first.');
      const step = verifyTotp(decryptSecret(user.totpPendingEnc, config.jwt.refreshSecret), String(code || '').trim());
      if (step == null) throw new AppError(400, 'INVALID_TOTP', 'That code is not valid. Check your authenticator app and try again.');
      await users().updateOne({ id: userId }, { $set: { totpSecretEnc: user.totpPendingEnc, totpEnabled: true, totpLastStep: step }, $unset: { totpPendingEnc: '' } });
      return { enabled: true };
    },
    async disableTotp(userId, password, code) {
      const user = await users().findOne({ id: userId });
      if (!user?.totpEnabled) throw new AppError(409, 'NOT_ENABLED', 'Two-factor login is not enabled.');
      if (!(await hasher.compare(String(password || ''), user.passwordHash))) throw invalid();
      if (verifyTotp(decryptSecret(user.totpSecretEnc, config.jwt.refreshSecret), String(code || '').trim()) == null) throw new AppError(400, 'INVALID_TOTP', 'That code is not valid.');
      await users().updateOne({ id: userId }, { $set: { totpEnabled: false }, $unset: { totpSecretEnc: '' } });
      return { enabled: false };
    },

    // Clears the forced-change flag, ends every other session, and returns a fresh one for this browser.
    async changePassword(userId, current, next) {
      const user = await users().findOne({ id: userId });
      if (!user || !(await hasher.compare(String(current || ''), user.passwordHash))) throw invalid();
      const staff = STAFF.includes(user.role);
      const problems = staff ? validateAdminPassword(next) : (String(next || '').length >= 8 ? [] : ['at least 8 characters']);
      if (problems.length) throw new AppError(400, 'WEAK_PASSWORD', `New password needs: ${problems.join(', ')}.`);
      if (next === current) throw new AppError(400, 'SAME_PASSWORD', 'Choose a password you have not used before.');
      await users().updateOne({ id: userId }, { $set: { passwordHash: await hasher.hash(next), mustChangePassword: false } });
      for (;;) { const r = await db.collection('refresh_tokens').updateOne({ userId, revoked: false }, { $set: { revoked: true } }); if (!r.modifiedCount) break; }
      return issueSession({ ...user, mustChangePassword: false });
    },

    async requestOtp({ email }) {
      email = normEmail(email);
      if (!EMAIL.test(email)) throw new AppError(400, 'INVALID_EMAIL', 'A valid email is required.');
      if (!mailer?.configured && !config.exposeDevOtp) throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Unable to send a code right now.');
      const otp = generateOtp();
      await db.collection('otps').insertOne(createOtpRecord({ otp, email, secret: config.jwt.accessSecret }));
      if (mailer?.configured) {
        const sent = await mailer.sendOtp(email, otp);
        if (!sent) throw new AppError(502, 'OTP_SEND_FAILED', 'Unable to send the one-time password right now.');
      }
      // Only ever present in local development with EXPOSE_DEV_OTP=true. Never in production.
      return config.exposeDevOtp ? { sent: true, devOtp: otp } : { sent: true };
    },

    async verifyOtp({ email, otp }) {
      email = normEmail(email);
      const [record] = await db.collection('otps').find({ email }).sort({ createdAt: -1 }).limit(1).toArray();
      const r = checkOtp({ record, input: String(otp || '').trim(), email, secret: config.jwt.accessSecret });
      if (record && r.next !== record) await db.collection('otps').updateOne({ _id: record._id }, { $set: { attempts: r.next.attempts, consumed: r.next.consumed } });
      if (!r.ok) {
        const map = { EXPIRED: 'The code has expired. Please request a new one.', LOCKED: 'Too many wrong attempts. Please request a new code.' };
        throw new AppError(401, r.reason === 'INVALID' ? 'INVALID_OTP' : `OTP_${r.reason}`, map[r.reason] || 'The code is incorrect.');
      }
      return issueSession(await findOrCreate({ email }));
    },

    async googleLogin({ credential }) {
      if (!config.google.clientId) throw new AppError(501, 'GOOGLE_LOGIN_DISABLED', 'Google login is not configured.');
      let info;
      try { info = await googleVerifier(String(credential || '')); } catch { info = null; }
      if (!info?.email || info.emailVerified !== true) throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google token verification failed.');
      return issueSession(await findOrCreate({ email: normEmail(info.email), name: info.name, picture: info.picture }));
    },

    // Rotation: each refresh token works once. Presenting a used token means theft, so the whole family is revoked.
    async refresh(refreshToken, now = new Date()) {
      const col = db.collection('refresh_tokens');
      const rec = refreshToken ? await col.findOne({ tokenHash: sha256(String(refreshToken)) }) : null;
      if (!rec || rec.revoked || new Date(rec.expiresAt) <= now) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again.');
      const claimed = await col.updateOne({ _id: rec._id, used: false, revoked: false }, { $set: { used: true } });
      if (!claimed.modifiedCount) {
        await revokeFamily(col, rec.familyId);
        throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again.');
      }
      const user = await users().findOne({ id: rec.userId });
      if (!user) throw new AppError(401, 'SESSION_EXPIRED', 'Please sign in again.');
      return issueSession(user, rec.familyId, now);
    },

    async logout(refreshToken) {
      if (!refreshToken) return;
      const col = db.collection('refresh_tokens');
      const rec = await col.findOne({ tokenHash: sha256(String(refreshToken)) });
      if (rec) await revokeFamily(col, rec.familyId);
    },

    async me(userId) {
      const u = await users().findOne({ id: userId });
      if (!u) throw new AppError(404, 'USER_NOT_FOUND', 'Account not found.');
      return publicUser(u);
    }
  };
};

// Works with both the real driver (updateMany) and the minimal test double (loop of updateOne).
const revokeFamily = async (col, familyId) => {
  if (col.updateMany) return col.updateMany({ familyId }, { $set: { revoked: true } });
  for (;;) { const r = await col.updateOne({ familyId, revoked: false }, { $set: { revoked: true } }); if (!r.modifiedCount) break; }
};
