import { expect } from '@playwright/test';

// Fake Razorpay Checkout: signs the payment the way Razorpay does (HMAC-SHA256 of "order|payment") so the server's
// real signature verification runs. The test key secret matches server/scripts/e2e-server.js.
export const stubRazorpay = async (page, { fail = false } = {}) => {
  await page.route('https://checkout.razorpay.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    window.Razorpay = function (opts) {
      this.on = function () {};
      this.open = async function () {
        if (${fail}) return;
        const pay = 'pay_' + Math.random().toString(36).slice(2, 12);
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('e2e_secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(opts.order_id + '|' + pay));
        const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
        window.__rzpAmount = opts.amount;
        opts.handler({ razorpay_order_id: opts.order_id, razorpay_payment_id: pay, razorpay_signature: hex });
      };
    };` }));
};

export const acceptCookies = async (page) => { await page.getByRole('button', { name: 'Accept all' }).click(); };

export const dismissCookies = async (page) => { const b = page.getByRole('button', { name: 'Essential only' }); if (await b.isVisible().catch(() => false)) await b.click(); };

export const fillCheckout = async (page) => {
  await dismissCookies(page);
  const form = page.locator('form').filter({ hasText: 'Street address' });
  await form.getByLabel('First name', { exact: false }).first().fill('Asha');
  await form.getByLabel('Last name', { exact: false }).first().fill('Rao');
  await form.getByLabel('Phone').fill('9876543210');
  await form.getByLabel('Email').fill('asha@example.com');
  await form.getByLabel('Street address').fill('12 MG Road');
  await form.getByLabel('City').fill('Patna');
  await form.getByLabel('State').selectOption('Bihar');
  await form.getByLabel(/Pincode|PIN/i).first().fill('800001');
  await page.getByLabel(/I agree to the order terms/).check();
};

// Smallest valid JPEG header; the server sniffs magic bytes, and the e2e Cloudinary is fake.
export const JPEG = { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]) };

export const adminLogin = async (page) => {
  await page.goto('/admin');
  await page.getByPlaceholder('Admin email').fill('owner@printxyz.test');
  await page.getByPlaceholder('Password').fill('Owner#Pass12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard overview' })).toBeVisible();
};
// The sticky mobile header can cover a button Playwright scrolled to the very top, so centre it first.
export const adminTab = async (page, name) => { const tab = page.getByRole('tab', { name, exact: true }); await tab.evaluate((el) => el.scrollIntoView({ block: 'center' })); await tab.click(); };
