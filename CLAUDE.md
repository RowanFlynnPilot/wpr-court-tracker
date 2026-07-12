# wpr-court-tracker

Marathon County court case tracker for Wausau Pilot & Review. Curated
watchlist of cases of public interest, with activity monitored against the
official court record and a reader request channel.

## Architecture

Python fetcher (stdlib only) -> GitHub Actions cron -> static JSON ->
React/Vite -> GitHub Pages -> WordPress iframe. Standard WPR pattern.

```
config/cases.json      editorial watchlist (newsroom-owned, hand-curated)
pipeline/policy.py     editorial display policy, enforced in code
pipeline/fetch.py      polls official WCCA per-case RSS, diffs, writes data/
pipeline/issue_case.py "Track a case" issue form -> validated config entry
data/feed.json         everything the widget renders (committed)
data/changes.json      cases with new activity this run (per-run alerts)
data/tracker.xml       reader-facing RSS of case activity (stable guids)
data/hearings.ics      subscribable hearing calendar (all-day by design)
widget/                React/Vite app; vite publicDir = ../data
widget/src/MiniDigest.jsx + mini-digest.html   newsletter digest card
widget/src/CaseDesk.jsx + editor.html          Case Entry Desk (newsroom)
widget/src/parseCase.js  desk parsing helpers (scripts/test-parse.mjs)
widget/scripts/render-cards.mjs   Playwright -> digest.png + og-card.png
tests/                 parser + policy tests vs a REAL captured feed fixture
```

Case intake: the "Track a case" issue form is validated instantly through
issue_case.py (same policy gate). Publishing is two-lane: issues from the
NEWSROOM (author_association OWNER/MEMBER/COLLABORATOR) auto-publish on
the twice-daily sweep in track-case.yml (12:45/20:45 UTC; closing the
issue first cancels; workflow_dispatch publishes now) — filing the issue
IS the sign-off when the publisher files it. Issues from anyone else
become a sign-off PR a human must merge; auto-publish must NEVER be
extended to outside authors on this public repo. Issue bodies are
untrusted input: env/stdin-passed, never shell-interpolated.

The Case Entry Desk (/editor.html) prefills that issue form: the editor
pastes the case page text or uploads their own saved copy (print-to-PDF
via pdf.js, .html, .txt) and everything parses IN THE BROWSER —
compatible with hard boundary #1 because a human obtained the record in
their own session and the page makes zero requests to wicourts.gov.
parseCase.js mirrors the policy allowlist for instant UX feedback; the
Python gate remains the enforcement point. Entry file is desk-entry.jsx
(NOT editor.jsx: Editor.jsx/editor.jsx collide on Windows's
case-insensitive filesystem and the casing that lands in git breaks the
case-sensitive Linux CI build).

## Verified facts this repo is built on (2026-07-11)

- Per-case RSS feed URL:
  `https://wcca.wicourts.gov/caseSearchResults.do?rss=1&countyNo={N}&caseNo={CASE}`
  Discovered from WCCA's own app bundle; verified live. No captcha. RSS is
  the court system's officially sanctioned "data extraction option."
- **The feed is a change PING, not a docket transcript.** Each item =
  official caption + case link + last-updated pubDate + guid embedding the
  update timestamp. New guid means new court activity. The feed does NOT
  carry docket entry text, charges, or hearing dates.
- An empty feed means "no recent activity," NOT "case not found."
- Marathon County is countyNo 37.
- Guid format observed: `37-2026CF000100-Some(2026-07-10T18:46:30.517Z)`.

## Hard boundaries — do not cross

1. **Never scrape the WCCA web UI or its caseDetail JSON.** It is
   captcha-protected and its terms prohibit automated access. The RSS
   endpoint is the only automated channel this repo touches. There is no
   fallback and there will be no fallback.
2. Full docket/charge/hearing data is **Phase 2**: CCAP's paid REST
   subscription ($12,500/yr, Rev. 08/2022 agreement; nonprofit
   discount/pilot outreach in progress; DDRP grant is the funding lane).
   When it lands, it replaces the data layer only — config, policy, and
   widget stay.
