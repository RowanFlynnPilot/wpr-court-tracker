// Tests the hosted backstop's decision (tools/backstop-apps-script.gs)
// outside Google Apps Script, and checks it has not drifted from the
// Windows backstop's thresholds.   node tools/test-backstop.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const here = (f) => new URL(f, import.meta.url);
const gs = readFileSync(here('./backstop-apps-script.gs'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(gs, ctx); // defines decide() and the constants; calls nothing
const { decide } = ctx;

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

const T = 1_800_000_000; // any epoch
const at = (isoWeekday, hh, mm) => ({ isoWeekday, minuteOfDay: hh * 60 + mm, epoch: T });
const minsAgo = (m) => T - m * 60;

test('dispatches only when the last check is 110+ minutes old', () => {
  assert(decide(at(2, 10, 5), minsAgo(109), null).dispatch === false);
  assert(decide(at(2, 10, 5), minsAgo(110), null).dispatch === true);
  assert(decide(at(2, 10, 5), minsAgo(400), null).dispatch === true);
});

test('never dispatches twice within 100 minutes, even with a stale heartbeat', () => {
  assert(decide(at(2, 10, 5), minsAgo(400), minsAgo(99)).dispatch === false);
  assert(decide(at(2, 10, 5), minsAgo(400), minsAgo(100)).dispatch === true);
  assert(decide(at(2, 10, 5), null, minsAgo(30)).dispatch === false);
});

test('an unreadable heartbeat counts as overdue', () => {
  assert(decide(at(3, 9, 0), null, null).dispatch === true);
});

test('weekdays 8 a.m. to 6:10 p.m. Central only', () => {
  const stale = minsAgo(999);
  assert(decide(at(1, 7, 59), stale, null).dispatch === false);
  assert(decide(at(1, 8, 0), stale, null).dispatch === true);
  assert(decide(at(5, 18, 10), stale, null).dispatch === true);
  assert(decide(at(5, 18, 11), stale, null).dispatch === false);
  assert(decide(at(6, 12, 0), stale, null).dispatch === false, 'Saturday');
  assert(decide(at(7, 12, 0), stale, null).dispatch === false, 'Sunday');
});

test('thresholds match the Windows backstop', () => {
  const ps = readFileSync(here('./backstop-check.ps1'), 'utf8');
  const num = (re) => Number(re.exec(ps)[1]);
  assert(num(/\$OverdueMinutes = (\d+)/) === ctx.OVERDUE_MINUTES, 'overdue minutes');
  assert(num(/\$MinGapMinutes = (\d+)/) === ctx.MIN_GAP_MINUTES, 'minimum gap');
  assert(num(/\$minuteOfDay -lt (\d+)/) === ctx.OPENS, 'opening minute');
  assert(num(/\$minuteOfDay -gt (\d+)/) === ctx.CLOSES, 'closing minute');
  // The token never belongs in the file.
  assert(!/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_/.test(gs), 'no token in the script');
});

process.exit(failures ? 1 : 0);
