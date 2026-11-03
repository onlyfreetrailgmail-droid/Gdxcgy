# PRINTXYZ: Complete Build Specification

Give this entire file to the AI builder (Claude Code, Google Antigravity, Lovable, Cursor, etc.). Build in the phases from Section 20. Do not build features that are not in this document.

---

## 0. How to use this file

1. Put this file in the project root as `SPEC.md`.
2. Start with the **Master Prompt** (Section 19), then paste **one phase prompt** at a time (Section 20). Do not ask for everything in one go.
3. After each phase: run the app, test the acceptance criteria for that phase (Section 18), fix problems, then continue.
4. If the tool has a limited context, tell it: "Read SPEC.md sections X, Y, Z before changing code."

**Tool guidance**
| Tool | Recommended stack | Notes |
|---|---|---|
| Claude Code, Antigravity, Cursor | Primary stack (Section 2.1) | Can build the full Node + MongoDB backend |
| Lovable | Alternative stack (Section 2.2) | Lovable builds around Supabase (Postgres, Auth, Storage, Edge Functions). The data models in Section 7 map directly to tables. |

---

## 1. Project Overview

- **Brand:** Printxyz
- **What it is:** An online store, in the style of a marketplace brand, selling made-to-order and ready-to-ship products: custom photo products (lithophane lamps, 3D statues and miniatures of people and pets), devotional items (idols and god decor), toys, decorative items, name plates, keychains, and more. Products are produced on 3D printers by the owner and the catalog will grow into other product types.
- **Market:** India. Currency INR. Language English (Hinglish-friendly copy). Mobile-first: most visitors come from Instagram and WhatsApp on phones.
- **Owner:** One owner/admin, possibly a helper later.
- **Business model:** Standard products (buy now / add to cart), custom products (customer uploads photo and picks a size, owner sends a preview, customer approves, then production), bulk and corporate orders by enquiry.
- **Success criteria:** Fast, trustworthy, simple checkout; owner can manage everything without code (products, banners, coupons, orders, content).

---

## 2. Tech Stack

### 2.1 Primary stack (preferred)
- **Frontend:** React 18 + Vite, React Router, Tailwind CSS, TanStack Query, React Hook Form + Zod
- **Backend:** Node.js + Express, one service that **also serves the built React app** (needed for SEO meta injection and WhatsApp link previews, and avoids CORS and cross-site cookie problems)
- **Database:** MongoDB Atlas with Mongoose
- **Auth:** Google Sign-In (OAuth, ID token verified on the server), sessions via JWT in httpOnly + Secure + SameSite=Lax cookies
- **Images:** Cloudinary (signed uploads, `f_auto,q_auto` delivery)
- **Payments:** Razorpay (UPI, cards, netbanking) + Cash on Delivery option, webhook verification
- **Email:** Resend, Brevo or SMTP (Nodemailer)
- **WhatsApp:** WhatsApp Business Cloud API (template messages) behind an adapter so the provider can be swapped
- **Owner alerts:** Telegram bot + email
- **Invoices:** `pdfkit`
- **Hosting:** Render (single web service), custom domain `printxyz.in`
- **Package manager:** npm. Monorepo folders: `/server`, `/client`.

### 2.2 Alternative stack (for Lovable)
- React + Vite + Tailwind + shadcn/ui
- Supabase: Postgres (tables from Section 7), Supabase Auth with Google provider, Storage (images), Edge Functions (Razorpay order creation and webhook, notifications, invoice PDF, tracking events), Row Level Security on every table
- **SEO caveat:** a pure SPA cannot serve per-product Open Graph tags to WhatsApp. Use a prerender approach for product, category and blog pages (an Edge Function that returns HTML with meta tags for crawler user agents, or a prerender service), or switch to Next.js.

### 2.3 Code quality rules (apply to every tool)
- TypeScript on the client; JavaScript or TypeScript on the server (keep consistent)
- All money in **integer paise** in the database (or integer rupees, but be consistent and documented). Display as ₹ with Indian number formatting.
- Secrets only in environment variables. Provide `.env.example`.
- Server validates every input (Zod). Never trust prices or totals from the client.
- Write unit tests for: price calculation, coupon validation, tier pricing, GST split, invoice numbering.
- Small, readable files; no dead code; clear README with setup and deploy steps.

---

## 3. Design System

**Feel:** Clean, professional, trustworthy marketplace. Not cluttered, not gimmicky. No emojis in UI copy. Premium product photography is the hero.

- **Colors:** Primary deep navy `#0F172A`; accent orange `#F97316` (CTAs, badges, highlights); background white `#FFFFFF` and soft grey `#F8FAFC`; text `#0F172A` and muted `#64748B`; success `#16A34A`; error `#DC2626`. Define as CSS variables / Tailwind theme so they can be changed in one place.
- **Typography:** Inter for body, a bold geometric heading font (Poppins or Plus Jakarta Sans). Base 16px, line-height 1.6.
- **Logo:** Wordmark "Printxyz" with a small isometric cube whose three edges represent the X, Y and Z axes. Placeholder SVG in `/client/src/assets/`, easy to replace.
- **Layout:** Max content width 1280px, generous spacing, 8px spacing scale, rounded corners (12px cards, 8px buttons), subtle shadows.
- **Components:** Buttons (primary, secondary, ghost), cards, badges (Sale, New, Bestseller, Verified buyer), modals, toasts, skeleton loaders, accordions, tabs, breadcrumbs, stepper (checkout), star rating, image gallery with zoom.
- **Responsive:** Design mobile first (360px), then tablet and desktop. Sticky bottom bar on mobile product pages with "Add to Cart" and "Buy Now". Touch targets at least 44px.
- **Accessibility:** Semantic HTML, alt text, focus states, contrast AA, keyboard navigation, labels on all form fields.
- **Empty and error states** designed for every list (cart empty, no results, no orders).

