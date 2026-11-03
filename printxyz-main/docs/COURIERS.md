# Courier setup: Shiprocket and Delhivery

Both are optional and independent. A courier with missing credentials is simply hidden/disabled. You can run one, both, or neither.
Where a detail is marked **(verify)** it comes from third-party SDKs or support articles, not the courier's own reference. Test on staging first.

## What the site does
- **Pincode check:** `GET /api/shipping/serviceability?pincode=XXXXXX` (asks every configured courier; shows a delivery estimate only if the courier returns one; "unknown" if every courier fails).
- **Create shipment (admin):** order must be paid, design-approved (custom orders) and marked *packed*. Pick Shiprocket or Delhivery per order. Stores courier, AWB, tracking link and label.
- **Status updates:** courier webhooks move the order forward only (never backwards, never out of delivered/returned). Delivery marks the order completed.
- **Refresh status** button pulls the latest status from the courier on demand.

## Shiprocket
1. Shiprocket panel > **Settings > API > Configure > Create an API User**. Use a *new* email that is not registered on Shiprocket. This is not your login.
2. **Settings > Pickup Addresses**: add your pickup address (you said you will add it later). Copy its **name** exactly.
3. Put in `.env` / Render: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`, `PICKUP_PINCODE`.
4. **Settings > API > Webhooks**: URL `https://<your-domain>/api/hooks/track-a`, enable it, set a token, and put the same token in `SHIPROCKET_WEBHOOK_TOKEN`. Shiprocket sends it as the `x-api-key` header. It has no signature. Shiprocket rejects callback URLs containing "shiprocket", "kartrocket", "sr" or "kr", which is why the path is `/api/hooks/track-a`.
5. Keep wallet balance: AWB assignment fails with an empty wallet.
Unverified (verify): the label endpoint path; the AWB response shape.

## Delhivery
1. Get an API token from your Delhivery account (staging token first). Set `DELHIVERY_TOKEN` and `DELHIVERY_MODE=staging`.
2. Register your pickup **warehouse** with Delhivery (panel or their warehouse API) and set `DELHIVERY_PICKUP_LOCATION` to the exact, case-sensitive name.
3. Webhook: Delhivery registers callback URLs during onboarding / via their support. Give them `https://<your-domain>/api/hooks/track-b/<DELHIVERY_WEBHOOK_SECRET>` (use a long random secret). Delhivery documents no signature, so the site treats the push only as "this waybill changed" and pulls the real status from Delhivery's tracking API.
4. When staging works end to end, switch to `DELHIVERY_MODE=production` with the production token.
Unverified (verify): the exact create-order response fields, the webhook payload field names, and the status wording map.

## Parcel size
Orders have no measured size yet. Defaults come from `SHIPPING_DEFAULT_*` (0.5 kg, 15x15x10 cm). Admin can send a per-shipment `parcel` override via the API.

## Shipping cost at checkout
When the customer enters a pincode, the server asks every configured courier for a rate and charges the cheapest, rounded up to whole rupees (cached 10 minutes, so the quote and the order match). Orders above `FREE_SHIPPING_THRESHOLD_RUPEES` ship free. If no courier returns a rate, `SHIPPING_FEE_RUPEES` is used instead. If every courier says the pincode is not serviceable, checkout is blocked for that pincode. The browser never sends a shipping amount.
Shiprocket's rate comes from its serviceability response. Delhivery's comes from its rate calculator endpoint (`/api/kinko/v1/invoice/charges/.json`); **(verify)** the response field on staging, because if it differs the Delhivery rate is simply left out.
Note: you pay the courier's real charge when booking, which may differ slightly from the checkout quote (weight, fuel surcharge). Set the parcel defaults to match your typical box.

## Not built yet
Returns/RTO claim records; NDR actions.
