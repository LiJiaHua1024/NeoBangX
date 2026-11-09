import { chromium } from 'playwright';
import path from 'node:path';

const root = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const prefix = process.argv[2] || 'slide';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(root, 'out', 'preview.html'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const slides = page.locator('.slide');
const count = await slides.count();
for (let i = 0; i < count; i++) {
  await slides.nth(i).screenshot({ path: path.join(root, 'out', `${prefix}-${String(i + 1).padStart(2, '0')}.png`) });
}
console.log('shot', count);
await browser.close();
