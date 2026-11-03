# Deploy: push to git, then set env variables

## Recommended: one Render service (API + website)
1. Push this repo to GitHub. In Render choose **New > Blueprint** and select the repo (it reads `render.yaml`).
2. In the service's **Environment** tab fill every variable marked `sync: false`. Minimum to take orders:
   `CLIENT_URL`, `PUBLIC_SITE_URL` (your exact https origin, e.g. `https://printxyz.in`), `MONGODB_URI`,
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CLOUDINARY_*`, `GOOGLE_CLIENT_ID`,
   `VITE_GOOGLE_CLIENT_ID`, `VITE_SITE_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
   `JWT_SECRET` and `JWT_REFRESH_SECRET` are generated for you. The server refuses to start in production if a required
   value is missing or weak, and prints a warning for recommended ones (alerts, Meta, courier).
   `VITE_*` values are baked into the website at build time: after changing one, redeploy.
3. Open the Render **Shell** once and run `npm run seed --workspace server` (creates the owner account and starter data).
   Sign in at `/admin`, change the password when asked, and turn on two-factor login (Admin tools > Security).
4. Razorpay dashboard > Webhooks: URL `https://YOUR-DOMAIN/api/payments/webhook`, events `payment.captured`,
   `payment.failed`, `refund.processed`, secret = `RAZORPAY_WEBHOOK_SECRET`.
5. Meta Pixel (docs/TRACKING_AND_SEO.md): set `META_PIXEL_ID` (and `META_ACCESS_TOKEN` for server-side events). While testing set
   `META_TEST_EVENT_CODE` from Events Manager > Test events, then clear it. The Pixel loads only after a visitor taps
   "Accept all" on the cookie banner; the Content-Security-Policy allows Meta only when `META_PIXEL_ID` is set.
6. Monitoring: docs/MONITORING.md. Content to write: docs/CONTENT_TODO.md.

## If the website is on Vercel instead
`vercel.json` proxies `/api/*` to `https://printxyz-api.onrender.com`: edit that hostname if your Render service has another name.
Set `TRUST_PROXY_HOPS=2` on Render (otherwise every visitor shares one IP for rate limits). Vercel serves the pages, so the
strict Content-Security-Policy from the API does not apply to them; the single-service setup above is stronger.

## Before going live
* Run `npm test` and `npm run test:e2e` (CI does this on every push).
* Do one full Razorpay **test-mode** order, one part-payment order (custom product), one refund, and one return.
* Admin > Alerts > Send test alert.
