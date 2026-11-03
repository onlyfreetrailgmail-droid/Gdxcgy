# Marketing tracking and SEO

## What is built
**Consent.** A cookie banner (Accept all / Essential only) gates everything marketing-related. The choice is stored in the browser and can be changed from "Cookie settings" in the footer. Rejecting keeps the shop fully usable.

**Meta Pixel (browser).** Loads only after consent and only when `META_PIXEL_ID` is set on the server (the id reaches the browser through `/api/settings/public`). Events: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase. Pages with private URLs (`/track`, `/orders`, `/account`, `/login`, `/admin`) never send events. Automatic form and button scraping is switched off so checkout details are not read by the pixel.

**Meta Conversions API (server).** `Purchase` is sent from the server only after a payment is verified (signed checkout callback or signed Razorpay webhook), only once per order, and only if the buyer accepted marketing cookies. Customer details are SHA-256 hashed before sending. The browser fires the same event with `event_id = purchase_<orderId>`, so Meta deduplicates the pair. A Meta outage never affects payment, invoices or email.

**Attribution.** `utm_*`, `fbclid` and `gclid` are captured for the browser session and saved on the order with the landing page. `_fbp`/`_fbc` and the buyer's IP and user agent are saved only with marketing consent.

**Diagnostics.** `GET /api/admin/tracking/health` (owner/admin) shows whether the pixel and Conversions API are configured, whether test mode is on, and sent/failed counts for the last 24 hours. Failures are stored in the `tracking_events` collection.

**SEO.**
- `robots.txt` and `sitemap.xml` are served by the API; `vercel.json` routes them to the site root. Non-production deployments return `Disallow: /`. Set `ALLOW_INDEXING=false` to block production too.
- Sitemap lists only public pages, categories and published products, with `lastmod` for products.
- Every page sets its own title, description, canonical URL, Open Graph and Twitter tags. Cart, checkout, account, orders, tracking, login, admin and search are `noindex`.
- Product pages carry Product + Offer (INR price, stock) and BreadcrumbList JSON-LD. Home carries Organization and WebSite. FAQ carries FAQPage.
- Unknown product, category and policy URLs show a not-found page marked `noindex` instead of another page's content.
- WhatsApp, Facebook, X, LinkedIn, Telegram, Slack and Discord crawlers do not run JavaScript, so `vercel.json` sends them to `/api/seo/product/:slug` and `/api/seo/category/:slug`, which return the right title, image and schema. People always get the normal app.
- No star ratings or review markup is published: the store has no real customer reviews yet.

## Setup
1. Meta Events Manager: create a Pixel, copy the id to `META_PIXEL_ID`. Under Settings > Conversions API, generate an access token and put it in `META_ACCESS_TOKEN`.
2. While testing, open Events Manager > Test events, copy the code to `META_TEST_EVENT_CODE`, and place a Razorpay test-mode order after accepting cookies. Check that one Purchase appears with both Browser and Server sources and is marked deduplicated. Clear the test code before launch.
3. In Events Manager turn **off** automatic advanced matching, so the pixel does not collect form fields on its own.
4. Set `VITE_SITE_URL` on Vercel to the final origin, `PUBLIC_SITE_URL`/`CLIENT_URL` on Render to the same origin, and replace `printxyz-api.onrender.com` in `vercel.json` if your API URL differs.
5. Google Search Console: add the domain, verify via DNS, submit `https://<domain>/sitemap.xml`. Do the same in Bing Webmaster Tools. Use URL Inspection on the home page, one product and one category.
6. After deploy, check `/robots.txt`, `/sitemap.xml`, view-source of a product link fetched with a `facebookexternalhit` user agent, and run Google's Rich Results Test on a product URL.
7. Set up Meta ad attribution by adding `?utm_source=instagram&utm_medium=paid&utm_campaign=<name>` to ad URLs.

## Not done here
GA4 and Google Ads tags, IndexNow, per-product SEO fields in the admin screen, 301 redirects when a slug changes, WebP image pipeline, Google Business Profile and local landing pages.