---

## 4. Routes (Information Architecture)

**Public**
| Route | Page |
|---|---|
| `/` | Homepage |
| `/search?q=` | Search results |
| `/category/:slug` | Category listing |
| `/section/:slug` | Section listing (trending, bestsellers, most-loved, popular, new) |
| `/product/:slug` | Product detail |
| `/cart` | Cart |
| `/checkout` | Checkout |
| `/order/:id` | Order tracking and preview approval (logged in) |
| `/account`, `/account/orders`, `/account/addresses`, `/account/wishlist` | Account area |
| `/gallery` | Finished-work gallery |
| `/blog`, `/blog/:slug` | Blog |
| `/bulk-orders` | Bulk and corporate enquiry |
| `/about`, `/contact` | About, contact |
| `/policies/shipping`, `/policies/refund`, `/policies/privacy`, `/policies/terms` | Policy pages (editable in admin) |
| `/login` | Google sign-in |

**Admin** (`/admin/*`, role-gated): `dashboard`, `products`, `categories`, `sections`, `banners`, `announcement`, `orders`, `production-queue`, `customers`, `coupons`, `reviews`, `enquiries`, `blog`, `gallery`, `pages` (policies), `notifications`, `invoices`, `settings`, `reports`.

---

## 5. Customer-Facing Features

### 5.1 Global layout
- **Announcement bar** (top strip): admin-editable text, link, colors, on/off, optional schedule.
- **Navbar:** logo, **search bar** (centered on desktop, full-width row on mobile), category menu (mega menu on desktop, drawer on mobile), wishlist icon, cart icon with live count, login/profile menu.
- **Search bar:** debounced live suggestions (products, categories) as the user types, keyboard navigation, recent searches, "no results" with suggestions. Backend uses a MongoDB text index on title, tags, category, description (Atlas Search optional later for typo tolerance). Search results page: filters (category, price range, rating, in stock), sort (relevance, price low-high, price high-low, newest, rating).
- **Footer:** shop links, policy links, contact details, social links, payment icons, newsletter or WhatsApp opt-in.
- **Floating WhatsApp button** bottom-right (admin sets number and default message; on product pages prefill product name and URL). Does not overlap the mobile sticky bar.
- **Consent banner** for analytics and marketing cookies.

### 5.2 Homepage (in this order)
1. Announcement bar and navbar with search
2. **Banner carousel** (hero): auto-slides, swipe on mobile, arrows and dots, pause on hover. Banner types: offer banner, notification banner, product or category banner. Each banner has desktop and mobile images, optional title, subtitle, button text and link, start and end dates, active flag, order. On desktop, show a large main banner with two smaller side-by-side banners next to or below it (configurable layout: `carousel-only` or `carousel-plus-two`).
3. **Category strip:** circular or card icons of top categories
4. **Product sections** (horizontal scroll rows on mobile, grids on desktop, each with "View all"):
   - Trending
   - Most Loved (highest rated with enough reviews)
   - Popular
   - Bestsellers
   - New Arrivals
   - Admin can create additional custom sections (e.g. "Diwali Specials") and reorder or hide sections.
5. Trust strip: "Made to order", "Secure payments", "Preview before printing", "Pan-India delivery"
6. Featured custom products block ("Make it yours: upload your photo")
7. Customer photo reviews and gallery highlights
8. Instagram feed (6 posts, lazy loaded)
9. Recently viewed (only if the visitor has history)
10. Footer

### 5.3 Product card
Image (hover shows second image on desktop), title, price (or "From ₹X" for variable products), strike-through MRP and discount badge, star rating and count, badges (Bestseller, New, Custom, Sale), wishlist heart, quick "Add to cart" for simple products, "Customise" for custom products.

### 5.4 Product detail page
- Image gallery: multiple photos, zoom, swipe, optional video
- Title, rating summary (link to reviews), price, MRP, discount, tax-inclusive note, stock status, SKU
- **Variants** for standard products (size, color, finish) with stock per variant
- **Quantity selector** and **quantity price tier table** (e.g. 10+ ₹549) when configured
- **Pincode check:** delivery estimate and shipping charge
- **Buttons:** Add to Cart, Buy Now (skips cart, goes to checkout with this item). Sticky on mobile.
- Wishlist and share (WhatsApp share link)
- Tabs or accordions: Description, Specifications (material, dimensions, weight, care), Shipping and returns summary, Reviews
- **Reviews:** rating breakdown, photo reviews strip, "Verified buyer" badge, sort and filter, write review (logged-in buyers)
- **Frequently bought together** (checkbox bundle with combined add to cart)
- **Related products** and **recently viewed**
- Breadcrumbs, product schema and Open Graph (Section 12)

