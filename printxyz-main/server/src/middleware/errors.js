import crypto from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

let reporter = null;
export const setErrorReporter = (fn) => { reporter = fn; };

export const requestId = (req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// Consistent { error: { code, message, requestId } }. Never leaks stack traces or internals.
export const errorHandler = (err, req, res, _next) => {
  const known = err instanceof AppError;
  const status = known ? err.status : (Number.isInteger(err?.status) && err.status < 500 ? err.status : 500);
  if (status >= 500) { try { reporter?.(err, req); } catch { /* reporting must never break the response */ } try { req.app?.locals?.onServerError?.(err, req); } catch { /* ignore */ } }
  if (status >= 500) console.error(JSON.stringify({ level: 'error', requestId: req.id, code: err?.code || 'INTERNAL', msg: err?.message }));
  res.status(status).json({ error: {
    code: known ? err.code : (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
    message: known || status < 500 ? err.message : 'Something went wrong.',
    requestId: req.id
  } });
};
