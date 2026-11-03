import crypto from 'node:crypto';

// RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), compatible with Google Authenticator, Authy, 1Password.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (buf) => { let bits = 0; let value = 0; let out = ''; for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += ALPHABET[(value << (5 - bits)) & 31]; return out; };
export const base32Decode = (str) => { let bits = 0; let value = 0; const out = []; for (const ch of String(str).toUpperCase().replace(/=+$/, '')) { const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error('bad base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));
export const hotp = (secretBase32, counter, digits = 6) => {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
};
// Returns the matching time step (so the caller can refuse a replay of the same code) or null.
export const verifyTotp = (secretBase32, code, now = Date.now(), window = 1) => {
  if (!/^\d{6}$/.test(String(code))) return null;
  const step = Math.floor(now / 30_000);
  for (let d = -window; d <= window; d++) {
    const expected = hotp(secretBase32, step + d); const a = Buffer.from(expected); const b = Buffer.from(String(code));
    if (crypto.timingSafeEqual(a, b)) return step + d;
  }
  return null;
};
export const otpauthUrl = ({ secret, email, issuer = 'Printxyz' }) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Authenticator secrets are encrypted at rest (AES-256-GCM), so a database leak alone does not defeat 2FA.
const keyFrom = (secret) => crypto.createHash('sha256').update(`${secret}|totp-at-rest`).digest();
export const encryptSecret = (plain, secret) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv); const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.'); };
export const decryptSecret = (packed, secret) => { const [iv, tag, enc] = String(packed).split('.').map((s) => Buffer.from(s, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); };
