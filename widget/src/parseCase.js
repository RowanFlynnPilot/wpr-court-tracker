// Case Entry Desk parsing helpers. Pure functions, no DOM, no network -
// unit-tested by scripts/test-parse.mjs.
//
// BOUNDARY NOTE: nothing in this module (or the editor page) ever
// contacts wicourts.gov. An editor pastes text or supplies a file they
// downloaded themselves in their own browser session; parsing happens
// entirely on their machine. The repo's only automated court-system
// channel remains the RSS fetcher (see CLAUDE.md hard boundaries).
//
// These extractors are deliberately heuristic: they prefill a form the
// editor reviews field-by-field, and the Python policy gate re-validates
// everything server-side before anything publishes. A miss costs a few
// keystrokes, never a bad publish.

// UX mirror of pipeline/policy.py - the Python gate is the enforcement
// point; this exists so a blocked case type fails in the form, instantly.
export const ALLOWED_CASE_TYPES = {
  CF: 'Felony',
  CM: 'Misdemeanor',
  CT: 'Criminal traffic',
  CV: 'Civil',
  SC: 'Small claims',
  FO: 'Forfeiture',
  TR: 'Traffic forfeiture',
  PR: 'Probate',
};
export const CRIMINAL_CASE_TYPES = new Set(['CF', 'CM', 'CT']);

const CASE_NO_RE = /\b((?:19|20)\d{2}[A-Z]{2}\d{6})\b/;

export function caseType(caseNo) {
  const m = /^(?:19|20)\d{2}([A-Z]{2})\d{6}$/.exec(caseNo || '');
  return m ? m[1] : null;
}

/** Mirror of pipeline parse_wcca_url: derive {caseNo, countyNo} or throw. */
export function parseWccaUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Paste the full WCCA link, starting with https://');
  }
  if (u.hostname !== 'wcca.wicourts.gov' || !u.pathname.endsWith('caseDetail.html')) {
    throw new Error('The link must be a wcca.wicourts.gov caseDetail.html address.');
  }
  const caseNo = u.searchParams.get('caseNo');
  const countyNo = Number(u.searchParams.get('countyNo'));
  if (!caseNo || !Number.isInteger(countyNo)) {
    throw new Error('The link is missing caseNo or countyNo.');
  }
  return { caseNo, countyNo };
}

