export const parseCookies = (header = '') =>
  Object.fromEntries(String(header).split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    const k = i < 0 ? p : p.slice(0, i);
    const v = i < 0 ? '' : p.slice(i + 1);
    try { return [k, decodeURIComponent(v)]; } catch { return [k, v]; }
  }));

// httpOnly + Secure (prod) + SameSite=Lax. Works because the browser talks to one origin
// (Express serves the build, or Vercel proxies /api to Render via vercel.json).
export const authCookieOptions = (config, maxAgeSeconds) => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/',
  maxAge: maxAgeSeconds * 1000
});
