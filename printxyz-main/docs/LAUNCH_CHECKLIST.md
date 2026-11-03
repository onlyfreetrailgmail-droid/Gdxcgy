# Launch checklist

Legend: [x] done in code, [ ] blocker or manual step.

## Verify the code (nothing below is trustworthy until these pass on your machine)
- [x] `npm test` (173 server tests), `npm run build` and `npm run test:e2e` (23 browser tests) all pass in the delivered code. Re-run on your machine once
- [ ] `tests/http.test.js` passes (boots the real server with an in-memory database)
- [ ] Manual test in Razorpay test mode: browse, add to cart, pay, confirm email + invoice link, create shipment on courier sandbox, see status change
- [ ] Lighthouse mobile on home, listing and product pages (targets 90+)

## Accounts and credentials (you)
- [ ] MongoDB Atlas cluster, network access for Render, backups enabled and one restore tested
- [ ] Cloudinary account and keys
- [ ] Razorpay live KYC, live keys, webhook set to `/api/payments/webhook` (payment.captured, payment.failed, refund.processed)
- [ ] Google OAuth consent screen published, authorised origins set
- [ ] Resend domain verified (SPF, DKIM, DMARC), webhook set (docs/EMAIL.md)
- [ ] Shiprocket and/or Delhivery accounts, pickup address, webhooks (docs/COURIERS.md)
- [ ] Domain, HTTPS, www to apex redirect; `CLIENT_URL` / `PUBLIC_SITE_URL` match the exact origin
- [ ] Run `npm run seed` once; replace seeded placeholder products and Unsplash stock images with real photos
- [x] Seeded owner must change the password at first login (admin area stays locked until then); two-factor login available under Admin tools, Security

## Business facts to fill in (never invented by the code)
- [ ] Business legal name and address in settings (`{{BUSINESS_ADDRESS}}` shows on invoices until set)
- [ ] Support phone and email (`SUPPORT_PHONE`, `SUPPORT_EMAIL`)
- [ ] Grievance officer name and contact, security contact in SECURITY.md
- [ ] Legal pages reviewed by a professional: Privacy, Terms, Shipping, Refund and Cancellation (current text is generic)
- [x] Live courier shipping rate at checkout (docs/COURIERS.md). Verify Delhivery's rate response on staging
- [x] Signed-in customers' carts are saved on the server and merged on login; orders are saved server-side with the customer id
- [x] Wishlist page and heart button; admin screen for cancellation requests
- [ ] Set `SHIPPING_FEE_RUPEES` (fee below the free-shipping threshold, default 0) and `FREE_SHIPPING_THRESHOLD_RUPEES`
- [ ] GST: now supported (see "GST and share links" below). Confirm registration, rate and HSN codes with a chartered accountant

## Built in code, needs your accounts and a live test
- [x] Meta Pixel, Conversions API with deduplication, UTM capture, cookie consent banner (docs/TRACKING_AND_SEO.md). Test with Meta Test events before launch
- [x] Product, Offer, Breadcrumb, Organization and FAQ schema, titles and canonicals per page, noindex on private pages, robots.txt, sitemap, crawler previews for shared links
- [x] About, FAQ, Size guide and Care pages (review the wording, docs/CONTENT_TODO.md)
- [ ] Search Console and Bing Webmaster verification and sitemap submission
- [ ] Set `VITE_SITE_URL`, `META_PIXEL_ID`, `META_ACCESS_TOKEN`

## Not built yet (planned)
- [x] Customer account screens: profile, addresses, preferences, data export, delete (client/src/AccountPanel.jsx). Wishlist screen still to do
- [x] Pincode check on product page and checkout; saved-address picker at checkout
- [x] Admin tools (Admin page): reports with CSV export, coupons, customers, low-stock list, review moderation, enquiries, shipping and business settings, change password, two-factor login. Still missing: a roles screen (roles are assigned in the database), banners and homepage sections editor
- [x] Verified-buyer reviews with moderation and up to 3 photos per review (photos are approved by staff; delivered through Cloudinary with automatic WebP/AVIF)
- [x] GA4 (consent-gated). Google Ads tag not added
- [x] Contact form and bulk-orders page (enquiries inbox in admin). Material guide page and editor built; **you must write the facts** in Admin > Materials (docs/CONTENT_TODO.md). The page and footer link stay hidden until you add a material
- [x] Part (advance) payments for custom and bulk orders: customer picks "advance" at checkout, pays the balance from the tracking page, staff can request it, auto-request when packed, 3 email reminders. Shipping is blocked until the balance is paid. Tune with `ADVANCE_PERCENT`, `ADVANCE_MIN_TOTAL_RUPEES`, `BULK_MIN_QUANTITY`
- [x] Sentry hook (set SENTRY_DSN). Uptime and alerts: Admin > Alerts, `ALERT_EMAIL`, `ALERT_WEBHOOK_URL`, `UPTIME_HEARTBEAT_URL` (docs/MONITORING.md). **You must create the external uptime monitor** on `/api/ready`
- [x] Customer cancellation (free before printing, otherwise a request for staff; auto-refund) and cancelled email. Staff screen for open requests and refund-pending orders done
- [x] Welcome, review-request, advance-received, balance-due, balance-reminder and return-update emails. Return requests: customer form on the tracking page after delivery, staff screen Admin > Returns (approve, receive, refund). Window set by `RETURN_WINDOW_DAYS` (**keep your Refund policy page consistent with it**)
- [x] Roles screen (Admin > Roles): owner/admin add team members with a one-time password and change roles. Banners and home-row editor (Admin > Banners)
- [x] End-to-end browser tests (Playwright, mobile viewport) run in CI: `npm run test:e2e` (checkout, part payment, returns, Meta consent, admin screens)

## Deploy (push to git, then fill env vars)
See docs/DEPLOY.md. Summary: connect the repo to Render using `render.yaml`, fill every `sync: false` variable once, run `npm run seed` once from the Render shell, add the Razorpay webhook, set up the uptime monitor.

## GST and share links (added)
- [x] GST invoicing: Admin > Settings > Business details. Turn on "Issue GST tax invoices", enter your **GSTIN** (checked for typos), rate (default 18%), optional HSN. Prices are treated as GST-inclusive; invoices show CGST + SGST (same state as your GSTIN) or IGST (other states), per-line taxable value and HSN, and credit notes carry the tax inside refunds. **You must enter your real GSTIN and confirm the rate/HSN with your accountant.** Checkout now uses a state dropdown so the tax split is always correct.
- [x] Share links for ads: Admin > Links. Pick a product, category or page, choose Instagram ad / YouTube description / WhatsApp etc., name the campaign, and copy the short link (`/s/xxxxxxx`). Visits are tagged automatically (UTM) and counted; Meta/Google click ids are preserved. If the site is on Vercel, `vercel.json` already forwards `/s/*` to the API.
