import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

const bad = (m) => new AppError(400, 'INVALID_INPUT', m);
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const audit = (db, actor, action, target, now) => db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action, targetType: 'content', targetId: target, reason: '', changes: [] });

// ---------- banners (home page hero) ----------
const safeImage = (v) => { const u = txt(v, 600); if (!/^https:\/\/[^\s"'<>]+$/.test(u)) throw bad('Banner image must be an https link or an uploaded image.'); return u; };
const safeLink = (v) => { const u = txt(v, 300); if (!u) return '/'; if (/^\/(?!\/)[^\s"'<>]*$/.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u)) return u; throw bad('Link must start with / or https://'); };
const date = (v, label) => { if (v === undefined || v === null || v === '') return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid date.`); return d; };

export const validateBanner = (b = {}, existing = null) => {
  const title = txt(b.title ?? existing?.title, 120); if (!title) throw bad('Banner title is required.');
  const startsAt = date(b.startsAt ?? existing?.startsAt, 'Start date'); const endsAt = date(b.endsAt ?? existing?.endsAt, 'End date');
  if (startsAt && endsAt && endsAt <= startsAt) throw bad('End date must be after the start date.');
  const position = Number.isFinite(Number(b.position ?? existing?.position)) ? Math.round(Number(b.position ?? existing?.position)) : 0;
  return { title, subtitle: txt(b.subtitle ?? existing?.subtitle, 220), buttonText: txt(b.buttonText ?? existing?.buttonText, 40) || 'Shop now', link: safeLink(b.link ?? existing?.link),
    imageDesktop: safeImage(b.imageDesktop ?? existing?.imageDesktop), imageMobile: (b.imageMobile ?? existing?.imageMobile) ? safeImage(b.imageMobile ?? existing?.imageMobile) : '',
    position, active: b.active === undefined ? existing?.active !== false : Boolean(b.active), startsAt, endsAt };
};
const bannerView = (x) => ({ id: x._id, title: x.title, subtitle: x.subtitle, buttonText: x.buttonText, link: x.link, imageDesktop: x.imageDesktop, imageMobile: x.imageMobile || x.imageDesktop, position: x.position, active: x.active, startsAt: x.startsAt || null, endsAt: x.endsAt || null });

export const activeBanners = async ({ db, now = new Date() }) =>
  (await db.collection('banners').find({ active: true }).toArray())
    .filter((b) => (!b.startsAt || new Date(b.startsAt) <= now) && (!b.endsAt || new Date(b.endsAt) > now))
    .sort((a, b) => a.position - b.position).slice(0, 8).map((b) => { const v = bannerView(b); return { id: v.id, title: v.title, subtitle: v.subtitle, buttonText: v.buttonText, link: v.link, imageDesktop: v.imageDesktop, imageMobile: v.imageMobile }; });
export const listBanners = async ({ db }) => (await db.collection('banners').find({}).toArray()).sort((a, b) => a.position - b.position).map(bannerView);
export const createBanner = async ({ db, body, actor, now = new Date() }) => {
  if ((await db.collection('banners').countDocuments({})) >= 20) throw bad('You can keep up to 20 banners. Delete an old one first.');
  const doc = { _id: crypto.randomUUID(), ...validateBanner(body), createdAt: now };
  await db.collection('banners').insertOne(doc); await audit(db, actor, 'create_banner', doc._id, now); return bannerView(doc);
};
export const updateBanner = async ({ db, id, body, actor, now = new Date() }) => {
  const existing = await db.collection('banners').findOne({ _id: String(id) });
  if (!existing) throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found.');
  await db.collection('banners').updateOne({ _id: existing._id }, { $set: validateBanner(body, existing) });
  await audit(db, actor, 'update_banner', existing._id, now); return bannerView(await db.collection('banners').findOne({ _id: existing._id }));
};
export const deleteBanner = async ({ db, id, actor, now = new Date() }) => {
  const r = await db.collection('banners').deleteOne({ _id: String(id) });
  if (!r.deletedCount) throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found.');
  await audit(db, actor, 'delete_banner', String(id), now);
};

// ---------- home page sections (which product rows show, and in what order) ----------
export const SECTION_CHOICES = { trending: 'Trending', 'most-loved': 'Most loved', bestsellers: 'Bestsellers', 'new-arrivals': 'New arrivals', popular: 'Popular' };
const DEFAULT_SECTIONS = ['trending', 'most-loved'];
export const getHomeSections = async ({ db }) => {
  const s = await db.collection('settings').findOne({ _id: 'home_sections' });
  return Array.isArray(s?.items) ? s.items.filter((k) => SECTION_CHOICES[k]) : DEFAULT_SECTIONS;
};
export const setHomeSections = async ({ db, items, actor, now = new Date() }) => {
  if (!Array.isArray(items) || items.length > 5 || new Set(items).size !== items.length || items.some((k) => !SECTION_CHOICES[k])) throw bad('Choose up to 5 different sections from the list.');
  await db.collection('settings').updateOne({ _id: 'home_sections' }, { $set: { items } }, { upsert: true });
  await audit(db, actor, 'update_home_sections', 'home_sections', now);
  return items;
};

// ---------- material guide (owner-written facts only; nothing is pre-filled) ----------
const material = (m) => ({ name: txt(m?.name, 60), finish: txt(m?.finish, 120), bestFor: txt(m?.bestFor, 300), care: txt(m?.care, 400), limits: txt(m?.limits, 300) });
export const getMaterials = async ({ db }) => {
  const s = await db.collection('settings').findOne({ _id: 'materials' });
  return { intro: s?.intro || '', items: Array.isArray(s?.items) ? s.items : [] };
};
export const setMaterials = async ({ db, body = {}, actor, now = new Date() }) => {
  const items = (Array.isArray(body.items) ? body.items : []).map(material).filter((m) => m.name);
  if ((body.items || []).length > 12) throw bad('You can list up to 12 materials.');
  if (items.some((m) => !m.bestFor && !m.care && !m.finish && !m.limits)) throw bad('Add at least one detail for each material, or remove it.');
  const intro = txt(body.intro, 600);
  await db.collection('settings').updateOne({ _id: 'materials' }, { $set: { intro, items } }, { upsert: true });
  await audit(db, actor, 'update_materials', 'materials', now);
  return { intro, items };
};
