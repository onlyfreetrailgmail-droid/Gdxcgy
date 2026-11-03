import crypto from 'node:crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export const generateOtp = () => String(crypto.randomInt(100000, 1000000));

// Keyed hash so a leaked database cannot be brute-forced offline without the secret.
export const hashOtp = (otp, email, secret) =>
  crypto.createHmac('sha256', secret).update(`${String(email).toLowerCase()}|${otp}`).digest('hex');

export const createOtpRecord = ({ otp, email, secret, now = Date.now() }) => ({
  email: String(email).toLowerCase(),
  hash: hashOtp(otp, email, secret),
  attempts: 0,
  consumed: false,
  createdAt: new Date(now),
  expiresAt: new Date(now + OTP_TTL_MS)
});

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// Pure check. Returns { ok, reason, next } where `next` is the record to persist.
export const checkOtp = ({ record, input, email, secret, now = Date.now() }) => {
  if (!record || record.consumed) return { ok: false, reason: 'INVALID', next: record };
  if (record.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'LOCKED', next: record };
  if (new Date(record.expiresAt).getTime() <= now) return { ok: false, reason: 'EXPIRED', next: record };

  const good = /^\d{6}$/.test(String(input)) && safeEqualHex(record.hash, hashOtp(String(input), email, secret));
  if (good) return { ok: true, reason: null, next: { ...record, consumed: true } };
  const attempts = record.attempts + 1;
  return { ok: false, reason: attempts >= OTP_MAX_ATTEMPTS ? 'LOCKED' : 'INVALID', next: { ...record, attempts } };
};