### 5.5 Custom products (e.g. "3D Statue", "Photo Lithophane Lamp")
Product `type = custom`.
1. **Size selector:** sizes defined by admin, each with label, dimensions (e.g. "8 x 10 x 6 cm"), price, active flag. Price updates live.
2. **Photo upload:** drag and drop or camera, 1 to `maxPhotos` images (admin-set per product, default 1 to 4), preview thumbnails, remove/replace, progress bar. Accept JPG, PNG, WebP up to 10 MB each. Show guidance ("use a clear, well-lit, front-facing photo").
3. **Notes field:** optional instructions (names, text to engrave, colors).
4. **Options:** extra add-ons defined by admin (e.g. frame, gift wrap, LED base) with prices.
5. **Live lithophane preview** (only for products with `livePreview = true`), see 5.6.
6. Add to cart / Buy Now stores: product, size, photo URLs, notes, add-ons, preview settings (contrast, brightness), and the server-calculated price.
7. Clear note: "You will receive a preview to approve before we start printing."
8. At checkout, a required checkbox for custom items: "I have read the refund policy and understand custom items cannot be cancelled once printing starts." Store acceptance time on the order.
9. **Advance payment:** admin-configurable percentage (default 50%) for custom orders; balance collected via payment link before shipping.

### 5.6 Live lithophane preview
Client-side only (HTML canvas); the photo does not leave the browser until add to cart.
- Convert to grayscale; sliders for contrast and brightness
- Two views: **Unlit** (grey relief) and **Lit** (warm backlight glow; brighter pixels show more light)
- Optional shape/frame overlays (rectangle, heart, lamp cube)
- Warn for low-resolution or very dark photos
- Disclaimer: "Indicative preview. Final print may vary slightly."
- Save chosen contrast and brightness with the cart item
- Fire a `PreviewTried` analytics event

### 5.7 Cart
- Line items with image, title, size/options, notes, quantity (custom items are quantity 1 per photo set unless the admin allows more), price, remove, move to wishlist
- Quantity tier prices applied automatically
- **Coupon input** with clear success and error messages (e.g. "Add ₹200 more to use this coupon")
- Price summary: subtotal, discount, shipping, tax (included or shown), total; for custom items show "Advance due now" and "Balance later"
- Frequently bought together suggestions
- Cart persists for logged-in users (database) and guests (localStorage), merged on login

### 5.8 Checkout
Stepper: **Address, Delivery, Payment, Review**.
- Login required (Google) before payment; guest browsing and carting allowed.
- Collect: name, phone (with WhatsApp opt-in checkbox), email (from Google), address (line 1, line 2, landmark, pincode, city, state), optional GSTIN for business invoice
- Pincode validates serviceability and shipping
- Payment: Razorpay (UPI, cards, netbanking, wallets) or COD (if enabled for the item and pincode; custom items prepaid only)
- Order review with policy acceptance
- On success: confirmation page with order number, next steps, WhatsApp support link
- Server recomputes everything; if the client total differs, use the server total

### 5.9 Account
- Orders list and detail: status timeline, items, photos uploaded, invoices (PDF download), tracking link, reorder, cancel (when allowed), pay balance, **approve preview or request changes** (with comment)
- Saved addresses (add, edit, delete, default)
- Wishlist
- Profile and notification preferences (WhatsApp and email opt-ins)
- My reviews

### 5.10 Gallery and blog
- **Gallery:** masonry grid of finished work, filter by category, each item links to its product ("Order something like this")
- **Blog:** list with tags, article page with cover image, related products, share buttons

### 5.11 Bulk and corporate enquiry (`/bulk-orders`)
Form: name, company, phone, email, product (dropdown or "custom"), quantity, logo or design upload, needed-by date, delivery city, company GSTIN, message. Shows the price tier tables. Submission sends an acknowledgement and an owner alert and fires a Lead event.

### 5.12 Policy and static pages
Shipping, Refund and Cancellation, Privacy, Terms, About, Contact. Content stored in the database, editable in admin with a rich text/markdown editor. Footer and checkout link to them. Required wording for the refund policy: custom items cannot be cancelled or returned once printing starts; damage claims need photos or an unboxing video within 24 to 48 hours (admin-editable).

---

## 6. Admin Panel

Access: role `admin` (full) and `staff` (limited: orders and production queue). Only emails on an allowlist (set in settings/env) get admin role on Google login. All admin API routes enforce roles on the server.

