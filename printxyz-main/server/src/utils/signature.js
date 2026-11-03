import crypto from 'node:crypto';

const safeHexEqual = (expected, received) => {
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(received || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

// Checkout callback: HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id)
export const verifyCheckoutSignature = ({ orderId, paymentId, signature, secret }) => {
  if (!secret || !orderId || !paymentId || !signature) return false;
  return safeHexEqual(hmacHex(secret, `${orderId}|${paymentId}`), signature);
};

// Webhook: HMAC_SHA256(raw request body) with the webhook secret (not the API key secret).
export const verifyWebhookSignature = ({ rawBody, signature, secret }) => {
  if (!secret || !signature || !(Buffer.isBuffer(rawBody) || typeof rawBody === 'string')) return false;
  return safeHexEqual(hmacHex(secret, rawBody), signature);
};
