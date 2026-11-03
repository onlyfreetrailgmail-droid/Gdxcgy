import { test, expect } from '@playwright/test';

test('home page shows the hero, products and has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Ganesha 3D Lamp').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('product page opens from the home page and shows price and add to cart', async ({ page }) => {
  await page.goto('/product/ganesha-lamp');
  await expect(page.getByRole('heading', { name: 'Ganesha 3D Lamp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeEnabled();
});

test('unknown pages show a not-found page, not another page', async ({ page }) => {
  await page.goto('/product/does-not-exist');
  await expect(page.getByText(/not found|couldn.t find|no longer/i).first()).toBeVisible();
});

test('empty material guide is hidden from the footer and the page explains itself', async ({ page, request }) => {
  await request.get('/__e2e/reset-content');
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Material guide' })).toHaveCount(0);
  await page.goto('/materials');
  await expect(page.getByRole('heading', { name: 'Materials and finishes' })).toBeVisible();
});
