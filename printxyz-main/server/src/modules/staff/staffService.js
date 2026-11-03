import crypto from 'node:crypto';
import { AppError } from '../../middleware/errors.js';

export const STAFF_ROLE_LIST = ['owner', 'admin', 'manager', 'production', 'support'];
export const ROLE_INFO = {
  owner: 'Everything, including managing admins. At least one owner must always exist.',
  admin: 'Everything except managing owners and admins.',
  manager: 'Coupons, reports, customers, products, reviews, returns and refunds.',
  production: 'Orders, production status, shipping, inventory.',
  support: 'Orders, enquiries, reviews, returns (view and update status).'
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const bad = (m, code = 'INVALID_INPUT') => new AppError(400, code, m);
const forbidden = (m = 'You are not allowed to do that.') => new AppError(403, 'FORBIDDEN', m);
// Owners manage every level; admins manage the three operational roles and cannot touch owners or admins.
const assignableBy = (actorRole) => (actorRole === 'owner' ? ['admin', 'manager', 'production', 'support', 'owner', 'user'] : actorRole === 'admin' ? ['manager', 'production', 'support', 'user'] : []);
const view = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, totpEnabled: Boolean(u.totpEnabled), mustChangePassword: Boolean(u.mustChangePassword), createdAt: u.createdAt });

export const generateTempPassword = () => {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const all = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [pick('ABCDEFGHJKLMNPQRSTUVWXYZ'), pick('abcdefghjkmnpqrstuvwxyz'), pick('23456789'), pick('!@#$%*?'), ...Array.from({ length: 12 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
};

const revokeSessions = async (db, userId) => { for (;;) { const r = await db.collection('refresh_tokens').updateOne({ userId, revoked: false }, { $set: { revoked: true } }); if (!r.modifiedCount) break; } };
const audit = (db, actor, action, target, changes, now) => db.collection('audit_logs').insertOne({ at: now, actorId: actor.sub, actorEmail: actor.email, action, targetType: 'user', targetId: target, reason: '', changes });

export const listStaff = async ({ db }) => {
  const rows = [];
  for (const role of STAFF_ROLE_LIST) rows.push(...await db.collection('users').find({ role }).toArray());
  return rows.map(view).sort((a, b) => STAFF_ROLE_LIST.indexOf(a.role) - STAFF_ROLE_LIST.indexOf(b.role) || a.email.localeCompare(b.email));
};

// New staff always start with a one-time password they must change at first sign-in. Existing customer accounts are never
// promoted by email because customer emails are not verified at registration.
export const createStaff = async ({ db, hasher, actor, body = {}, now = new Date() }) => {
  const role = String(body.role || ''); const email = String(body.email || '').trim().toLowerCase(); const name = String(body.name || '').trim().slice(0, 120);
  if (!assignableBy(actor.role).includes(role) || role === 'user') throw forbidden('You cannot create a staff account with that role.');
  if (!EMAIL.test(email) || !name) throw bad('Name and a valid email are required.');
  if (await db.collection('users').findOne({ email })) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists. Staff accounts need a new email address.');
  const temp = generateTempPassword();
  const user = { _id: crypto.randomUUID(), name, email, role, picture: '', passwordHash: await hasher.hash(temp), mustChangePassword: true, createdAt: now };
  user.id = user._id;
  try { await db.collection('users').insertOne(user); } catch (e) { if (e?.code === 11000) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.'); throw e; }
  await audit(db, actor, 'create_staff', user.id, [{ field: 'role', from: '', to: role }], now);
  return { user: view(user), temporaryPassword: temp };
};

export const changeRole = async ({ db, actor, id, role, now = new Date() }) => {
  const nextRole = String(role || '');
  const target = await db.collection('users').findOne({ id: String(id || '') });
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  if (target.id === actor.sub) throw forbidden('You cannot change your own role.');
  const can = assignableBy(actor.role);
  if (!can.includes(nextRole)) throw forbidden('You cannot assign that role.');
  if (target.role !== 'user' && !can.includes(target.role)) throw forbidden('You cannot change this person\'s role.');
  if (target.role === 'owner' && nextRole !== 'owner') {
    const owners = await db.collection('users').countDocuments({ role: 'owner' });
    if (owners <= 1) throw new AppError(409, 'LAST_OWNER', 'There must always be at least one owner.');
  }
  if (target.role === nextRole) return view(target);
  await db.collection('users').updateOne({ id: target.id }, { $set: { role: nextRole } });
  // Sessions end when access is reduced; the short-lived access token expires on its own within 15 minutes.
  await revokeSessions(db, target.id);
  await audit(db, actor, 'change_role', target.id, [{ field: 'role', from: target.role, to: nextRole }], now);
  return view({ ...target, role: nextRole });
};

export const resetStaffPassword = async ({ db, hasher, actor, id, now = new Date() }) => {
  const target = await db.collection('users').findOne({ id: String(id || '') });
  if (!target || !STAFF_ROLE_LIST.includes(target.role)) throw new AppError(404, 'USER_NOT_FOUND', 'Staff member not found.');
  if (target.id === actor.sub) throw forbidden('Use Change password for your own account.');
  if (!assignableBy(actor.role).includes(target.role)) throw forbidden('You cannot reset this person\'s password.');
  const temp = generateTempPassword();
  await db.collection('users').updateOne({ id: target.id }, { $set: { passwordHash: await hasher.hash(temp), mustChangePassword: true } });
  await revokeSessions(db, target.id);
  await audit(db, actor, 'reset_staff_password', target.id, [], now);
  return { temporaryPassword: temp };
};