function toIsoDate(mdY) {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(mdY.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const DATE_RE = /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/;
const TIME_RE = /(\d{1,2}:\d{2}\s?(?:am|pm|a\.m\.|p\.m\.))/i;
const EVENT_RE =
  /(hearing|conference|pretrial|pre-trial|arraignment|trial|plea|sentencing|appearance|review|status|motion)/i;
// Wisconsin statute citations look like 946.49(1)(a) or 947.01(1).
const STATUTE_RE = /\b\d{3}\.\d+(?:\([0-9a-z]+\))*\b/;

/**
 * Heuristic extraction from pasted/uploaded court-record text.
 * Returns { caseNo, caption, county, filingDate, nextHearing,
 *           hearingCandidates, chargeLines, spotted } - all optional
 * except spotted/arrays. `today` is injectable for tests.
 */
export function extractFromText(raw, today = new Date()) {
  const text = String(raw).replace(/\r/g, '');
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out = { hearingCandidates: [], chargeLines: [], spotted: [] };

  const caseNoM = CASE_NO_RE.exec(text);
  if (caseNoM) {
    out.caseNo = caseNoM[1];
    out.spotted.push(`Case number ${out.caseNo}`);
  }

  const capLine = lines.find(
    (l) => /\svs\.?\s/i.test(l) && l.length < 120 && !/^filed|^charge/i.test(l)
  );
  if (capLine) {
    out.caption = capLine;
    out.spotted.push(`Caption "${capLine}"`);
  }

  const countyM = /\b([A-Z][a-z]+) County\b/.exec(text);
  if (countyM) {
    out.county = countyM[1];
    out.spotted.push(`${countyM[1]} County`);
  }

  const filingM = /filing date\D{0,5}(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i.exec(text);
  if (filingM) {
    out.filingDate = toIsoDate(filingM[1]);
    out.spotted.push(`Filing date ${out.filingDate}`);
  }

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  for (const line of lines) {
    const d = DATE_RE.exec(line);
    if (!d) continue;
    const hasEvent = EVENT_RE.test(line);
    const time = TIME_RE.exec(line);
    if (!hasEvent && !time) continue;
    const iso = toIsoDate(d[1]);
    if (!iso) continue;
    const [y, mo, day] = iso.split('-').map(Number);
    if (new Date(y, mo - 1, day).getTime() < startOfToday) continue;
    const event = EVENT_RE.exec(line);
    const note = [
      event ? titleCaseEvent(line, event) : 'Hearing',
      time ? time[1].toLowerCase().replace(/\s/, ' ') : null,
    ]
      .filter(Boolean)
      .join(', ');
    out.hearingCandidates.push({ date: iso, note, source: line });
  }
  out.hearingCandidates.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (out.hearingCandidates.length) {
    out.nextHearing = out.hearingCandidates[0];
    out.spotted.push(
      `Upcoming: ${out.nextHearing.date} ${out.nextHearing.note}`
    );
  }

  for (const line of lines) {
    if (STATUTE_RE.test(line) && line.length < 160 && !DATE_RE.test(line)) {
      if (!out.chargeLines.includes(line)) out.chargeLines.push(line);
    }
  }
  out.chargeLines = out.chargeLines.slice(0, 8);
  if (out.chargeLines.length) {
    out.spotted.push(`${out.chargeLines.length} charge line(s)`);
  }

  return out;
}

function titleCaseEvent(line, eventMatch) {
  // Take a compact phrase around the event keyword, e.g. "Judicial
  // pretrial" out of "09-30-2026 10:40 am Judicial pretrial Branch 3".
  const words = line.split(' ');
  const idx = words.findIndex((w) => EVENT_RE.test(w));
  if (idx === -1) return eventMatch[1];
  const start = Math.max(0, idx - 2);
  const phrase = words
    .slice(start, idx + 1)
    .filter((w) => !DATE_RE.test(w) && !TIME_RE.test(w) && !/^(am|pm)$/i.test(w))
    .join(' ');
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Build the config/cases.json entry (same shape the intake workflow makes). */
export function buildCaseEntry(f) {
  const { caseNo } = parseWccaUrl(f.wccaUrl);
  const entry = {
    id: `${(f.county || 'marathon').toLowerCase()}-${caseNo.toLowerCase()}`,
    wccaUrl: f.wccaUrl.trim(),
    county: f.county || 'Marathon',
    headline: f.headline.trim(),
    summary: f.summary.trim(),
    tags: f.topics
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
  if (f.hearingDate) {
    entry.nextHearing = { date: f.hearingDate, note: f.hearingNote.trim() };
  }
  const updates = (f.updates || []).filter((u) => u.date && u.note.trim());
  if (updates.length) {
    entry.updates = updates.map((u) => ({ date: u.date, note: u.note.trim() }));
  }
  const links = (f.links || []).filter((l) => l.label.trim() && l.url.trim());
  if (links.length) {
    entry.links = links.map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  }
  return entry;
}

/** Prefilled "Track a case" issue-form URL (ids match track-a-case.yml). */
export function buildIssueUrl(f) {
  const params = new URLSearchParams({
    template: 'track-a-case.yml',
    title: `Track: ${f.headline.trim() || 'case'}`,
    wcca_url: f.wccaUrl.trim(),
    headline: f.headline.trim(),
    summary: f.summary.trim(),
    topics: f.topics.trim(),
  });
  if (f.hearingDate) {
    params.set('hearing_date', f.hearingDate);
    params.set('hearing_note', f.hearingNote.trim());
  }
  const updates = (f.updates || [])
    .filter((u) => u.date && u.note.trim())
    .map((u) => `${u.date} | ${u.note.trim()}`)
    .join('\n');
  if (updates) params.set('updates', updates);
  const links = (f.links || [])
    .filter((l) => l.label.trim() && l.url.trim())
    .map((l) => `${l.label.trim()} | ${l.url.trim()}`)
    .join('\n');
  if (links) params.set('links', links);
  return `https://github.com/RowanFlynnPilot/wpr-court-tracker/issues/new?${params}`;
}
