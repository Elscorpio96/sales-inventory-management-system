/**
 * Regenerate README screenshots against a freshly seeded in-memory database.
 *   VITE_DEMO=1 npm run build -w web && npm run screenshots
 * Set CHROME_PATH to use an installed Chrome instead of Playwright's download.
 */
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { openDb } from '../server/src/db/index.js';
import { seed, DEMO_USERS } from '../server/src/db/seed.js';
import { buildApp } from '../server/src/app.js';

const root = join(import.meta.dirname, '..');
const out = join(root, 'docs', 'screenshots');
const db = openDb(':memory:');
seed(db);
const app = await buildApp(db, {
  env: 'test', port: 0, host: '127.0.0.1', dbPath: ':memory:', jwtSecret: 'screenshot-secret-screenshot-secret!!', sessionHours: 1,
  businessName: 'Demo Supermarket, Bauchi', secureCookies: false, trustProxy: false, webDist: join(root, 'web', 'dist'),
});
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });

async function signIn(page: Page, who: keyof typeof DEMO_USERS) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(DEMO_USERS[who].email);
  await page.getByLabel('Password').fill(DEMO_USERS[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.side');
}
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(2000); // let charts finish animating
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
  console.log('saved', name);
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await shot(page, '01-login');

  await signIn(page, 'owner');
  await shot(page, '02-dashboard', true);
  await page.goto(`${base}/products`);
  await shot(page, '04-products');
  await page.goto(`${base}/stock`);
  await page.selectOption('select >> nth=1', { index: 3 });
  await page.fill('.lines input >> nth=0', '24');
  await shot(page, '05-stock');
  await page.goto(`${base}/sales`);
  await page.locator('tr.clickable').first().click();
  await page.waitForSelector('.receipt');
  await shot(page, '06-sale-detail');

  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cp = await c.newPage();
  await signIn(cp, 'cashier');
  await cp.locator('.tile', { hasText: 'Spaghetti' }).click();
  await cp.locator('.tile', { hasText: 'Spaghetti' }).click();
  await cp.locator('.tile', { hasText: 'Evaporated Milk' }).click();
  await cp.locator('.tile', { hasText: 'Soft Drink' }).click();
  await cp.locator('.tile', { hasText: 'Parboiled Rice' }).click();
  await cp.getByLabel('Amount received (₦)').fill('15000');
  await shot(cp, '03-pos');
  await cp.getByRole('button', { name: /^Charge/ }).click();
  await cp.waitForSelector('.receipt');
  await shot(cp, '07-receipt');

  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mp = await m.newPage();
  await signIn(mp, 'manager');
  await shot(mp, '08-mobile-dashboard');

  const api = await ctx.newPage();
  await api.goto(`${base}/api/docs`);
  await api.waitForSelector('.opblock');
  await shot(api, '09-api-docs');
} finally {
  await browser.close();
  await app.close();
}
