# Run this tracker in your county

This is a guide for another newsroom that wants its own court tracker.
Wausau Pilot & Review built this one for Marathon County, Wisconsin. The
code is MIT-licensed: fork it, rename it, make it yours.

Plan on an afternoon for someone comfortable with GitHub, plus an editor's
time to decide which case types you will and won't track.

## Will it work where you are?

**Any Wisconsin county: yes.** The tracker reads the per-case RSS feeds
published by Wisconsin Circuit Court Access (WCCA), which covers all 72
counties. Changing county is a one-line setting.

**Outside Wisconsin: only if your court system offers its own sanctioned
feed or API.** The watchlist, the editorial rules, the newsroom desk and
the reader page all carry over. The one file that talks to the courts,
`pipeline/fetch.py`, would need rewriting for your state's system. Do not
point it at a court website that prohibits automated access.

## What you get

- A reader page of hand-picked cases, each with a timeline, the reporter's
  notes, and a marker every time the official record changes.
- A newsroom desk that turns a pasted case page into a ready-to-review
  entry, checked against your editorial rules before anything publishes.
- A newsletter image, a share card, an RSS feed and a hearing calendar,
  rebuilt automatically.
- Hosting on GitHub Pages and checks on GitHub Actions. Running cost: $0.

## What it does not do

The WCCA feed says *that* a case record changed and *when*. It does not
carry docket text, charges or hearing dates. Reporters supply those. The
software flags files that are waiting on a reporter's note; it never
writes one.

## Rules to keep

These are why the tracker is defensible. Please carry them into your copy.

1. **Use only the sanctioned feed.** Never scrape the WCCA website or its
   case-detail pages; its terms prohibit automated access.
2. **Identify yourself.** The fetcher sends a `User-Agent` naming your
   newsroom and a contact email, so the court system can reach you.
3. **Keep the checks modest.** About six a weekday is the design. Polling
   more often gains nothing; courts don't docket that fast.
4. **Keep editorial policy in code.** `pipeline/policy.py` blocks family,
   juvenile, guardianship and mental-health cases and puts a
   presumption-of-innocence note on every criminal case. Change the list
   only with your publisher's sign-off.
5. **Humans sign off before anything publishes.** The repository is
   public; a committed case is live within minutes.

## Setup

### 1. Copy the repository

Fork it, or use GitHub's "Use this template" button if it is offered.
Name it for your newsroom. Keep it public if you want free GitHub Pages
and Actions.

### 2. Decide your editorial policy

Open `pipeline/policy.py` with your editor. Confirm the allowed case
types, the disclaimer wording and the presumption note. This is the one
step that should not be delegated to whoever is doing the setup.

### 3. Make it yours

Everything specific to Wausau Pilot & Review lives in the places below.

| What | Where | Change to |
|---|---|---|
| Your county | `pipeline/issue_case.py` → `COUNTY_NAMES` | Your county's WCCA number and name. The number is the `countyNo=` value in any case link from your county. |
| Your site address | `pipeline/fetch.py` → `SITE_URL` | `https://<your-account>.github.io/<your-repo>/` |
| Who is asking | `pipeline/fetch.py` → `USER_AGENT` | Your newsroom's name and a monitored email |
| Watchlist and contact email | `config/cases.json` | Start from `config/cases.example.json`; set `requestEmail` |
| Where desk submissions go | `widget/src/parseCase.js` → `buildIssueUrl` | Your repository's `issues/new` address |
| Default county in the desk | `widget/src/parseCase.js` and `widget/src/CaseDesk.jsx` | Your county's name |
| Site address in the workflows | `.github/workflows/update.yml` (two places), `.github/workflows/track-case.yml`, `.github/ISSUE_TEMPLATE/track-a-case.yml` | Your site address |
| Names, titles and descriptions | `widget/index.html`, `about.html`, `preview.html`, `editor.html`, `mini-digest.html`; `widget/src/App.jsx`, `CaseDesk.jsx`, `OgCard.jsx`, `MiniDigest.jsx` | Your newsroom and county |
| Logo | `widget/src/assets/wpr-badge.png` | Your own mark (keep the filename, or update the imports) |
| Colors and type | `widget/src/styles.css` → `:root` | Your brand. Check text contrast on the manila panels. |
| Footer line | `widget/src/App.jsx`, `widget/about.html`, `widget/preview.html` | Your newsroom, phone and tagline |
| Methodology page | `widget/about.html` | Rewrite in your own voice; keep it accurate to what you run |
| Court terms | `widget/src/glossary.js` | Fine as written for any Wisconsin county; edit to your house style |
| Project name and README | `widget/package.json`, `README.md` | Yours. The README's links and embed snippet all point at our site. |
| License | `LICENSE` | Keep the existing copyright notice (MIT requires it) and add your own line |

