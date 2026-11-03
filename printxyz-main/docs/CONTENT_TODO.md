# Content only the owner can supply

The About, FAQ, Size guide and Care pages state only facts that exist in the code (online payment only, 2 free design revisions, design preview before printing, 5 to 10 working days after approval, free shipping above Rs 1,499, photos deleted 90 days after an order finishes). Please check them and fill the gaps below. Nothing here has been invented on your behalf.

- [ ] Confirm the 5 to 10 working day estimate and the free shipping threshold still match your policy.
- [ ] Business location. The pages do not say where Printxyz is based. Add it to About and enable LocalBusiness markup and a Patna landing page only if it is a real, public business address.
- [ ] Materials. Name the filament and finish for each product (for example PLA) on product pages, then add a material section to the Care guide.
- [ ] Real sizes. The Size guide explains how to read sizes but has no size chart. Product pages should list the real dimensions and price per size for each product.
- [ ] Care advice. The Care guide gives general tips for 3D-printed plastic. Check them against your actual materials, especially heat limits.
- [ ] Photos. Replace the seeded Unsplash images with your own product photos (also used in social previews and structured data).
- [x] Reviews: signed-in customers whose order was delivered can review; staff approve each one; star ratings and AggregateRating markup appear only after approved reviews exist. The old invented ratings, review counts, testimonials and product specs ("PLA + resin", "480 g", "3-5 days") were removed. Add real material, size and weight facts per product, then show them on the product page.
- [ ] Blog posts on the home page are placeholder content from the original template. Replace or remove them.
- [ ] Bulk-orders page uses the same enquiry form as Contact. Add your own copy (minimum quantity, lead time, pricing approach) when you have decided it.
- [ ] Legal pages (privacy, terms, shipping, refund) still need professional review. The privacy page now mentions marketing cookies and the Meta Pixel.

## Material guide (needs your facts)
Open **Admin > Materials** and write, for each material you actually use: name, finish, best for, care, limits (heat, outdoor use).
The code does not pre-fill anything, so nothing untrue can be published. The public page `/materials` and the footer link
appear automatically once you save at least one material.

## Policies to keep in sync with the code
* Returns: `RETURN_WINDOW_DAYS` (default 7) and the rule that personalised items are returnable only when damaged, defective or wrong. Match your Refund policy page.
* Part payment: `ADVANCE_PERCENT` (default 50). Say on your Terms/Refund page whether the advance is refundable when you cancel after printing starts.
