import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

const bad = (m) => new AppError(400, 'INVALID_PRODUCT', m);
const slugify = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const url = (v) => { const s = String(v || '').trim(); return /^(https:\/\/|\/)/.test(s) ? s : ''; };
const list = (v, max = 12) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, max) : []);

// Validates admin product input. Prices are whole rupees (as the catalogue stores them).
export const validateProduct = (b = {}, { existing = null } = {}) => {
  const title = String(b.title ?? existing?.title ?? '').trim().slice(0, 160);
  if (!title) throw bad('Product title is required.');
  const price = Number(b.price ?? existing?.price);
  const mrp = Number(b.mrp ?? existing?.mrp ?? price);
  const stock = Number(b.stock ?? existing?.stock ?? 0);
  if (!Number.isInteger(price) || price <= 0 || price > 1_000_000) throw bad('Price must be a whole number of rupees between 1 and 10,00,000.');
  if (!Number.isInteger(mrp) || mrp < price) throw bad('MRP must be a whole number and not lower than the price.');
  if (!Number.isInteger(stock) || stock < 0) throw bad('Stock must be a whole number, 0 or more.');
  const image = url(b.image ?? existing?.image);
  if (!image) throw bad('A product image (https URL) is required.');
  const category = String(b.category ?? existing?.category ?? 'Custom').trim().slice(0, 60);
  return {
    id: existing?.id || `p_${crypto.randomBytes(6).toString('hex')}`,
    slug: existing?.slug || slugify(b.slug || title) || `product-${crypto.randomBytes(3).toString('hex')}`,
    title, category, categorySlug: slugify(b.categorySlug || category),
    price, mrp, stock,
    rating: Number(existing?.rating ?? 0), reviews: Number(existing?.reviews ?? 0),
    tags: list(b.tags ?? existing?.tags, 20),
    image, images: list(b.images ?? existing?.images).map(url).filter(Boolean).length ? list(b.images ?? existing?.images).map(url).filter(Boolean) : [image],
    videoUrl: url(b.videoUrl ?? existing?.videoUrl),
    description: String(b.description ?? existing?.description ?? '').trim().slice(0, 4000),
    badges: list(b.badges ?? existing?.badges, 6),
    featured: Boolean(b.featured ?? existing?.featured),
    published: b.published === undefined ? existing?.published !== false : Boolean(b.published),
    section: String(b.section ?? existing?.section ?? 'popular').slice(0, 40),
    hsn: (() => { const h = String(b.hsn ?? existing?.hsn ?? '').trim(); if (h && !/^\d{4,8}$/.test(h)) throw bad('HSN code must be 4 to 8 digits.'); return h; })(),
    createdAt: existing?.createdAt || new Date()
  };
};
