import { test, expect } from '@playwright/test';
import { acceptCookies } from './helpers.js';

test('Meta Pixel does not load before consent, loads after "Accept all", and the CSP allows Meta', async ({ page }) => {
  const metaRequests = []; const cspErrors = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  await page.route('https://connect.facebook.net/**', (route) => { metaRequests.push(route.request().url()); return route.fulfill({ contentType: 'text/javascript', body: 'window.__pixelLoaded = true;' }); });
  await page.route('https://www.facebook.com/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(metaRequests).toHaveLength(0);                                        // nothing before consent
  await acceptCookies(page);
  await expect.poll(() => metaRequests.length).toBeGreaterThan(0);              // loaded after consent
  expect(cspErrors).toEqual([]);                                                // CSP did not block it
  await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toHaveCount(0);
});

test('"Essential only" keeps the shop usable and never loads Meta', async ({ page }) => {
  const meta = [];
  await page.route('https://connect.facebook.net/**', (route) => { meta.push(1); return route.abort(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Essential only' }).click();
  await page.goto('/product/ganesha-lamp');
  await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeVisible();
  expect(meta).toHaveLength(0);
});

test('private pages never fire pixel events even after consent', async ({ page }) => {
  await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.fbqCalls=[];window.fbq=function(){window.fbqCalls.push([].slice.call(arguments).join(":"))};window.fbq.loaded=true;' }));
  await page.goto('/');
  await acceptCookies(page);
  await page.goto('/track/' + 'a'.repeat(48));
  const calls = await page.evaluate(() => window.fbqCalls || []);
  expect(calls.filter((c) => c.startsWith('track:PageView') && location.pathname.startsWith('/track'))).toEqual([]);
});
