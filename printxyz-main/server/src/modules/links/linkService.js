import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

const bad = (m) => new AppError(400, 'INVALID_LINK', m);
const slug = (v, max = 60) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, max);

// Where the link will be posted. Source and medium follow the usual analytics naming so reports group correctly.
export const PLACEMENTS = {
  instagram_ad: { label: 'Instagram ad', source: 'instagram', medium: 'paid_social' },
  instagram_organic: { label: 'Instagram bio, story or reel', source: 'instagram', medium: 'social' },
  youtube_description: { label: 'YouTube video description', source: 'youtube', medium: 'video' },
  youtube_ad: { label: 'YouTube ad', source: 'youtube', medium: 'paid_video' },
  facebook_ad: { label: 'Facebook ad', source: 'facebook', medium: 'paid_social' },
  whatsapp: { label: 'WhatsApp message or status', source: 'whatsapp', medium: 'social' },
  google_ad: { label: 'Google ad', source: 'google', medium: 'cpc' },
  other: { label: 'Other', source: 'other', medium: 'referral' }
};

// Targets are always paths on this site, built from a product or category that exists. Never a free URL.
const targetFor = async ({ db, type, value }) => {
  if (type === 'product') {
    const p = await db.collection('products').findOne({ slug: String(value || '') });
    if (!p || p.published === false) throw bad('That product was not found or is not published.');
    return { path: `/product/${encodeURIComponent(p.slug)}`, title: p.title };
  }
  if (type === 'category') {
    const p = await db.collection('products').findOne({ categorySlug: String(value || '') });
    if (!p) throw bad('That category has no products yet.');
    return { path: `/category/${encodeURIComponent(p.categorySlug)}`, title: p.category };
  }
  if (type === 'page' && ['/', '/bulk-orders', '/gallery', '/contact'].includes(String(value))) return { path: String(value), title: String(value) === '/' ? 'Home page' : String(value).slice(1) };
  throw bad('Choose a product, a category or a page.');
};

export const buildUtm = ({ placement, campaign, content }) => {
  const pl = PLACEMENTS[placement] || PLACEMENTS.other;
  const utm = { utm_source: pl.source, utm_medium: pl.medium, utm_campaign: slug(campaign) || 'general' };
  if (slug(content)) utm.utm_content = slug(content);
  return utm;
};
export const longUrl = ({ siteUrl, path, utm }) => `${siteUrl}${path}?${new URLSearchParams(utm).toString()}`;

const view = (l, siteUrl) => ({ code: l._id, label: l.label, path: l.path, title: l.title, placement: l.placement, utm: l.utm, active: l.active, clicks: l.clicks || 0, lastClickAt: l.lastClickAt || null,
  createdAt: l.createdAt, shortUrl: `${siteUrl}/s/${l._id}`, longUrl: longUrl({ siteUrl, path: l.path, utm: l.utm }) });

export const createLink = async ({ db, siteUrl, body = {}, actor, now = new Date() }) => {
  const target = await targetFor({ db, type: body.type, value: body.value });
  if (!PLACEMENTS[body.placement]) throw bad('Choose where this link will be shared.');
  if (!slug(body.campaign)) throw bad('Give the campaign a short name, for example diwali-sale.');
  if ((await db.collection('short_links').countDocuments({})) >= 2000) throw bad('You have reached the limit of 2000 links. Disable old ones first.');
  const utm = buildUtm({ placement: body.placement, campaign: body.campaign, content: body.content });
  const doc = { _id: crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 7), label: `${target.title} • ${PLACEMENTS[body.placement].label} • ${utm.utm_campaign}`.slice(0, 160),
    path: target.path, title: target.title, placement: body.placement, utm, active: true, clicks: 0, createdAt: now, createdBy: actor.email };
  try { await db.collection('short_links').insertOne(doc); }
  catch (e) { if (e?.code === 11000) return createLink({ db, siteUrl, body, actor, now }); throw e; }
  return view(doc, siteUrl);
};

export const listLinks = async ({ db, siteUrl }) => (await db.collection('short_links').find({}).sort({ createdAt: -1 }).limit(300).toArray()).map((l) => view(l, siteUrl));
export const setLinkActive = async ({ db, code, active }) => {
  const r = await db.collection('short_links').updateOne({ _id: String(code) }, { $set: { active: Boolean(active) } });
  if (!r.matchedCount && !r.modifiedCount) throw new AppError(404, 'LINK_NOT_FOUND', 'Link not found.');
};

const FORWARD = ['fbclid', 'gclid', 'ttclid', 'msclkid', 'igshid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'];
// Resolves a short link to the final on-site URL. Click-ids and UTM values that the ad platform adds win over the saved defaults.
export const resolveLink = async ({ db, code, query = {}, now = new Date() }) => {
  const l = await db.collection('short_links').findOne({ _id: String(code || '').toLowerCase() });
  if (!l || !l.active) return null;
  const params = new URLSearchParams(l.utm);
  for (const k of FORWARD) { const v = query[k]; if (typeof v === 'string' && v && v.length <= 200) params.set(k, v); }
  db.collection('short_links').updateOne({ _id: l._id }, { $inc: { clicks: 1 }, $set: { lastClickAt: now } }).catch(() => {});
  return `${l.path}?${params.toString()}`;
};