1. **Dashboard:** today and 7/30-day revenue, orders by status, new customers, top products, low stock, pending previews, abandoned carts, backup status, charts.
2. **Products:** list with search, filters, bulk actions; create/edit form with title, slug, type (standard or custom), category, tags, short and long description, specifications, multiple images (drag to reorder, set main), video URL, MRP, price, SKU, stock, variants, **sizes and prices (custom)**, **quantity price tiers**, add-ons, max photos, live preview toggle, bundle-with products, section flags (trending, bestseller, most loved, popular, new) with manual priority, SEO fields, active/draft. Duplicate product action.
3. **Categories:** tree (parent and child), image, order, SEO fields.
4. **Sections:** create and reorder homepage sections, choose auto-rank rule or manual product list, show/hide.
5. **Banners:** create/edit/reorder/schedule/activate; desktop and mobile images; type (offer, notification, product, category); link; layout setting; preview.
6. **Announcement bar:** text, link, colors, schedule, on/off.
7. **Orders:** table with filters (status, date, payment, type), detail view with customer photos (view and download), notes, status update (triggers notifications), add tracking number and courier, refund, cancel, create balance payment link, print invoice or packing slip, export CSV.
8. **Production queue:** kanban board for custom orders (Photo received, Preview in progress, Preview sent, Approved, Printing, Finishing, Ready to ship) with due dates, drag to change status, upload preview image(s) and send for approval.
9. **Customers:** searchable list (name, phone, email, orders, lifetime spend, last order, tags), profile page with order history, notes timeline (author, timestamp), tags, enquiries, reviews, WhatsApp quick link, CSV export.
10. **Coupons:** create and manage (Section 9.3), usage statistics.
11. **Reviews:** moderation queue (approve, reject, reply, feature), photo review view.
12. **Enquiries:** bulk enquiry pipeline (new, quoted, negotiating, won, lost), notes, quote amount, attachments, convert to order with payment link.
13. **Blog and gallery:** CRUD with image upload, markdown editor, SEO fields, publish scheduling.
14. **Pages:** edit policy and static pages.
15. **Notifications:** edit message templates per event and channel, view send logs with status and retry.
16. **Invoices:** list, download, regenerate, credit notes, monthly export for the accountant.
17. **Settings:** business details (name, address, phone, email, GSTIN, state), WhatsApp number and default message, shipping rules (flat rate, free shipping threshold, per-pincode rules, COD toggle and fee), advance percentage, tax settings, tracking IDs (Meta Pixel, GA4, Google Ads), social links, Instagram embed settings, admin allowlist, maintenance mode.
18. **Reports:** sales by day/product/category/coupon, customer repeat rate, abandoned cart recovery, CSV export.

---

## 7. Data Models

(Shown in Mongoose-style. For Supabase map each to a table, embedded arrays to jsonb or child tables. All documents have `createdAt` and `updatedAt`.)

**User**: googleId, name, email (unique), avatar, phone, role (`customer|staff|admin`), addresses[{label, name, phone, line1, line2, landmark, pincode, city, state, isDefault}], wishlist[productId], recentlyViewed[productId], marketingOptIn{whatsapp, email}, tags[], notes[{text, createdBy, createdAt}], stats{orders, spend, lastOrderAt}, lastLoginAt.

**Category**: name, slug, parent, image, description, order, active, seo{title, description}.

**Product**: title, slug (unique), type (`standard|custom`), category, tags[], shortDescription, description, specifications[{key, value}], images[{url, alt}], videoUrl, mrp, price, sku, stock, variants[{name, options[], priceDelta, stock, sku}], sizes[{label, dimensions, price, active}], priceTiers[{minQty, unitPrice}], addOns[{label, price, active}], customConfig{minPhotos, maxPhotos, allowNotes, livePreview, advancePercent}, bundleWith[productId], relatedByOrders[productId], sectionFlags[{section, priority}], ratingAvg, ratingCount, salesCount, viewCount, weightGrams, hsnCode, gstRate, active, seo{title, description}.

**Section**: title, slug, rule (`manual|trending|bestsellers|mostLoved|popular|newest`), productIds[], limit, order, active.

**Banner**: type, title, subtitle, imageDesktop, imageMobile, buttonText, link, layoutSlot (`main|side1|side2`), startsAt, endsAt, order, active.

**Announcement** (in Settings): text, link, bgColor, textColor, startsAt, endsAt, active.

**Cart**: user, items[{product, variant, size, quantity, addOns[], photos[], notes, previewSettings{contrast, brightness}, unitPrice}], couponCode, updatedAt, abandonedAt, reminders[{sentAt, channel, step}], recovered.

**Order**: number (e.g. `PX-2026-000123`), user, items[{product, title, image, variant, size, quantity, addOns[], photos[], notes, previewSettings, unitPrice, lineTotal, hsnCode, gstRate}], address, contact{name, phone, email, gstin}, pricing{subtotal, discount, shipping, tax, total, advanceDue, balanceDue}, coupon{code, discount}, payment{method (`razorpay|cod`), status, razorpayOrderId, razorpayPaymentId, advancePaid, balancePaid}, type (`standard|custom|bulk`), status, statusHistory[{status, at, by, note}], preview{images[], status (`none|sent|approved|changes_requested`), customerComment, sentAt, respondedAt}, shipment{courier, trackingNumber, trackingUrl, shippedAt, deliveredAt}, termsAcceptedAt, purchaseTracked, invoiceId, notes, createdAt.

**Coupon**: code (unique, uppercase), description, discountType (`percent|flat`), discountValue, maxDiscount, minCartValue, startsAt, expiresAt, usageLimitTotal, usageLimitPerUser, usedCount, applicableTo (`all|categories|products`), categoryIds[], productIds[], excludeSaleItems, firstOrderOnly, active, usage[{user, order, at}].

**Review**: product, user, order, rating (1-5), title, body, photos[], verified, status (`pending|approved|rejected`), adminReply, helpfulCount.

**Enquiry**: name, company, phone, email, product, quantity, files[], neededBy, city, gstin, message, status, quoteAmount, notes[], convertedOrder.

**BlogPost**: title, slug, cover, excerpt, content (markdown), tags[], seo{}, status, publishedAt, author.

**GalleryItem**: image, caption, category, product, order, active.

**Page**: slug, title, content, updatedAt.

**NotificationLog**: event, channel, to, templateKey, payload, status, attempts, error, order, sentAt.

