// Unit tests for the Case Entry Desk parser. Plain asserts, no runner:
//   node scripts/test-parse.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_CASE_TYPES,
  buildCaseEntry,
  buildIssueUrl,
  caseType,
  extractFromText,
  parseWccaUrl,
} from '../src/parseCase.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/case_detail_sample.txt', import.meta.url)),
  'utf8'
);
// Fixed "today" so the fixture's dates stay future-relative forever.
const TODAY = new Date(2026, 6, 11);

test('extracts case number, caption, county, filing date', () => {
  const x = extractFromText(FIXTURE, TODAY);
  assert(x.caseNo === '2026CF000456', `caseNo ${x.caseNo}`);
  assert(
    x.caption.includes('State of Wisconsin vs. Sample D. Party'),
    `caption ${x.caption}`
  );
  assert(x.county === 'Marathon', `county ${x.county}`);
  assert(x.filingDate === '2026-07-01', `filingDate ${x.filingDate}`);
});

test('finds the NEXT future hearing with time and label', () => {
  const x = extractFromText(FIXTURE, TODAY);
  assert(x.nextHearing, 'no nextHearing');
  assert(x.nextHearing.date === '2026-08-03', x.nextHearing.date);
  assert(/preliminary hearing/i.test(x.nextHearing.note), x.nextHearing.note);
  assert(/10:30/.test(x.nextHearing.note), x.nextHearing.note);
  assert(x.hearingCandidates.length === 2, `candidates ${x.hearingCandidates.length}`);
});

test('past court-record events are not offered as hearings', () => {
  const x = extractFromText(FIXTURE, TODAY);
  assert(
    x.hearingCandidates.every((h) => h.date >= '2026-07-11'),
    JSON.stringify(x.hearingCandidates)
  );
});

test('collects statute charge lines, skips dated lines', () => {
  const x = extractFromText(FIXTURE, TODAY);
  assert(x.chargeLines.length === 3, `chargeLines ${x.chargeLines.length}`);
  assert(x.chargeLines[0].includes('946.49(1)(a)'), x.chargeLines[0]);
});

test('empty text extracts nothing but does not throw', () => {
  const x = extractFromText('', TODAY);
  assert(!x.caseNo && !x.nextHearing && x.chargeLines.length === 0);
});

test('parseWccaUrl mirrors the pipeline', () => {
  const { caseNo, countyNo } = parseWccaUrl(
    'https://wcca.wicourts.gov/caseDetail.html?caseNo=2026CF000456&countyNo=37'
  );
  assert(caseNo === '2026CF000456' && countyNo === 37);
  for (const bad of [
    'https://example.com/caseDetail.html?caseNo=1&countyNo=1',
    'not a url',
    'https://wcca.wicourts.gov/other.html?caseNo=1&countyNo=1',
  ]) {
    let threw = false;
    try {
      parseWccaUrl(bad);
    } catch {
      threw = true;
    }
    assert(threw, `must reject ${bad}`);
  }
});

test('case type mirror matches policy allowlist', () => {
  assert(caseType('2026CF000456') === 'CF');
  assert(ALLOWED_CASE_TYPES.CM === 'Misdemeanor');
  assert(!(caseType('2026FA000001') in ALLOWED_CASE_TYPES));
});

const FORM = {
  wccaUrl: 'https://wcca.wicourts.gov/caseDetail.html?caseNo=2026CF000456&countyNo=37',
  county: 'Marathon',
  headline: 'Test headline',
  summary: 'Why we track it.',
  topics: 'Courts, Public safety',
  hearingDate: '2026-08-03',
  hearingNote: 'Preliminary hearing, Branch 2',
  updates: [
    { date: '2026-07-01', note: 'Complaint filed.' },
    { date: '', note: 'ignored - no date' },
  ],
  links: [{ label: 'WPR coverage', url: 'https://wausaupilotandreview.com/x' }],
};

test('buildCaseEntry matches the intake workflow shape', () => {
  const e = buildCaseEntry(FORM);
  assert(e.id === 'marathon-2026cf000456', e.id);
  assert(e.tags.length === 2 && e.tags[1] === 'Public safety');
  assert(e.nextHearing.date === '2026-08-03');
  assert(e.updates.length === 1, 'dateless update must be dropped');
  assert(e.links[0].label === 'WPR coverage');
});

test('buildIssueUrl prefills the track-a-case form fields', () => {
  const url = new URL(buildIssueUrl(FORM));
  assert(url.origin === 'https://github.com');
  const p = url.searchParams;
  assert(p.get('template') === 'track-a-case.yml');
  assert(p.get('wcca_url') === FORM.wccaUrl);
  assert(p.get('topics') === 'Courts, Public safety');
  assert(p.get('updates') === '2026-07-01 | Complaint filed.');
  assert(p.get('hearing_date') === '2026-08-03');
  assert(p.get('mode') === 'New case');
  assert(p.get('status') === 'Watching');
  assert(p.get('title').startsWith('Track:'));
});

test('buildIssueUrl carries update mode and closed status', () => {
  const p = new URL(
    buildIssueUrl({ ...FORM, updateMode: true, status: 'closed' })
  ).searchParams;
  assert(p.get('mode') === 'Update an already-tracked case');
  assert(p.get('status') === 'Closed');
  assert(p.get('title').startsWith('Update:'));
});

test('buildCaseEntry records closed status, omits watching', () => {
  const closed = buildCaseEntry({ ...FORM, status: 'closed' });
  assert(closed.status === 'closed');
  assert(!('status' in buildCaseEntry(FORM)));
});

test('label-less links get a derived label instead of being dropped', () => {
  const form = {
    ...FORM,
    links: [
      { label: '', url: 'https://www.wausaupilotandreview.com/2026/story/' },
      { label: '', url: 'https://wpt.org/coverage' },
      { label: '', url: 'not a url' },
    ],
  };
  const e = buildCaseEntry(form);
  assert(e.links.length === 2, 'unparseable URL row must be dropped');
  assert(e.links[0].label === 'WPR coverage', e.links[0].label);
  assert(e.links[1].label === 'wpt.org', e.links[1].label);
  const p = new URL(buildIssueUrl(form)).searchParams;
  assert(
    p.get('links') ===
      'WPR coverage | https://www.wausaupilotandreview.com/2026/story/\nwpt.org | https://wpt.org/coverage',
    p.get('links')
  );
});

process.exit(failures ? 1 : 0);
