# WPR Court Tracker

Marathon County court cases of public interest, tracked by the Wausau
Pilot & Review newsroom. Live widget on GitHub Pages, embedded in
WordPress via iframe.

Data comes from the Wisconsin court system's **official per-case RSS
feeds** — the sanctioned automated channel. The feed signals *that* a case
record changed; WPR reporters supply *what* changed. See CLAUDE.md for
architecture and hard boundaries.

## Adding a case (reporters)

1. Find the case on https://wcca.wicourts.gov and open its case detail page.
2. Copy the browser URL (it contains `caseDetail.html?caseNo=...&countyNo=...`).
3. Add an entry to `config/cases.json`:

```json
{
  "id": "short-slug",
  "wccaUrl": "<paste the URL here>",
  "county": "Marathon",
  "headline": "Plain-English headline",
  "summary": "Why WPR is tracking this case.",
  "tags": ["Public safety"],
  "nextHearing": { "date": "2026-08-03", "note": "Preliminary hearing, Branch 2" },
  "updates": [ { "date": "2026-07-01", "note": "Complaint filed." } ],
  "links": [ { "label": "WPR coverage", "url": "https://..." } ]
}
```

`nextHearing`, `updates`, and `links` are optional. Everything else is
required. Family, juvenile, guardianship, and mental health cases are
blocked by policy and the pipeline will refuse to run — this is
intentional (see `pipeline/policy.py`).

4. Commit to `main`. The workflow validates, fetches, and redeploys.

## Local development (PowerShell)

```
python tests/test_pipeline.py ; python pipeline/fetch.py
cd widget ; npm install ; npm run dev
```

The pipeline is stdlib-only — nothing to pip install.

## Embed

```html
<iframe src="https://rowanflynnpilot.github.io/wpr-court-tracker/"
        title="Marathon County Court Tracker"
        style="width:100%;min-height:1100px;border:0;" loading="lazy"></iframe>
```

## Newsroom alerts

Every data commit's message lists case numbers with new activity — watch
the repo to get notified. `data/changes.json` is the structured version,
consumed by the newsletter digest.
