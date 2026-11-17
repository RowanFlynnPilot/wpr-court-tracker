// Captures the live tracker's screens for the walkthrough video, at 2x,
// plus a JSON of where the parts the camera and rings point at sit.
//
//   node video/capture.mjs            (from the repo root)
//
// Re-run whenever the tracker's content changes, then build and render
// again (see video/README.md). Uses the widget's Playwright install.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../widget/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = 'https://rowanflynnpilot.github.io/wpr-court-tracker/';
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// Rects in CSS px relative to the page (full-page shots) or to `within`.
const rects = (page, map, within = null) =>
  page.evaluate(
    ({ map, within }) => {
      const o = within ? document.querySelector(within).getBoundingClientRect() : { left: 0, top: -window.scrollY };
      const out = {};
      for (const [key, sel] of Object.entries(map)) {
        const els = [...document.querySelectorAll(sel)];
        if (!els.length) continue;
        const rs = els.map((e) => e.getBoundingClientRect());
        const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
        const r = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom));
        out[key] = { x: Math.round(l - o.left), y: Math.round(t - o.top), w: Math.round(r - l), h: Math.round(b - t) };
      }
      return out;
    },
    { map, within }
  );

const size = (page) =>
  page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));

const browser = await chromium.launch();
const open = async (path, width, ready) => {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  for (let i = 0; i < 6; i++) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
    try { await page.waitForSelector(ready, { timeout: 20000 }); break; } catch { await page.waitForTimeout(8000); }
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // fonts settle; timeline marks finish drawing in
  return page;
};

const meta = { capturedAt: new Date().toISOString() };

{
  const page = await open('', 1280, '.tl');
  meta.tracker = { ...(await size(page)), ...(await rects(page, { glance: '.glance', card: '.folder:nth-of-type(1)', tl: '.folder:nth-of-type(1) .tl', statline: '.statline' })) };
  await page.screenshot({ path: `${OUT}tracker.png`, fullPage: true });

  // The first case file, opened.
  await page.locator('.folder').first().locator('.toggle-head').click();
  await page.waitForTimeout(800); // the file's unfold transition
  const box = await page.locator('.folder').first().boundingBox();
  meta.file = {
    w: Math.round(box.width),
    h: Math.round(box.height),
    ...(await rects(
      page,
      { court: '.folder:nth-of-type(1) .ledger-court', wpr: '.folder:nth-of-type(1) .ledger-wpr', presumption: '.folder:nth-of-type(1) .presumption', tl: '.folder:nth-of-type(1) .tl', ledger: '.folder:nth-of-type(1) .ledger' },
      '.folder:nth-of-type(1)'
    )),
  };
  await page.locator('.folder').first().screenshot({ path: `${OUT}file.png` });
  await page.close();
}

{
  const page = await open('about.html', 920, '.record');
  await page.waitForTimeout(800); // live tiles fill in
  meta.about = { ...(await size(page)), ...(await rects(page, { source: 'main section:nth-of-type(2)', fairness: '.rails', record: '.record' })) };
  await page.screenshot({ path: `${OUT}about.png`, fullPage: true });
  await page.close();
}

{
  const page = await open('editor.html', 1280, '.picker-btn');
  await page.locator('.picker-btn').click();
  await page.locator('.picker-item').nth(1).click();
  await page.waitForTimeout(600);
  meta.desk = { ...(await size(page)), ...(await rects(page, { grid: '.desk-grid', preview: '.desk-preview', actions: '.desk-actions' })) };
  await page.screenshot({ path: `${OUT}desk.png`, fullPage: true });
  await page.close();
}

{
  const page = await open('preview.html', 1280, '.compare');
  meta.preview = {
    ...(await size(page)),
    ...(await rects(page, {
      notice: '.notice', compare: '.compare', before: '.col-before', after: '.col-after',
      beforeLedger: '.col-before .ledger', afterLedger: '.col-after .ledger', charges: '.charges',
    })),
  };
  await page.screenshot({ path: `${OUT}preview.png`, fullPage: true });
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}meta.json`, JSON.stringify(meta, null, 2));
console.log('captured', Object.keys(meta).filter((k) => k !== 'capturedAt').join(', '));
console.log(JSON.stringify(meta));
