# Email (Resend)

All order emails go through a durable queue (`email_queue`). Checkout never waits for email, and a Resend outage only delays messages: each job is retried up to 5 times with growing delays, then marked failed. Owners/admins can see counts and recent failures at `GET /api/admin/email/health` and re-queue failures with `POST /api/admin/email/retry`.
Login codes (OTP) are sent directly, not queued, so the customer sees immediately if sending fails.

## Emails sent
Order paid (with invoice link), preview ready, shipped, out for delivery, delivered, refund processed, and an abandoned-checkout reminder.
Not built yet: welcome, balance reminder, cancellation, security alerts, review request after delivery, newsletter.

## Rules
- **transactional**: always sent (unless the address is suppressed by a bounce/complaint).
- **reminder** (abandoned checkout): at most 1 per 7 days and 3 in total per address; never after a purchase or opt-out; has an unsubscribe link and `List-Unsubscribe` header.
- **marketing**: only to customers who opted in (nothing sends marketing yet).
Owner decision: confirm with your advisor that abandoned-checkout reminders without prior opt-in are acceptable under India's DPDP Act before enabling them (they can be disabled by removing the `onExpired` hook in `src/app.js`).

## Domain setup (do before launch)
1. Resend dashboard > Domains > add your domain; add the SPF, DKIM records it shows at your DNS provider.
2. Add a DMARC record, for example `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:you@yourdomain` (tighten to `quarantine` after a clean week).
3. Set `RESEND_FROM_EMAIL` to an address on that domain.
4. Webhooks: Resend > Webhooks > add `https://<your-domain>/api/hooks/mail`, select delivered, bounced, complained; copy the signing secret (starts `whsec_`) into `RESEND_WEBHOOK_SECRET`. Complaints always suppress the address; bounces suppress only when Resend marks them permanent (verify the bounce field name against a real event).
