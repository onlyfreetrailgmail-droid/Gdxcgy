# Printxyz

India-only ecommerce for 3D-printed gifts and custom keepsakes. React + Vite client, Express server, MongoDB Atlas, Cloudinary, Razorpay, Resend.

## Run locally
1. Node 22 (`nvm use`). `npm install` (first time after this change, to refresh the lockfile), then copy `.env.example` to `.env` and fill it in.
2. Set `MONGODB_URI` (Atlas free tier is fine), two different `JWT_*` secrets, and `ADMIN_EMAIL` / `ADMIN_PASSWORD` (12+ chars, mixed).
3. `npm run seed --workspace server` creates indexes, placeholder products, coupons and the owner account (password change is flagged as required).
4. `npm run dev` (client on 5173, API on 4001). `EXPOSE_DEV_OTP=true` shows login codes locally when Resend is not configured.

## Tests
`npm test` runs the server suite (node:test, no extra tools). `tests/http.test.js` boots the real Express app against an in-memory database.

## Architecture
`server/src`: `config` (env validation, fails fast in production), `db` (Mongo, indexes, atomic counters), `middleware` (errors, rate limits stored in Mongo, security), `modules` (auth, pricing, orders, payments, products), `services` (Razorpay, Cloudinary, Resend, Google, JWT).
Money is integer paise and is computed only on the server. Orders are created first (`pending_payment`, prices frozen, stock reserved), the Razorpay order is created from that stored amount, and a payment marks the order paid only after signature verification or a signed webhook. Sessions are httpOnly cookies with rotating refresh tokens.

## Email
Queue, templates, domain setup and webhooks: `docs/EMAIL.md`. Launch steps: `docs/LAUNCH_CHECKLIST.md`. Security notes: `SECURITY.md`.

## Tracking and SEO
Meta Pixel, Conversions API, consent, sitemap, structured data and setup steps: `docs/TRACKING_AND_SEO.md`. Content the owner must confirm: `docs/CONTENT_TODO.md`.

## Couriers
Shiprocket and Delhivery setup steps are in `docs/COURIERS.md`.

## Deploy (Render + Vercel)
`render.yaml` defines the API. Set every `sync: false` variable in the dashboard. In Razorpay, point the webhook to `https://<your-domain>/api/payments/webhook` with events `payment.captured`, `payment.failed`, `refund.processed`, and put its secret in `RAZORPAY_WEBHOOK_SECRET`. `vercel.json` proxies `/api` so the browser stays same-origin (needed for cookies). `CLIENT_URL` must match the exact site origin, and add the other of www/apex to `CORS_ORIGINS`.

## Admin tools
Sign in at `/admin`. The Admin tools card has reports and CSV export, coupons, customers, low stock, review moderation, enquiries, shipping and business settings, password change and two-factor login. Roles: owner and admin see everything; manager can use coupons, reports and customers; support and production see orders, inventory, reviews and enquiries.
