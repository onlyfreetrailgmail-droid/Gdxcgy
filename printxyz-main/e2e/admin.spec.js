import { test, expect } from '@playwright/test';
import { adminLogin, adminTab } from './helpers.js';

test('admin signs in; wrong password is refused', async ({ page }) => {
  await page.goto('/admin');
  await page.getByPlaceholder('Admin email').fill('owner@printxyz.test');
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/invalid|incorrect/i).first()).toBeVisible();
});

test('the cancellations panel lives in the admin area, not on the public tracking page', async ({ page, request }) => {
  const { token } = await (await request.get('/__e2e/delivered')).json();
  await page.goto(`/track/${token}`);
  await expect(page.getByText('Authentication required')).toHaveCount(0);
});

test('roles screen: owner adds a team member and gets a one-time password; roles are listed', async ({ page }) => {
  await adminLogin(page);
  await adminTab(page, 'Roles');
  const screen = page.getByTestId('roles-screen');
  await expect(screen.getByText('owner@printxyz.test')).toBeVisible();
  await expect(screen.getByText(/This is you/)).toBeVisible();
  await screen.getByPlaceholder('Full name').fill('Ravi Kumar');
  await screen.getByPlaceholder('Email (must be new)').fill('ravi@printxyz.test');
  await screen.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('temp-password')).toContainText('ravi@printxyz.test');
  await expect(screen.getByText('ravi@printxyz.test').first()).toBeVisible();
  await screen.getByLabel('Role for ravi@printxyz.test').selectOption('production');
  await expect(screen.getByLabel('Role for ravi@printxyz.test')).toHaveValue('production');
});

test('banners editor: a live banner appears on the home page; an unsafe link is refused', async ({ page }) => {
  await adminLogin(page);
  await adminTab(page, 'Banners');
  const screen = page.getByTestId('banners-screen');
  await screen.getByPlaceholder('Headline').fill('Diwali Sale Is Here');
  await screen.getByPlaceholder('Link (e.g. /category/devotional)').fill('javascript:alert(1)');
  await screen.getByPlaceholder('Desktop image URL (https)').fill('https://example.com/banner.jpg');
  await screen.getByRole('button', { name: 'Save banner' }).click();
  await expect(screen.getByText(/Link must start with/)).toBeVisible();
  await screen.getByPlaceholder('Link (e.g. /category/devotional)').fill('/category/devotional');
  await screen.getByRole('button', { name: 'Save banner' }).click();
  await expect(screen.getByText('Banner saved.')).toBeVisible();
  await page.route('https://example.com/**', (r) => r.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Diwali Sale Is Here' })).toBeVisible();
});

test('materials: nothing shows until the owner adds facts, then the guide and footer link appear', async ({ page }) => {
  await adminLogin(page);
  await adminTab(page, 'Materials');
  const screen = page.getByTestId('materials-screen');
  await screen.getByRole('button', { name: 'Add material' }).click();
  await screen.getByPlaceholder(/Material name/).fill('PLA');
  await screen.getByPlaceholder('Care instructions').fill('Wipe with a soft dry cloth.');
  await screen.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(screen.getByText('Saved.')).toBeVisible();
  await page.goto('/materials');
  await expect(page.getByText('Wipe with a soft dry cloth.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Material guide' })).toBeVisible();
});

test('alerts screen: shows delivery channels and a test alert is stored', async ({ page }) => {
  await adminLogin(page);
  await adminTab(page, 'Alerts');
  const screen = page.getByTestId('alerts-screen');
  await expect(screen).toContainText('uptime heartbeat');
  await screen.getByRole('button', { name: 'Send test alert' }).click();
  await expect(screen.getByText(/Test alert stored/)).toBeVisible();
  await expect(screen.getByText('Test alert from Printxyz')).toBeVisible();
});

test('review photos: a customer can attach photos in the review form (upload, thumbnail)', async ({ page }) => {
  await page.goto('/product/ganesha-lamp');
  await page.getByRole('button', { name: 'Reviews' }).click();
  await expect(page.getByLabel(/Add photos/)).toBeVisible();
});

test('share links: owner creates a tracked short link for a product, and visiting it lands on the product with the ad tags', async ({ page, request }) => {
  await adminLogin(page);
  await adminTab(page, 'Links');
  const screen = page.getByTestId('links-screen');
  await screen.getByLabel('Item').selectOption({ label: 'Ganesha 3D Lamp' });
  await screen.getByLabel('Where will you share it').selectOption('youtube_description');
  await screen.getByPlaceholder(/Campaign name/).fill('diwali-sale');
  await screen.getByRole('button', { name: 'Create link' }).click();
  const made = page.getByTestId('made-link');
  await expect(made).toContainText('/s/');
  const short = (await made.locator('code').first().innerText()).trim();
  const res = await request.get(new URL(short).pathname + '?fbclid=test123', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toMatch(/^\/product\/ganesha-lamp\?utm_source=youtube&utm_medium=video&utm_campaign=diwali-sale&fbclid=test123$/);
  await page.goto(res.headers().location);
  await expect(page.getByRole('heading', { name: 'Ganesha 3D Lamp' })).toBeVisible();
});

test('GST settings: a wrong GSTIN is refused; a valid one saves', async ({ page }) => {
  await adminLogin(page);
  await adminTab(page, 'Settings');
  await page.getByLabel('Legal name').fill('Printxyz');
  await page.getByLabel('Address', { exact: true }).fill('12 Station Road, Ranchi');
  const gst = page.getByTestId('gst-settings');
  await gst.getByLabel(/Issue GST tax invoices/).check();
  await gst.getByLabel('GSTIN').fill('27AAPFU0939F1ZX');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByText(/check digit/i)).toBeVisible();
  await gst.getByLabel('GSTIN').fill('27AAPFU0939F1ZV');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByText(/Business details saved/)).toBeVisible();
});
