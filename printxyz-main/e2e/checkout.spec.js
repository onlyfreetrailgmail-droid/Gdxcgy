import { test, expect } from '@playwright/test';
import { stubRazorpay, fillCheckout, JPEG } from './helpers.js';

const orderState = async (request) => { const last = await (await request.get('/__e2e/last-order')).json(); return { ...last, ...(await (await request.get(`/__e2e/order/${last.id}`)).json()) }; };

test('guest buys a plain product: cart, checkout, signed payment, confirmed order', async ({ page, request }) => {
  await stubRazorpay(page);
  await page.goto('/product/name-plate');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await page.goto('/cart');
  await expect(page.getByText('Desk Name Plate')).toBeVisible();
  await page.goto('/checkout');
  await expect(page.getByTestId('plan-choice')).toHaveCount(0);                  // plain items cannot be part-paid
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay securely with Razorpay/ }).click();
  await expect(page.getByText(/Payment received\. Order PX-/)).toBeVisible();
  const o = await orderState(request);
  expect(o.paymentStatus).toBe('paid');
});

test('a failed signature is rejected and the order stays unpaid', async ({ page, request }) => {
  await page.route('https://checkout.razorpay.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `window.Razorpay=function(o){this.on=function(){};this.open=function(){o.handler({razorpay_order_id:o.order_id,razorpay_payment_id:'pay_fake',razorpay_signature:'0'.repeat(64)})}}` }));
  await page.goto('/product/name-plate');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await page.goto('/checkout');
  await fillCheckout(page);
  await page.getByRole('button', { name: /Pay securely with Razorpay/ }).click();
  await expect(page.getByText(/verification failed/i)).toBeVisible();
  expect((await orderState(request)).paymentStatus).toBe('pending');
});

test('custom product needs a photo; part payment is offered, advance is charged, balance is paid from the tracking page', async ({ page, request }) => {
  await stubRazorpay(page);
  await page.goto('/product/photo-lithophane');
  const add = page.getByRole('button', { name: 'Add to Cart' });
  await expect(add).toBeDisabled();                                              // photo required
  await page.getByLabel('Upload photos').setInputFiles(JPEG);
  await expect(add).toBeEnabled();
  await add.click();
  await page.goto('/cart');
  await expect(page.getByText(/Personalised: 1 photo/)).toBeVisible();
  await page.goto('/checkout');
  await expect(page.getByTestId('plan-choice')).toBeVisible();
  await fillCheckout(page);
  await page.getByLabel(/advance now/).check();
  await page.getByRole('button', { name: /advance securely/ }).click();
  await expect(page.getByText(/Payment received\. Order PX-/)).toBeVisible();
  expect(await page.evaluate(() => window.__rzpAmount)).toBe(124950);            // 50% of ₹2,499 in paise, chosen by the server
  let o = await orderState(request);
  expect(o.paymentStatus).toBe('advance_paid'); expect(o.paidAmountPaise).toBe(124950);

  await page.goto(`/track/${o.token}`);
  const plan = page.getByTestId('payment-plan');
  await expect(plan).toContainText('Balance');
  await plan.getByRole('button', { name: /Pay balance/ }).click();
  await expect.poll(async () => (await orderState(request)).paymentStatus).toBe('paid');
  expect(await page.evaluate(() => window.__rzpAmount)).toBe(124950);
  await expect(page.getByRole('link', { name: 'View invoice' })).toBeVisible();
});
