# Uptime and alerts

Three layers, all driven by environment variables. Nothing needs code changes.

## 1. Is the site up? (external, free)
Create a monitor at UptimeRobot, BetterStack or Healthchecks.io:

| What | URL | Expect |
|---|---|---|
| Website | `https://printxyz.in/` | 200 |
| API + database | `https://printxyz.in/api/ready` | 200 `{"ok":true}` (503/500 means MongoDB is unreachable) |

Optional **heartbeat** (catches the case where the server itself is dead): create a heartbeat check, copy its URL into
`UPTIME_HEARTBEAT_URL`. The API pings it every 5 minutes while the API and database are healthy; if the pings stop, the
service alerts you.

## 2. Alerts from inside the app (Admin > Alerts)
Checked every 5 minutes. Each alert appears in **Admin > Alerts** and is also sent to `ALERT_EMAIL` (defaults to
`SUPPORT_EMAIL`) and, if set, to `ALERT_WEBHOOK_URL` (a Slack/Discord/Teams incoming webhook). The same alert is sent
at most once per hour while it stays open, and closes itself when the problem clears.

| Alert | Fires when | What to do |
|---|---|---|
| Database is unreachable | MongoDB ping fails | Check Atlas status and the IP allow-list |
| Payment failures are spiking | 3+ failed payments in 30 minutes | Check Razorpay status, keys, and your bank/UPI downtime |
| Orders need payment review | An order is flagged (amount mismatch, or a second payment on a closed order) | Open the order, check Razorpay, refund if needed |
| Razorpay webhook signature rejected | Webhook secret does not match | Copy the secret from Razorpay > Webhooks into `RAZORPAY_WEBHOOK_SECRET` |
| Checkout signature check failed | A payment confirmation failed verification | Check `RAZORPAY_KEY_SECRET`; repeated hits can mean tampering |
| Server errors are spiking | 10+ 5xx errors in 5 minutes | Check Render logs and Sentry |
| Emails are failing to send | 5+ emails permanently failed | Check Resend key and domain |
| Refunds need attention | A refund has been processing 3+ days, or a cancelled order still needs a refund | Open the order in Admin |

Use **Admin > Alerts > Send test alert** after setting `ALERT_EMAIL` or `ALERT_WEBHOOK_URL`. It tells you whether any
delivery channel is configured.

## 3. Errors with stack traces
Set `SENTRY_DSN` (personal data is stripped before sending).

## Hosting notes
* Render health check uses `/api/health` (process alive). Use `/api/ready` for your external monitor.
* Keep the Render plan paid: the free plan sleeps and misses payment webhooks.