GitHub's free scheduler starts many scheduled runs late and skips
others. Two optional helpers ask GitHub to run a check when it has fallen
behind, and do nothing when it is keeping up. Use one, or neither:

- `tools/backstop-apps-script.gs` runs on Google Apps Script, so it works
  with every computer switched off. Setup takes about five minutes and is
  written at the top of the file. Change the two addresses there.
- `tools/backstop-check.ps1` does the same from a Windows scheduled task,
  and works only while that machine is on. Change the two addresses at
  the top.

The time zone in the workflows is `America/Chicago`, which is right for
all of Wisconsin.

When you think you are done, run:

```
python tools/replication_check.py
```

It lists every remaining mention of Wausau Pilot & Review, Marathon
County and this repository, by file and line. Work through it until it
reports none.

### 4. Set up GitHub

1. **Pages:** Settings → Pages → Source: *GitHub Actions*.
2. **The intake label:** create a label named exactly `track-a-case`.
   GitHub silently drops a form's label if it doesn't exist, and without
   it every newsroom submission is ignored. This cost us five days.
3. **Collaborators:** add the editors who may publish. Submissions from
   the owner and collaborators publish automatically; anyone else's
   are labelled and held for an editor, who re-files the case from the
   desk if you take it on.

### 5. First run

```
python tests/test_pipeline.py
python pipeline/fetch.py
cd widget
npm install
npm run build
```

The pipeline needs only Python's standard library. Commit and push to
`main`; the first deploy takes a few minutes. Your tracker will be at
your site address.

### 6. Add your first case

Open `editor.html` on your site (the Case Entry Desk). Paste a WCCA case
link and the case page text, review what it found, and submit. To publish
immediately, run the "Track-a-case intake" workflow from the Actions tab.

### 7. Put it on your website

The README has an embed snippet that sizes itself to the tracker's
height. Change the address in it to yours.

## Things we learned running it

- **GitHub's scheduler is unreliable.** It starts scheduled runs late and
  drops many. The workflow schedules a "ticket" every 20 minutes and runs
  a check only when the last one is about two hours old, so missed
  tickets don't cost you checks. The methodology page shows how many
  checks actually completed; quote that number, not the design.
- **WCCA is slow for cloud servers at certain times of day.** A stalled
  check hands itself to a fresh runner, up to three times. Only a
  three-runner miss opens an alert issue, which closes itself on
  recovery.
- **A quiet repository gets its schedule switched off.** GitHub disables
  scheduled workflows after 60 days without activity. The workflow
  commits a refresh if 25 days pass with nothing new.
- **The record will outrun your reporters.** A busy case can change a
  dozen times between notes. The publish sweep keeps one issue listing
  files that are waiting on a note; treat it as the newsroom's to-do
  list.
- **Data commits are your alerts.** The workflow commits only when a
  record actually changed, and names the case in the message. Watch the
  repository to be notified.

## Tell us

If you stand one up, we'd like to know: news@wausaupilotandreview.com.
A credit line somewhere on your methodology page is appreciated, not
required.