**Invoice**: number, financialYear, order, pdfUrl, seller{}, buyer{}, lines[], taxBreakup{cgst, sgst, igst}, total, type (`invoice|credit_note`), issuedAt.

**InvoiceCounter**: financialYear, prefix, seq (atomic increment).

**Setting** (single document): business{}, gst{}, shipping{}, cod{}, advancePercent, tracking{}, social{}, whatsapp{}, announcement{}, adminEmails[].

---

## 8. API Endpoints

All under `/api`. JSON in and out. Auth via httpOnly cookie. Pagination `?page=&limit=`. Standard error format `{ error: { code, message, fields? } }`.

**Auth:** `POST /auth/google` (ID token), `POST /auth/logout`, `GET /auth/me`.
**Catalog:** `GET /products` (filters, sort, section, category, q), `GET /products/:slug`, `GET /products/suggest?q=`, `GET /products?ids=` , `GET /categories`, `GET /sections/home`, `GET /banners/active`, `GET /settings/public`.
**Cart:** `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `POST /cart/coupon`, `DELETE /cart/coupon`, `POST /cart/merge`.
**Checkout and orders:** `POST /checkout/quote` (server price calc), `POST /orders` (create, returns Razorpay order), `POST /payments/razorpay/webhook`, `POST /payments/verify`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`, `POST /orders/:id/preview/approve`, `POST /orders/:id/preview/changes`, `POST /orders/:id/pay-balance`, `GET /orders/:id/invoice`.
**Uploads:** `POST /uploads/sign` (signed Cloudinary params or direct validated upload), `POST /uploads/image` (if proxied).
**Account:** `GET/PUT /me`, `CRUD /me/addresses`, `POST/DELETE /me/wishlist/:productId`, `POST /me/recently-viewed`.
**Reviews:** `GET /products/:id/reviews`, `POST /products/:id/reviews`.
**Content:** `GET /blog`, `GET /blog/:slug`, `GET /gallery`, `GET /pages/:slug`.
**Bulk:** `POST /enquiries`.
**Shipping:** `GET /shipping/check?pincode=&productId=`.
**Tracking:** `POST /track/:event` (server-side Meta CAPI, GA events).
**Admin (`/admin`, role-checked):** CRUD for products, categories, sections, banners, coupons, pages, blog, gallery, reviews moderation, enquiries; `GET/PATCH /admin/orders`, `POST /admin/orders/:id/preview`, `POST /admin/orders/:id/status`, `POST /admin/orders/:id/shipment`, `POST /admin/orders/:id/refund`, `GET /admin/customers`, `GET/POST /admin/customers/:id/notes`, `GET /admin/reports/*`, `GET/PUT /admin/settings`, `GET /admin/notifications/logs`.
**Cron (secret header `x-cron-secret`):** `POST /cron/abandoned-carts`, `/cron/review-requests`, `/cron/related-products`, `/cron/health`.
**SEO:** `GET /sitemap.xml`, `GET /robots.txt`, HTML routes with meta injection (Section 12).

---

## 9. Business Rules

### 9.1 Pricing calculation (server only)
1. Unit price = variant/size price (custom) or product price, replaced by the matching **quantity tier** `unitPrice` when `quantity >= minQty` (highest qualifying tier)
2. Add add-on prices
3. Line total = unit price x quantity
4. Subtotal = sum of lines
5. Coupon discount (Section 9.3)
6. Shipping from settings (flat, free above threshold, pincode rules)
7. Tax: prices are GST-inclusive by default (setting). Compute the tax component for the invoice from `gstRate`.
8. Total = subtotal - discount + shipping
9. For custom items: `advanceDue = total x advancePercent`; `balanceDue = total - advanceDue`. Standard items are paid in full.

### 9.2 Order status flow
- **Standard:** `placed -> paid -> processing -> shipped -> delivered`; branches `cancelled`, `refunded`; COD: `placed -> processing -> shipped -> delivered/ rto`
- **Custom:** `placed -> advance_paid -> photos_review -> preview_sent -> (changes_requested -> preview_sent) -> preview_approved -> printing -> finishing -> ready_to_ship -> (balance_pending -> balance_paid) -> shipped -> delivered`; branches `cancelled`, `refunded`
- Every transition is stored in `statusHistory` and triggers notifications (Section 9.6).
- Customers can cancel standard orders before processing and custom orders before preview approval. After the customer approves the preview, cancellation is not allowed (stated in the policy).

### 9.3 Coupons
Validation in this order, each with a specific error message:
1. Code exists and `active`
2. Within `startsAt` and `expiresAt`
3. Cart subtotal >= `minCartValue` ("Add ₹X more to use this coupon")
4. `usedCount < usageLimitTotal`
5. User's past uses < `usageLimitPerUser`
6. `firstOrderOnly` satisfied
7. Eligible items exist (by category/product, excluding sale items if set)
8. Discount = percent (capped by `maxDiscount`) or flat, never more than the eligible subtotal
Increment `usedCount` and record usage only when the order is confirmed (payment verified or COD placed), not when applied. Reverse usage on cancellation if configured.

### 9.4 Reviews
- Only logged-in users, one review per product per delivered order
- `verified = true` when the user has a delivered order containing the product (set by server)
- Photos up to 3, passed through upload checks
- New reviews are `pending` until approved by admin. On approval, recompute `ratingAvg` and `ratingCount`.
- Review request message about 3 days after delivery

