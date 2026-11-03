import { AppError } from './errors.js';
import { parseCookies } from '../utils/cookies.js';

export const ACCESS_COOKIE = 'px_at';
export const REFRESH_COOKIE = 'px_rt';
export const STAFF_ROLES = ['owner', 'admin', 'manager', 'production', 'support'];
export const CATALOG_ROLES = ['owner', 'admin', 'manager'];

// Blocks cross-site state-changing requests. Cookies are SameSite=Lax, and the Origin must also match our allow-list.
export const originGuard = (config) => (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/api/payments/webhook') return next();
  const origin = req.get('origin');
  if (origin && !config.corsOrigins.includes(origin)) return next(new AppError(403, 'BAD_ORIGIN', 'Request origin is not allowed.'));
  next();
};

// Rejects Mongo operator injection ("$ne", "a.b" keys) anywhere in JSON bodies and query strings.
const hasOperatorKeys = (v, depth = 0) => {
  if (depth > 8) return true;
  if (Array.isArray(v)) return v.some((x) => hasOperatorKeys(x, depth + 1));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k.startsWith('$') || k.includes('.') || hasOperatorKeys(x, depth + 1));
  return false;
};
export const noSqlGuard = (req, _res, next) =>
  (hasOperatorKeys(req.body) || hasOperatorKeys(req.query) ? next(new AppError(400, 'INVALID_INPUT', 'Invalid characters in request.')) : next());

export const attachUser = (tokens) => (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  req.user = cookies[ACCESS_COOKIE] ? tokens.verifyAccess(cookies[ACCESS_COOKIE]) : null;
  next();
};
export const requireAuth = (req, _res, next) => (req.user ? next() : next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.')));
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required.'));
  if (req.user.mcp) return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password before using the admin area.'));
  return roles.includes(req.user.role) ? next() : next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do that.'));
};
