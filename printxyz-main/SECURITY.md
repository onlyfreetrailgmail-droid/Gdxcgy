# Security

## Reporting
Email the address in the footer of the site (add it to this file before launch: `{{SECURITY_CONTACT}}`). Please do not open public issues for vulnerabilities.

## How the app is protected
- Prices, totals, coupons and shipping are computed only on the server; the browser sends product IDs and quantities.
- Payments are confirmed only by a verified Razorpay signature or a signed webhook; amounts are checked against the stored order; duplicate events are ignored.
- Sessions are httpOnly, Secure, SameSite=Lax cookies with rotating refresh tokens (reuse revokes the session). Login, OTP, payment and upload routes are rate limited in MongoDB.
- OTPs are hashed, expire in 10 minutes and lock after 5 wrong attempts, and are never returned by the API in production.
- Customer photos are private (signed, short-lived URLs), type-checked from file bytes, size-limited, and deleted 90 days after an order finishes.
- Production startup fails when a required secret is missing, weak, a placeholder, or reused.
- Admin routes check the user's role on every request; every order status change and refund is written to an audit log.
- Helmet with a content-security policy, strict CORS and Origin checks on state-changing requests, request body size limits, and a guard against Mongo operator injection.

## Known gaps (see docs/LAUNCH_CHECKLIST.md)
No 2FA for admin accounts yet, no Sentry/uptime/backup automation yet, no admin UI for roles, courier webhooks use shared tokens (the couriers offer no signatures).