### 9.5 Homepage section ranking (when rule is not manual)
- **Trending:** views and orders in the last 7 days
- **Bestsellers:** `salesCount` over the last 90 days
- **Most Loved:** highest `ratingAvg` with `ratingCount >= 3`
- **Popular:** total `viewCount`
- **New:** newest `createdAt`
Manual flags and priority override auto ranking.

### 9.6 Notifications (central `notify(orderId, event)`)
| Event | Customer | Owner |
|---|---|---|
| Order placed | WhatsApp + email | Telegram + email |
| Payment received | WhatsApp + email | Alert |
| Photos received (custom) | Email | Alert with photo links |
| Preview ready | WhatsApp + email (approve link) | |
| Preview approved / changes requested | | Alert |
| Printing started | WhatsApp | |
| Shipped | WhatsApp + email (tracking link) | |
| Delivered | WhatsApp | |
| Review request (3 days after delivery) | WhatsApp or email | |
| Cancelled / refunded | WhatsApp + email | Alert |
| New bulk enquiry | Acknowledgement | Alert |
- Respect opt-ins; log every attempt in `NotificationLog`; retry failures up to 3 times; templates editable in admin.

### 9.7 Abandoned cart
- Cart is abandoned when checkout started (or items added) and idle for 60 minutes and the user has contact details
- Reminders at 1 hour, 24 hours (with an optional single-use coupon), 72 hours; max 3; stop when an order is placed; only to opted-in users; include opt-out
- Triggered by the external scheduler calling `/cron/abandoned-carts`

### 9.8 Bulk enquiry flow
`new -> quoted -> negotiating -> won | lost`. "Won" can create an order with advance payment link. Business buyers' GSTIN goes onto the invoice.

### 9.9 Frequently bought together and recently viewed
- Recently viewed: last 10 product IDs in localStorage, merged into the account on login
- Frequently bought together: nightly job counts product pairs in completed orders, stores top 3; admin `bundleWith` overrides; optional bundle discount

---

## 10. Integrations

- **Google OAuth:** Web client ID; verify ID token on server; create user on first login; fire `sign_up`.
- **Razorpay:** create order server-side, open Checkout on the client, verify signature on the server, and handle the webhook (`payment.captured`, `payment.failed`, `refund.processed`) idempotently. Balance payments via payment links.
- **Cloudinary:** signed uploads with a preset restricted to image formats and 10 MB; folders per type (`products`, `customer-photos`, `reviews`, `banners`, `blog`). Customer photos are private to admin and the order owner (use authenticated or signed delivery URLs).
- **Shipping:** Phase 1 manual (admin enters courier and tracking number). Later: Shiprocket or Delhivery API for pincode serviceability, rates, labels and tracking webhooks.
- **WhatsApp Business Cloud API:** template messages for business-initiated sends; adapter interface `sendWhatsApp({to, template, params})`.
- **Email:** transactional templates (HTML + text), domain authenticated with SPF, DKIM, DMARC.
- **Telegram:** owner alert bot.
- **Instagram:** embed 6 curated posts or use a third-party widget; no hard dependency on tokens.

---

## 11. Tracking and Analytics

- **Meta Pixel** (browser) and **Conversions API** (server), deduplicated with a shared `event_id`
- **GA4** ecommerce events; **Google Ads** conversion tag (Purchase, Lead)
- Optional Google Tag Manager
- Load marketing tags only after consent

| Action | Meta | GA4 | Google Ads |
|---|---|---|---|
| Page view | PageView | page_view | |
| View product | ViewContent | view_item | |
| Search | Search | search | |
| Add to cart | AddToCart | add_to_cart | |
| Wishlist | AddToWishlist | add_to_wishlist | |
| Begin checkout | InitiateCheckout | begin_checkout | |
| Payment info | AddPaymentInfo | add_payment_info | |
| Order confirmed | Purchase | purchase | Purchase conversion |
| Bulk enquiry | Lead | generate_lead | Lead conversion |
| WhatsApp click | Contact | contact | |
| New signup | CompleteRegistration | sign_up | |
| Photo uploaded / preview used | PhotoUploaded / PreviewTried (custom) | custom events | |

Purchase rules: fire once per order (guard with `purchaseTracked`), always send `transaction_id` = order number; prepaid fires after payment verification; custom orders fire on advance payment with full order value; COD fires at confirmation. Server-side Meta events hash email and phone with SHA-256 (phone as digits with country code).

---

## 12. SEO

- Express serves the React build and, for product, category, blog and gallery routes, replaces an `<!--SEO_META-->` placeholder in `index.html` with: title, meta description, canonical, Open Graph (`og:title`, `og:description`, `og:image` absolute URL, `og:url`, `og:type`), Twitter card, and JSON-LD. Escape `<` as `\u003c` inside JSON-LD.
- **Schema:** `Product` (with `Offer`, and `aggregateRating` only from real approved reviews), `BreadcrumbList`, `Organization` and `WebSite` (homepage), `Article` (blog)
- `GET /sitemap.xml` generated from active products, categories, blog posts and gallery (with `lastmod`), cached 1 hour; `robots.txt` disallows `/admin`, `/cart`, `/checkout`, `/account`, `/api` and lists the sitemap
- Clean slugs, one H1 per page, alt text on images
- Images: Cloudinary `f_auto,q_auto,w_<size>`, `srcset` and `sizes`, explicit width and height, lazy loading below the fold, `fetchpriority="high"` on the first banner
- Targets: mobile Lighthouse performance 85+, LCP under 2.5 s, CLS under 0.1
- WhatsApp preview must show the product image, title and price when a product link is shared

