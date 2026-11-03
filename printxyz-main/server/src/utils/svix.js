import crypto from 'node:crypto';

// Svix signature scheme used by Resend webhooks: base64 HMAC-SHA256 over "id.timestamp.body",
// key = base64-decoded secret after the "whsec_" prefix, 5-minute window, any "v1," signature may match.
export const verifySvix = ({ rawBody, headers, secret, now = Date.now(), toleranceSeconds = 300 }) => {
  const id = headers['svix-id']; const ts = headers['svix-timestamp']; const sigHeader = headers['svix-signature'];
  if (!secret || !id || !ts || !sigHeader || !(Buffer.isBuffer(rawBody) || typeof rawBody === 'string')) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Math.floor(now / 1000) - t) > toleranceSeconds) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.`).update(rawBody).digest();
  return String(sigHeader).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
};
