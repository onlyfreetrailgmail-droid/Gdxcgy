import { escapeHtml } from '../../services/mailer.js';

// Pages that exist, are public and are worth indexing. Private pages (cart, checkout, account, orders,
// tracking, login, admin, search) are deliberately absent and are also marked noindex by the client.
export const STATIC_PATHS = ['/', '/gallery', '/about', '/contact', '/bulk-orders', '/faq', '/size-guide', '/care',
  '/policies/shipping', '/policies/refund', '/policies/privacy', '/policies/terms'];
export const DISALLOWED_PATHS = ['/admin', '/cart', '/checkout', '/account', '/login', '/orders', '/track/', '/search', '/api/'];

export const buildRobots = ({ siteUrl, allowIndexing }) => {
  // Non-production deployments are never indexable, whatever the sitemap says.
  if (!allowIndexing) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n${DISALLOWED_PATHS.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
};

const day = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); };

export const buildSitemap = ({ siteUrl, products = [], categories = [] }) => {
  const entries = [
    ...STATIC_PATHS.map((p) => ({ loc: `${siteUrl}${p === '/' ? '/' : p}` })),
    ...categories.map((c) => ({ loc: `${siteUrl}/category/${encodeURIComponent(c.slug)}` })),
    ...products.filter((p) => p.published !== false && p.slug).map((p) => ({ loc: `${siteUrl}/product/${encodeURIComponent(p.slug)}`, lastmod: day(p.updatedAt || p.createdAt) }))
  ];
  const seen = new Set();
  const unique = entries.filter((e) => (seen.has(e.loc) ? false : seen.add(e.loc)));
  const rows = unique.map((e) => `\n  <url><loc>${escapeHtml(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}\n</urlset>`;
};

const absolute = (siteUrl, u) => (!u ? `${siteUrl}/logo.jpeg` : /^https?:\/\//.test(u) ? u : `${siteUrl}${u.startsWith('/') ? '' : '/'}${u}`);

// Product and Offer markup from real catalogue data only. No aggregateRating or review markup: the store has
// no genuine, visible customer reviews yet, and marking up invented ones would break Google's guidelines.
export const productJsonLd = ({ product, siteUrl, reviews = null }) => {
  const url = `${siteUrl}/product/${encodeURIComponent(product.slug)}`;
  const images = (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean).map((i) => absolute(siteUrl, i));
  return {
    '@context': 'https://schema.org', '@type': 'Product',
    name: product.title, description: product.description || undefined, image: images, sku: String(product.id),
    category: product.category || undefined,
    brand: { '@type': 'Brand', name: 'Printxyz' },
    offers: {
      '@type': 'Offer', url, priceCurrency: 'INR', price: Number(product.price).toFixed(2),
      availability: Number(product.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'Printxyz' }
    },
    // Only from approved verified-buyer reviews that the product page also shows.
    ...(reviews && reviews.count > 0 && reviews.rating > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(reviews.rating).toFixed(1), reviewCount: reviews.count } } : {})
  };
};

export const breadcrumbJsonLd = ({ siteUrl, trail }) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${siteUrl}${t.path}` }))
});

export const organizationJsonLd = ({ siteUrl, email = '', phone = '' }) => ({
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Printxyz', url: siteUrl, logo: `${siteUrl}/logo.jpeg`,
  ...(email || phone ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', ...(email ? { email } : {}), ...(phone ? { telephone: phone } : {}), areaServed: 'IN' } } : {})
});

// JSON inside <script> must not be able to close the tag.
export const safeJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Lightweight HTML for link-preview bots and search crawlers: the correct title, image and structured data
// without running the app. People always get the normal single-page app.
export const renderSharePage = ({ siteUrl, path, title, description, image, jsonLd = [], heading, bodyHtml = '', noindex = false }) => {
  const url = `${siteUrl}${path}`;
  const t = escapeHtml(title); const d = escapeHtml(description); const img = escapeHtml(absolute(siteUrl, image));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title><meta name="description" content="${d}">
<link rel="canonical" href="${escapeHtml(url)}">${noindex ? '\n<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="Printxyz"><meta property="og:type" content="website"><meta property="og:title" content="${t}">
<meta property="og:description" content="${d}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${img}">
${jsonLd.map((j) => `<script type="application/ld+json">${safeJson(j)}</script>`).join('\n')}
</head><body><main><h1>${escapeHtml(heading || title)}</h1>${bodyHtml}<p><a href="${escapeHtml(url)}">View on Printxyz</a></p></main></body></html>`;
};

