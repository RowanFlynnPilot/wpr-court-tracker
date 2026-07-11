// Renders the deploy-time card images (same pattern as
// wpr-brewers-tracker): email clients strip <iframe> and social networks
// want a fixed og:image, so both are pre-rendered PNGs.
//
//   node scripts/render-cards.mjs [baseUrl] [outDir]
//
// Defaults assume `npm run preview -- --port 4173` is serving the build.
import { chromium } from 'playwright';

const base = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const outDir = (process.argv[3] || 'dist').replace(/\/$/, '');

const CARDS = [
  {
    page: 'mini-digest.html?image=1',
    ready: '.mini-card.digest-ready', // set once feed.json rendered; a
    selector: '.mini-card',           // failed feed times out loudly
    out: 'digest.png',
    viewport: { width: 480, height: 1200 },
    deviceScaleFactor: 2,
  },
  {
    page: 'og-card.html',
    ready: '.og-card.og-ready',
    selector: '.og-card',
    out: 'og-card.png',
    viewport: { width: 1240, height: 700 },
    deviceScaleFactor: 1, // og:image is exactly 1200x630
  },
];

const browser = await chromium.launch();
try {
  for (const card of CARDS) {
    const page = await browser.newPage({
      deviceScaleFactor: card.deviceScaleFactor,
      viewport: card.viewport,
      locale: 'en-US',
      timezoneId: 'America/Chicago',
    });
    await page.goto(`${base}/${card.page}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector(card.ready, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await page.locator(card.selector).screenshot({ path: `${outDir}/${card.out}` });
    console.log(`Wrote ${outDir}/${card.out}`);
    await page.close();
  }
} finally {
  await browser.close();
}
