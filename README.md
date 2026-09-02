# WPR Court Tracker

**Live:** https://rowanflynnpilot.github.io/wpr-court-tracker/ ·
**How it works:** https://rowanflynnpilot.github.io/wpr-court-tracker/about.html ·
**License:** MIT

A hand-curated watchlist of Marathon County court cases of public
interest, followed by the Wausau Pilot & Review newsroom. Each case is
checked automatically against the Wisconsin court system's **official
per-case RSS feeds** — the court system's sanctioned automated channel,
and the only one this project touches; it never scrapes the court
website. The feed signals *that* a record changed; WPR reporters supply
*what* changed. Editorial policy — which case types may appear, the
presumption-of-innocence note on every criminal case — is enforced in
code, not by convention.

Service record since the July 2026 reliability rework: zero failed runs
in the last hundred, court-system outages flagged and self-healed
without intervention, and every change to the data published as a
commit that names its case. The live widget runs on GitHub Pages and is
embedded in WordPress via iframe. See CLAUDE.md for architecture and
hard boundaries.

## Adding a case (reporters & editors)

**Easiest way — the Case Entry Desk:**
https://rowanflynnpilot.github.io/wpr-court-tracker/editor.html

Open the case on WCCA in your browser, select-all-copy the page (or
Print → Save as PDF and upload that file), and the desk prefills the
form — case number, hearing dates, charge lines — for you to review and
edit against a live preview of the published folder. Submitting opens a
prefilled "Track a case" issue, validated on the spot. The desk parses
everything in your browser — it never contacts the court system, and
nothing you paste leaves the page until you submit the reviewed fields.

The desk also handles the ongoing work: pick a tracked case under
**"Working on"** to update its fields, add timeline entries, move the
hearing date, or set its status to **Closed** (which files it under the
widget's Closed Files drawer — the observed court-record history always
survives an update). Drafts auto-save in the browser, so a closed tab
loses nothing.

**Publishing cadence:** submissions from the newsroom (repo
owner/members/collaborators) publish **automatically at the next
sweep — 7:45 a.m. and 3:45 p.m. Central, daily**. Close the issue
before the sweep to cancel, or run the "Track-a-case intake" workflow
from the Actions tab to publish immediately. Submissions from anyone
else become a pull request the newsroom must merge — auto-publish never
extends to the public.

**Or the bare issue form:** open a
["Track a case" issue](../../issues/new?template=track-a-case.yml) and
fill it in by hand. Same validation, same publishing cadence. If the
form fails policy (blocked case type, bad date, already tracked), a
comment on the issue says exactly what to fix — edit the issue
description and it re-checks.

**By hand**, if you prefer:

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

When a case resolves, add `"status": "closed"` instead of deleting the
entry — it moves to the collapsed "Closed files" drawer but stays on the
record (and is still fetched: appeals and post-judgment motions alert the
newsroom too).

Every case has a shareable deep link that opens its folder directly:
append `#<case-id>` to the widget URL, e.g.
`https://rowanflynnpilot.github.io/wpr-court-tracker/#wausau-2026cm000231`.
Readers get the same link from "Copy link to this case" inside each file.

## Local development (PowerShell)

```
python tests/test_pipeline.py ; python pipeline/fetch.py
cd widget ; npm install ; npm run dev
```

The pipeline is stdlib-only — nothing to pip install.

## Embed

The widget reports its rendered height to the parent page, so the iframe
can size itself instead of being pinned (and clipped) at a fixed height.
Paste both blocks into a WordPress Custom HTML block:

```html
<iframe id="wpr-court-tracker"
        src="https://rowanflynnpilot.github.io/wpr-court-tracker/"
        title="Marathon County Court Tracker"
        style="width:100%;min-height:600px;border:0;" loading="lazy"></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://rowanflynnpilot.github.io') return;
    if (!e.data || e.data.source !== 'wpr-court-tracker') return;
    document.getElementById('wpr-court-tracker').style.height = e.data.height + 'px';
  });
</script>
```

If the page builder strips `<script>` tags, the plain iframe with
`min-height:1100px` still works — the script is an enhancement, not a
requirement.

## Newsletter digest image

Every deploy renders the digest card (new court activity in the past 7
days + upcoming hearings) to a PNG at the Pages root — email clients
strip iframes, so the newsletter embeds it as a linked image:

```html
<a href="https://wausaupilotandreview.com/">  <!-- link to the page that embeds the tracker -->
  <img src="https://rowanflynnpilot.github.io/wpr-court-tracker/digest.png"
       alt="Court tracker digest — new case activity and upcoming hearings"
       width="600" style="width:100%;max-width:600px;height:auto;border:0;display:block" />
</a>
```

Put a real text link ("See the full court tracker →") under the image —
regions inside an image can't carry their own links. The live card is at
`/mini-digest.html`; `widget/scripts/render-digest.mjs` screenshots it.

## Reader subscriptions

Two machine-readable outputs regenerate with every pipeline run and are
linked from the widget footer:

- `https://rowanflynnpilot.github.io/wpr-court-tracker/tracker.xml` —
  RSS of case activity (observed record changes + newsroom updates,
  stable guids so readers never see repeats).
- `https://rowanflynnpilot.github.io/wpr-court-tracker/hearings.ics` —
  subscribable hearing calendar (all-day events on purpose: hearing
  times live in free-text notes, and a wrong parsed time on someone's
  calendar is worse than none).

## Newsroom alerts

Every data commit's message lists case numbers with new activity — watch
the repo to get notified. Quiet runs don't commit at all, so every data
commit is a real alert. `data/changes.json` is the structured per-run
version (which cases changed in a given run).

The publish sweep also maintains one `needs-newsroom-note` issue listing
case files that owe readers a reporter's note — a hearing that passed,
or a court record that moved, with no note since. It rewrites itself
each sweep and closes once every file is current.

## License

[MIT](LICENSE) — copyright Wausau Pilot & Review. Use it, fork it for
your own county, credit the newsroom.
