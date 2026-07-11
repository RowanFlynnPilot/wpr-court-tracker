// Renders the digest card to a PNG for email newsletters (same pattern as
// wpr-brewers-tracker): email clients strip <iframe> and can't run JS, so
// pre-render the card to an image at deploy time.
//
//   node scripts/render-digest.mjs [pageUrl] [outPath]
//
// Defaults assume `npm run preview -- --port 4173` is serving the build.
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:4173/mini-digest.html';
const url = base + (base.includes('?') ? '&' : '?') + 'image=1';
const out = process.argv[3] || 'dist/digest.png';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { width: 480, height: 1200 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // digest-ready appears once feed.json has rendered; a failed feed shows
  // .digest-error instead, and this times out loudly rather than shipping
  // a broken image.
  await page.waitForSelector('.mini-card.digest-ready', { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  await page.locator('.mini-card').screenshot({ path: out });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