3. **policy.py is the editorial gate.** Case-type allowlist (no family,
   juvenile, guardianship, mental health). Criminal cases always display
   the presumption-of-innocence note. Changing policy requires publisher
   sign-off.
4. Cases are added by pasting the WCCA caseDetail URL into `wccaUrl`.
   caseNo/countyNo/caseType all derive from it. One source of truth; no
   hand-transcribed identifiers.
5. `placeholder: true` cases are never fetched and render with a SAMPLE
   flag. Same convention as wpr-happy-hour.
6. Hearing dates and case narratives are **editorial fields** entered by
   reporters (`nextHearing`, `updates`). The pipeline observes only that
   the record changed; reporters supply what changed. Do not fake docket
   text from ping data.

## Design

Matched to wausaupilotandreview.com (WordPress Newspack theme) as of
2026-07-11: white shell with newspaper-black #111 chrome, Oswald display
(the wordmark face), Merriweather body, Courier Prime for case
numbers/dates/stamps (kin to the typewriter badge). Teal #3A867C is the
typewriter in WPR's circular badge logo — masthead asset at
widget/src/assets/wpr-badge.png, sourced from the site's
wp-content/uploads/2024/04/cropped-Wausau-Pilot-Transparent.png. Masthead:
badge + Oswald title over a thick-thin newspaper rule; footer carries the
"More News. Less Fluff. All Local." tagline. Signature (unchanged): manila
case-file cards with die-cut folder tabs (typed Courier labels) and a red
rubber-stamp "NEW ACTIVITY" mark when the record changed within 7 days —
kin to the Community Board's stamp aesthetic. Ledger rows: teal bar = WPR
editorial entry, red bar = observed court-record update linking to WCCA.

## Commands (local, PowerShell)

```
python tests/test_pipeline.py ; python pipeline/fetch.py
cd widget ; npm install ; npm run dev
```

## Cron

Weekdays every 2 hours, 8 a.m.-6 p.m. Central. Commit messages list case
numbers with new activity, so watching the repo is a newsroom alert
channel. Every deploy also re-renders the newsletter digest
(/digest.png at the Pages root — activity last 7 days + upcoming
hearings, derived from feed.json; Playwright element screenshot, same
pattern as wpr-brewers-tracker, never committed).

## Operational notes (2026-07-11)

- The workflow bot commits to `main` on every run with new data. ALWAYS
  `git pull --rebase` before editing locally (pull.rebase=true is set on
  Rowan's machine; set it on any new clone).
- Repo history: branch renamed master -> main on day one. The
  github-pages environment's deployment branch policy is pinned to
  `main`. If deploys ever reject with "protection rules," check
  Settings > Environments > github-pages first.
- This repo is PUBLIC. Anything committed to config/cases.json is
  published within minutes. Editorial sign-off (Shereen) happens BEFORE
  the commit, never after.
- 2026-07-11 evening: site-brand reskin, auto-height embed, per-case
  permalinks, closed-files drawer, track-a-case issue intake (+ Case
  Entry Desk), and the digest PNG all landed. The digest derives "last
  7 days" from feed.json (changes.json stays per-run).
- CAUTION on intake testing: an owner/collaborator's track-a-case issue
  AUTO-PUBLISHES at the next sweep. To test the intake end-to-end, use a
  real case you actually want tracked, or close the issue before
  12:45/20:45 UTC. The publish sweep itself can be proven harmlessly via
  workflow_dispatch with no open track-a-case issues (clean no-op).
- Shereen needs to be added as a repo collaborator (Settings >
  Collaborators — Rowan does this) for her desk submissions to
  auto-publish; until then her issues take the PR path.
- Red-run semantics: a FAILED "Update court data and deploy" run has
  usually still DEPLOYED. The fetch step is continue-on-error; if WCCA
  is unreachable the site ships with last-good data and the final
  "Propagate fetch failure" step marks the run red on purpose.
- WCCA throttles/slows for Actions runners some evenings (3 of 5 runs
  on launch night; always instant from local). Hardened same night:
  TIMEOUT_S 30->60, two retries with 5s/25s escalating backoff
  (unit-tested with a faked network). If reds STILL persist, the answer
  is more patience or fewer polls — never a fallback beyond the RSS
  endpoint.
