import { AppError } from '../../middleware/errors.js';

export const MAX_QTY_PER_LINE = 20;
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

// Defaults match today's storefront: shipping is free. Owner sets a fee in settings later.
export const DEFAULT_SETTINGS = Object.freeze({ freeShippingThresholdPaise: 149900, shippingFeePaise: 0 });

// Customer-supplied customisation: private photo references (strings, only ones from our own upload folder) and a short note.
export const cleanOptions = (o) => {
  if (!o || typeof o !== 'object') return undefined;
  const photos = [...new Set((Array.isArray(o.photos) ? o.photos : []).map((p) => String(p?.publicId ?? p ?? '')))]
    .filter((id) => id.startsWith('printxyz/customer-photos/') && id.length <= 200 && !/[\s"'<>]/.test(id)).slice(0, 5);
  const note = String(o.note ?? '').trim().slice(0, 500);
  return photos.length || note ? { photos, note } : undefined;
};

const fail = (code, message) => { throw new AppError(400, code, message); };

export const evaluateCoupon = ({ coupon, subtotalPaise, now = new Date() }) => {
  if (!coupon || coupon.active === false) fail('INVALID_COUPON', 'Coupon code not valid.');
  if (coupon.startsAt && new Date(coupon.startsAt) > now) fail('INVALID_COUPON', 'Coupon is not active yet.');
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) fail('COUPON_EXPIRED', 'Coupon has expired.');
  if (coupon.usageLimit != null && (coupon.usedCount || 0) >= coupon.usageLimit) fail('COUPON_EXHAUSTED', 'Coupon usage limit reached.');
  if (subtotalPaise < (coupon.minOrderPaise || 0)) {
    fail('COUPON_MINIMUM', `Add items worth ₹${Math.ceil(((coupon.minOrderPaise || 0) - subtotalPaise) / 100)} more to use this coupon.`);
  }
  let discount = coupon.type === 'percent'
    ? Math.floor((subtotalPaise * Number(coupon.value)) / 100)
    : Math.round(Number(coupon.value));
  if (coupon.maxDiscountPaise != null) discount = Math.min(discount, coupon.maxDiscountPaise);
  return Math.max(0, Math.min(discount, subtotalPaise));
};

// Pure. All money in integer paise. Throws AppError(400) on any invalid input.
export const priceCart = ({ products, items, coupon = null, settings = DEFAULT_SETTINGS, shippingQuotePaise = null, now = new Date() }) => {
  if (!Array.isArray(items) || items.length === 0) fail('EMPTY_CART', 'Your cart is empty.');
  if (items.length > 50) fail('CART_TOO_LARGE', 'Too many items in the cart.');
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const demanded = new Map();
  const lines = [];

  for (const raw of items) {
    const productId = String(raw?.productId ?? raw?.id ?? '').trim();
    const product = byId.get(productId);
    if (!product) fail('UNKNOWN_PRODUCT', 'One of the items is no longer available.');
    if (product.published === false) fail('PRODUCT_INACTIVE', `${product.title} is not available.`);
    const quantity = raw?.quantity ?? raw?.qty ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) fail('INVALID_QUANTITY', `Quantity must be a whole number from 1 to ${MAX_QTY_PER_LINE}.`);
    const total = (demanded.get(productId) || 0) + quantity;
    demanded.set(productId, total);
    if (Number.isFinite(product.stock) && total > product.stock) fail('OUT_OF_STOCK', `Only ${Math.max(product.stock, 0)} left of ${product.title}.`);
    const unitPricePaise = toPaise(product.price);
    if (!Number.isInteger(unitPricePaise) || unitPricePaise <= 0) fail('INVALID_PRICE', `${product.title} cannot be purchased right now.`);
    lines.push({
      productId, slug: product.slug, title: product.title, image: product.image, quantity,
      unitPricePaise, lineTotalPaise: unitPricePaise * quantity,
      // Custom options are kept as customer-supplied notes only; they never affect price here.
      options: cleanOptions(raw?.options)
    });
  }

  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const discountPaise = coupon ? evaluateCoupon({ coupon, subtotalPaise, now }) : 0;
  const afterDiscount = subtotalPaise - discountPaise;
  const shippingPaise = afterDiscount >= settings.freeShippingThresholdPaise ? 0 : (Number.isInteger(shippingQuotePaise) && shippingQuotePaise >= 0 ? shippingQuotePaise : settings.shippingFeePaise);
  return {
    lines, demanded, subtotalPaise, discountPaise, shippingPaise,
    totalPaise: afterDiscount + shippingPaise,
    couponCode: coupon ? coupon.code : null
  };
};
