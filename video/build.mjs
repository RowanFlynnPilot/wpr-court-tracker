// Inlines the capture measurements into the composition.
//   node video/build.mjs   ->  video/walkthrough.html
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const meta = JSON.parse(readFileSync(here('./shots/meta.json'), 'utf8'));
const src = readFileSync(here('./walkthrough.src.html'), 'utf8');
if (!src.includes('/*__META__*/null')) throw new Error('META placeholder not found in walkthrough.src.html');
writeFileSync(here('./walkthrough.html'), src.replace('/*__META__*/null', JSON.stringify(meta)));
console.log('built video/walkthrough.html from captures taken', meta.capturedAt);