---

## 13. Security

- `helmet`, strict CORS (same origin), `express.json({limit: '100kb'})`, `express-mongo-sanitize`, `hpp`
- `app.set('trust proxy', 1)` (Render proxy)
- **Rate limits** (express-rate-limit): `/api` 300 per 15 min per IP; `/api/auth` 20 per 15 min; coupon apply 10 per minute; uploads 20 per hour; enquiries 5 per hour; orders 30 per 15 min; review submit limited per user
- **Validation:** Zod on body, query and params for every route; reject unknown fields
- **Uploads:** verify actual file type from content (magic bytes) not extension; allow JPG, PNG, WebP; max 10 MB, max 4 files; re-encode with `sharp` (strips EXIF and embedded payloads, fixes orientation, caps dimensions); random filenames; store only URLs
- Server-side price, coupon and stock checks; idempotent payment handling; verify Razorpay webhook signature
- Role checks on every admin route; admin allowlist; httpOnly Secure SameSite cookies; CSRF protection for cookie-authenticated state-changing requests (double-submit token or SameSite plus Origin check)
- No secrets in code or logs; no PII in error messages; log with request IDs
- Customer photos private; delete or archive after the retention period stated in the privacy policy

---

## 14. Performance and PWA

- Code splitting per route, lazy-loaded admin bundle, image optimization, HTTP caching headers for static assets, gzip/brotli compression
- **PWA** with `vite-plugin-pwa`: manifest (name Printxyz, theme color navy, standalone), icons 192 and 512 plus maskable, service worker caching static assets and product images (stale-while-revalidate), network-first for APIs, **never cache** cart, checkout, orders or auth; offline fallback page; custom "Install app" prompt after the second visit or first order; iOS "Add to Home Screen" hint; safe update flow so users do not get stuck on an old version

---

## 15. Backups and Operations

- **Nightly MongoDB backup** via GitHub Actions schedule (02:00 IST): `mongodump --archive --gzip`, upload to Cloudflare R2, Backblaze B2 or Google Drive with `rclone`; keep 14 daily and 8 weekly; document and test restore monthly
- Admin dashboard shows "last backup age" and turns red after 36 hours
- **Keep-alive and cron:** external scheduler (cron-job.org or GitHub Actions) pings `/api/health` every 5 to 10 minutes and calls `/cron/*` jobs with `x-cron-secret`
- Health endpoint checks DB connectivity; structured logs; uptime monitoring alert to the owner

---

## 16. Environment Variables (`.env.example`)

```
NODE_ENV=
PORT=
SITE_URL=https://printxyz.in
MONGO_URI=
JWT_SECRET=
COOKIE_DOMAIN=
ADMIN_EMAILS=comma,separated
GOOGLE_CLIENT_ID=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
META_PIXEL_ID=
META_CAPI_TOKEN=
META_API_VERSION=
GA4_MEASUREMENT_ID=
GOOGLE_ADS_ID=
GOOGLE_ADS_PURCHASE_LABEL=
GOOGLE_ADS_LEAD_LABEL=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
EMAIL_PROVIDER=
EMAIL_API_KEY=
EMAIL_FROM=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_ID=
CRON_SECRET=
```

---

## 17. Seed Data (for development and demo)

Create a seed script that adds: 6 categories (Devotional, Toys, Home Decor, Lithophanes, Custom Statues, Name Plates and Keychains), 24 sample products across them (including 3 custom products with 3 sizes each and one product with quantity tiers), 4 banners, 5 sections, 3 coupons (percent with cap, flat with minimum cart value, first-order only), 10 reviews (some with photos), 4 policy pages with placeholder text, 3 blog posts, 12 gallery items, 1 admin user from `ADMIN_EMAILS`. Use placeholder images from a free source and mark them clearly so they are replaced with real photos.

---

## 18. Acceptance Criteria (by phase)

**Phase 1 (foundation and catalog)**
- Google login works; admin allowlist grants admin; non-admins cannot reach `/admin` or admin APIs
- Admin can create categories and products with multiple images; products show on the storefront
- Homepage shows announcement bar, banner carousel, category strip, and product sections; banners editable by admin
- Search suggests products as the user types and returns filtered, sorted results

**Phase 2 (commerce)**
- Product page shows gallery, price, variants, reviews area, Add to Cart and Buy Now
- Cart persists and merges on login; tier prices apply automatically
- Coupons follow every rule in 9.3 with correct messages; usage counts only on confirmed orders
- Razorpay payment succeeds end to end; webhook is idempotent; COD works where enabled
- Totals are always recomputed on the server (tampered client prices are ignored)

**Phase 3 (custom products)**
- Custom product requires size and photo; price follows chosen size; photos upload with type and size checks
- Admin sees photos, uploads preview, customer approves or requests changes from the order page
- Advance and balance payments work; status timeline and notifications fire

**Phase 4 (admin and operations)**
- Admin order, production queue, customers (with notes), enquiries, reviews, settings, and reports work
- Notifications sent and logged; owner alert on new order
- GST invoice PDF generated with sequential numbering and correct tax split

