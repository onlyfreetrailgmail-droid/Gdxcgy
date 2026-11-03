import { useEffect } from 'react';

// Canonical site origin. Set VITE_SITE_URL on the production build; it must match PUBLIC_SITE_URL on the server.
export const SITE_URL = String(import.meta.env.VITE_SITE_URL || 'https://printxyz.in').replace(/\/$/, '');
const DEFAULT_IMAGE = `${SITE_URL}/logo.jpeg`;
export const abs = (u) => (!u ? DEFAULT_IMAGE : /^https?:\/\//.test(u) ? u : `${SITE_URL}${u.startsWith('/') ? '' : '/'}${u}`);

const setMeta = (attr, key, content) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
};
const setCanonical = (href) => {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el); }
  el.setAttribute('href', href);
};

// One call per page: title, description, canonical, social preview, robots and JSON-LD.
// `path` is the canonical path without query string. Private pages pass noindex.
export const useSeo = ({ title, description, image, path, noindex = false, jsonLd = null }) => {
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(() => {
    const url = `${SITE_URL}${path ?? window.location.pathname}`;
    const desc = description || 'Custom 3D printed gifts, personalised keepsakes and home decor from Printxyz, made to order and shipped across India.';
    document.title = title;
    setMeta('name', 'description', desc);
    setCanonical(url);
    setMeta('property', 'og:site_name', 'Printxyz');
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', abs(image));
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', desc);
    setMeta('name', 'twitter:image', abs(image));
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : '');
    let script = document.getElementById('seo-jsonld');
    if (ld) {
      if (!script) { script = document.createElement('script'); script.id = 'seo-jsonld'; script.type = 'application/ld+json'; document.head.appendChild(script); }
      script.textContent = ld.replace(/</g, '\\u003c');
    } else if (script) script.remove();
    return () => { document.getElementById('seo-jsonld')?.remove(); document.head.querySelector('meta[name="robots"]')?.remove(); };
  }, [title, description, image, path, noindex, ld]);
};

// ---- structured data (real catalogue data only; no ratings or reviews are invented) ----
export const productLd = (p) => ({
  '@context': 'https://schema.org', '@type': 'Product',
  name: p.title, description: p.description || undefined,
  image: (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean).map(abs),
  sku: String(p.id), category: p.category || undefined, brand: { '@type': 'Brand', name: 'Printxyz' },
  offers: {
    '@type': 'Offer', url: `${SITE_URL}/product/${encodeURIComponent(p.slug)}`, priceCurrency: 'INR', price: Number(p.price).toFixed(2),
    availability: Number(p.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: 'Printxyz' }
  }
});
export const breadcrumbLd = (trail) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${SITE_URL}${t.path}` }))
});
export const faqLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } }))
});
export const organizationLd = ({ email = '', phone = '' } = {}) => ({
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Printxyz', url: SITE_URL, logo: `${SITE_URL}/logo.jpeg`,
  ...(email || phone ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'IN', ...(email ? { email } : {}), ...(phone ? { telephone: phone } : {}) } } : {})
});
export const websiteLd = () => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Printxyz', url: SITE_URL });

// Pages that must never be indexed. Mirrors DISALLOWED_PATHS on the server.
export const PRIVATE_PREFIXES = ['/cart', '/checkout', '/account', '/login', '/orders', '/track', '/admin', '/search'];
export const isPrivatePath = (pathname) => PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
