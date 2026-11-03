import jwt from 'jsonwebtoken';
export const createTokens = (config) => ({
  signAccess: (payload) => jwt.sign(payload, config.jwt.accessSecret, { algorithm: 'HS256', expiresIn: config.jwt.accessTtlSeconds }),
  verifyAccess: (token) => { try { return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }); } catch { return null; } }
});