**Phase 5 (growth features)**
- Tracking events appear once each in Meta Test Events and GA4 DebugView; purchase fires once per order
- WhatsApp link preview shows product image, title and price; JSON-LD validates in Rich Results Test; sitemap and robots work
- Live lithophane preview renders lit and unlit views from an uploaded photo
- Reviews with photos and Verified buyer badge, abandoned cart reminders, frequently bought together, recently viewed, bulk enquiry with tier pricing

**Phase 6 (hardening and launch)**
- Rate limits and validation return correct errors; fake image files are rejected
- Backup runs nightly and restore is verified
- PWA installable; Lighthouse mobile performance 85+ on home and product pages
- All policy pages live and linked; checkout acceptance checkbox for custom items works

---

## 19. Master Prompt (paste first)

```
You are a senior full-stack engineer. Build the Printxyz e-commerce website exactly as described in SPEC.md.

Rules:
- Read SPEC.md fully before writing code. Follow it; do not invent features that are not in it.
- Use the stack in Section 2.1 (or 2.2 if I tell you I am using Lovable/Supabase).
- Build in phases. I will give you one phase at a time. Only build the current phase, but design the code so later phases fit without rewrites.
- Money is calculated only on the server. Never trust client prices.
- Validate all input with Zod. Add rate limiting and upload checks as described in Section 13.
- Keep the design clean and professional per Section 3. No emojis in UI copy.
- Provide .env.example, a README with setup and deploy steps for Render, and a seed script (Section 17).
- Write unit tests for pricing, tiers, coupons, GST split, and invoice numbering.
- After each phase, list what you built, how to run it, and which acceptance criteria from Section 18 are met.
- If something in SPEC.md is ambiguous, make the simplest reasonable choice, state it, and continue.
```

---

## 20. Phase Prompts (paste one at a time)

**Phase 1: Foundation and catalog**
```
Build Phase 1 from SPEC.md: project setup (server + client in one repo, Express serving the React build), MongoDB models for User, Category, Product, Section, Banner, Setting, Google login with role allowlist, admin layout with product, category, section, banner and announcement management (Cloudinary image upload), and the public homepage (announcement bar, navbar with live search, banner carousel with side-by-side banners, category strip, product sections), category pages and search results page. Include the seed script. Meet Phase 1 acceptance criteria in Section 18.
```

**Phase 2: Commerce**
```
Build Phase 2 from SPEC.md: product detail page (gallery, variants, quantity tiers, pincode check stub, Add to Cart, Buy Now, sticky mobile bar), cart (guest + logged in, merge on login), coupon system with admin management and all validation rules in 9.3, checkout stepper, Razorpay payment with verification and idempotent webhook, COD option, orders and order history. Server-side pricing per 9.1. Meet Phase 2 acceptance criteria.
```

**Phase 3: Custom products**
```
Build Phase 3 from SPEC.md: custom products with admin-defined sizes and prices, photo upload with validation (Section 13), notes and add-ons, advance payment, custom order status flow, admin preview upload, customer preview approve or request-changes on the order page, balance payment link, and the checkout acceptance checkbox. Meet Phase 3 acceptance criteria.
```

**Phase 4: Admin and operations**
```
Build Phase 4 from SPEC.md: admin orders (filters, detail, photos download, status updates, tracking, refunds), production queue kanban, customers list with profile, notes and tags, enquiries pipeline, reviews moderation, settings, reports, the central notification service (email, WhatsApp adapter, Telegram owner alerts, logs, retries, editable templates), and GST invoice PDF generation with sequential numbering and credit notes. Meet Phase 4 acceptance criteria.
```

**Phase 5: Growth features**
```
Build Phase 5 from SPEC.md: tracking (Meta Pixel + Conversions API with deduplication, GA4 ecommerce events, Google Ads conversions, consent banner), SEO (meta injection, JSON-LD, sitemap, robots, WebP image delivery), live lithophane preview, reviews with photos and verified badge, abandoned cart reminders with cron endpoints, frequently bought together, recently viewed, bulk enquiry form with tier pricing, gallery and blog, Instagram embed and floating WhatsApp button. Meet Phase 5 acceptance criteria.
```

**Phase 6: Hardening and launch**
```
Build Phase 6 from SPEC.md: complete rate limiting, validation audit, upload security review, CSRF protection, PWA (manifest, service worker, install prompt), performance pass to meet Lighthouse targets, nightly backup GitHub Action with restore documentation, health and cron endpoints, policy pages with required wording, error pages, and a deployment guide for Render with a custom domain. Meet Phase 6 acceptance criteria and produce a pre-launch checklist.
```

---

## 21. Out of Scope for Version 1

Multi-vendor marketplace, multiple languages, loyalty points, native mobile apps, live chat, subscription products, international shipping, and wallet or store credit. Design data models so these can be added later.

---

## 22. Owner Tasks (not for the AI builder)

1. Buy `printxyz.in` (and `.com`), claim `@printxyz` handles, search IP India's trademark database (note: XYZprinting is an existing 3D printer brand)
2. Create and verify accounts: Google Cloud (OAuth), Razorpay, Cloudinary, MongoDB Atlas, Render, Meta Business and Pixel, GA4, Google Ads, WhatsApp Business Platform, email provider, Telegram bot
3. Photograph 10 to 20 real products on a clean background in good light
4. Have your CA confirm GST registration, rates and HSN codes; have a professional review policy wording
5. Write product titles, descriptions and prices for the launch catalog
