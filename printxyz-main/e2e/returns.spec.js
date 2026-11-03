import { test, expect } from '@playwright/test';
import { adminLogin, adminTab } from './helpers.js';

test('customer requests a return on a delivered order and staff see it', async ({ page, request }) => {
  const { id, token } = await (await request.get('/__e2e/delivered')).json();
  await page.goto(`/track/${token}`);
  const box = page.getByTestId('return-request');
  await expect(box).toBeVisible();
  await box.getByLabel('Reason').selectOption('changed_mind');
  await box.getByPlaceholder(/what went wrong/i).fill('It is too small for my desk, sorry.');
  await box.getByRole('button', { name: 'Request return' }).click();
  await expect(box.getByText(/RET-\d{5}/).first()).toBeVisible();
  await expect(box.getByRole('button', { name: 'Request return' })).toHaveCount(0);      // one open request per order

  await adminLogin(page);
  await adminTab(page, 'Returns');
  const screen = page.getByTestId('returns-screen');
  await expect(screen).toContainText(id);
  await screen.getByRole('button', { name: 'Approve' }).first().click();
  await expect(screen.getByText(/approved/).first()).toBeVisible();
});

test('an order that is not delivered shows no return form', async ({ page, request }) => {
  await page.route('https://checkout.razorpay.com/**', (r) => r.abort());
  const last = await (await request.get('/__e2e/last-order')).json();
  await page.goto(`/track/${last.token}`);
  await expect(page.getByTestId('return-request')).toHaveCount(0);
});
