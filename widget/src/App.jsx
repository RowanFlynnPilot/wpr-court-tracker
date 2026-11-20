import React, { useEffect, useMemo, useState } from 'react';
import CaseFile from './CaseFile.jsx';
import RequestForm from './RequestForm.jsx';
import CaseList from './CaseList.jsx';
import { GLOSSARY } from './glossary.js';
import badge from './assets/wpr-badge.png';

const DAY_MS = 86400000;

const docketFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const sinceFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
const fmtMinutes = (m) => (m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} hr`);

// Display order for the "Where cases stand" totals (keys from the
// pipeline's STAGES; an unknown key sorts last rather than vanishing).
const STAGE_ORDER = ['filed', 'charged', 'pretrial', 'trial', 'sentencing', 'deferred', 'appeal'];

export function latestActivity(c) {
  const stamps = [];
  if (c.observed?.length) stamps.push(Date.parse(c.observed[0].updated));
  for (const u of c.updates ?? []) stamps.push(datePartsToMs(u.date));
  return stamps.length ? Math.max(...stamps) : 0;
}

// Parse a YYYY-MM-DD editorial date as a local date (no timezone shift).
export function datePartsToMs(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
}

// Every hearing on a file, soonest first: the next one plus any later
// ones already on the calendar (a trial set behind a motion hearing).
export function caseHearings(c) {
  return [c.nextHearing, ...(c.laterHearings ?? [])]
    .filter((h) => h && h.date)
    .sort((a, b) => datePartsToMs(a.date) - datePartsToMs(b.date));
}

export function upcomingHearings(c, todayMs) {
  return caseHearings(c).filter((h) => datePartsToMs(h.date) >= todayMs);
}

export default function App() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [activeTag, setActiveTag] = useState('All');
  const [query, setQuery] = useState('');
  const [activeStage, setActiveStage] = useState('');
  const [sort, setSort] = useState('activity');
  // Cards are the default; the list view is a per-reader preference.
  const [view, setViewState] = useState(() => {
    if (window.location.hash.length > 1) return 'cards'; // a link to one case always shows its card
    try {
      return localStorage.getItem('wpr-tracker-view') === 'list' ? 'list' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem('wpr-tracker-view', v);
    } catch {
      /* the preference just won't stick */
    }
  };
  // A case picked from the list (or the docket strip while in list view)
  // opens once the cards are back on the page.
  const [pendingOpen, setPendingOpen] = useState(null);
  useEffect(() => {
    if (!pendingOpen || view !== 'cards') return;
    window.dispatchEvent(new CustomEvent('wpr-open-case', { detail: pendingOpen }));
    document.getElementById(pendingOpen)?.scrollIntoView({ block: 'start' });
    setPendingOpen(null);
  }, [pendingOpen, view]);

  // Deep link: /#case-id opens that folder and scrolls to it.
  const focusId = useMemo(
    () => decodeURIComponent(window.location.hash.slice(1)),
    []
  );

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}feed.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`feed.json returned ${r.status}`);
        return r.json();
      })
      .then(setFeed)
      .catch((e) => setError(e.message));
    // Service-record numbers for the at-a-glance band (pipeline's
    // build_stats). Optional: the band shrinks to what the feed knows.
    fetch(`${import.meta.env.BASE_URL}stats.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!feed || !focusId) return;
    document.getElementById(focusId)?.scrollIntoView({ block: 'start' });
  }, [feed, focusId]);

  const tags = useMemo(() => {
    if (!feed) return [];
    const t = new Set();
    for (const c of feed.cases) for (const tag of c.tags) t.add(tag);
    return ['All', ...[...t].sort()];
  }, [feed]);

  const cases = useMemo(() => {
    if (!feed) return [];
    let list =
      activeTag === 'All'
        ? feed.cases
        : feed.cases.filter((c) => c.tags.includes(activeTag));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        [c.headline, c.summary, c.officialCaption, c.caseNo, ...c.tags]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(q))
      );
    }
    if (activeStage) list = list.filter((c) => c.stage === activeStage);
    const byActivity = (a, b) => latestActivity(b) - latestActivity(a);
    const n = new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    // Upcoming hearings soonest first; files with none keep activity order.
    const hearingMs = (c) => {
      const next = upcomingHearings(c, today)[0];
      return next ? datePartsToMs(next.date) : Infinity;
    };
    const order =
      sort === 'hearing'
        ? (a, b) => {
            const ha = hearingMs(a);
            const hb = hearingMs(b);
            return ha === hb ? byActivity(a, b) : ha - hb;
          }
        : sort === 'az'
          ? (a, b) => a.headline.localeCompare(b.headline)
          : byActivity;
    // Placeholders (SAMPLE cards) always sort below real cases - activity
    // dates on demo content must never outrank the real record.
    return [...list].sort(
      (a, b) => (a.placeholder ? 1 : 0) - (b.placeholder ? 1 : 0) || order(a, b)
    );
  }, [feed, activeTag, query, activeStage, sort]);

  // "Where cases stand": totals of the reporter-set stage across open
  // files, in the order a case moves through court. Doubles as a filter.
  const standing = useMemo(() => {
    if (!feed) return [];
    const counts = new Map();
    for (const c of feed.cases) {
      if (c.placeholder || c.status === 'closed' || !c.stage) continue;
      const row = counts.get(c.stage) ?? { key: c.stage, label: c.stageLabel ?? c.stage, n: 0 };
      row.n += 1;
      counts.set(c.stage, row);
    }
    const rank = (k) => {
      const i = STAGE_ORDER.indexOf(k);
      return i === -1 ? STAGE_ORDER.length : i;
    };
    return [...counts.values()].sort((a, b) => rank(a.key) - rank(b.key));
  }, [feed]);

  const watching = cases.filter((c) => c.status !== 'closed');
  const closed = cases.filter((c) => c.status === 'closed');

  // Soonest upcoming hearings across the watchlist, for the docket strip.
  const docket = useMemo(() => {
    if (!feed) return [];
    const n = new Date();
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    // One entry per upcoming hearing, so a file with two dates shows twice.
    return feed.cases
      .filter((c) => !c.placeholder && c.status !== 'closed')
      .flatMap((c) => upcomingHearings(c, today).map((h) => ({ c, h })))
      .sort((a, b) => datePartsToMs(a.h.date) - datePartsToMs(b.h.date))
      .slice(0, 4);
  }, [feed]);

  const masthead = (
    <header className="masthead">
      <img className="badge" src={badge} alt="" width="104" height="104" />
      <div>
        <p className="eyebrow">
          <a href="https://wausaupilotandreview.com/" target="_blank" rel="noreferrer">Wausau Pilot &amp; Review</a>
        </p>
        <h1>Marathon County Court Tracker</h1>
        <p className="dek">
          Cases of public interest our newsroom is following, with activity
          checked against the official court record.
        </p>
      </div>
    </header>
  );

  if (error) {
    return (
      <main className="shell">
        {masthead}
        <p className="load-error" role="alert">
          The case list didn&rsquo;t load ({error}). Reload the page to try again.
        </p>
      </main>
    );
  }
  if (!feed) {
    // The page's real frame with placeholder blocks where the data goes,
    // so nothing jumps when the feed lands.
    return (
      <main className="shell" aria-busy="true">
        {masthead}
        <p className="sr-only" role="status">Opening the case files&hellip;</p>
        <div className="glance" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <b><i className="sk sk-num" /></b>
              <span><i className="sk sk-label" /></span>
            </div>
          ))}
        </div>
        <div className="stack sk-stack" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="folder">
              <div className="folder-tabrow">
                <span className="folder-tab"><i className="sk sk-tab" /></span>
              </div>
              <div className="folder-body">
                <i className="sk sk-head" />
                <i className="sk sk-line sk-short" />
                <i className="sk sk-line" />
                <i className="sk sk-line" />
                <i className="sk sk-line sk-mid" />
                <i className="sk sk-strip" />
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  const generatedMs = Date.parse(feed.generatedAt);
  // "New activity" = anything new on the file within 7 days - a reporter
  // update is activity too, not just an observed court-record change.
  const hasNewActivity = (c) => {
    const last = latestActivity(c);
    return last > 0 && generatedMs - last < 7 * DAY_MS;
  };
  const watchedCount = feed.cases.filter(
    (c) => !c.placeholder && c.status !== 'closed'
  ).length;
  // The sort control earns its space once there is a list to sort.
  const realCount = feed.cases.filter((c) => !c.placeholder).length;
  const showList = view === 'list' && realCount >= 3;
  const pickCase = (id) => {
    setView('cards');
    setPendingOpen(id);
  };
  const updatedLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
  }).format(generatedMs);

  return (
    <main className="shell">
      {masthead}

      <div className="glance" role="list" aria-label="Tracker at a glance">
        <div role="listitem">
          <b>{watchedCount}</b>
          <span>Case{watchedCount === 1 ? '' : 's'} watched</span>
        </div>
        {/* Changes caught while we were watching - not the first reading
            taken when a case is added, which would inflate the count. */}
        {stats?.recordChangesCaught != null && (
          <div role="listitem">
            <b>{stats.recordChangesCaught}</b>
            <span>Court-record changes caught</span>
          </div>
        )}
        {stats?.medianDetectionMinutes != null && (
          <div role="listitem">
            <b>{fmtMinutes(stats.medianDetectionMinutes)}</b>
            <span>Median time to catch a change</span>
          </div>
        )}
        {stats?.trackingSince && (
          <div role="listitem">
            <b>{sinceFmt.format(datePartsToMs(stats.trackingSince))}</b>
            <span>Tracking since</span>
          </div>
        )}
      </div>

      <p className="statline">
        <span>
          Checked <span className="mono">{updatedLabel}</span>
        </span>
        <span>Checks weekdays 8 a.m.&ndash;6 p.m.</span>
        <span>Official court record</span>
      </p>

      <div className="drawers">
        <details className="about">
          <summary>How this tracker works</summary>
          <div className="about-body">
            <p>
              <b>The newsroom chooses the cases.</b> Wausau Pilot &amp; Review
              editors hand-pick cases of public interest. Family, juvenile,
              guardianship, and mental-health cases are never tracked &mdash;
              that&rsquo;s editorial policy, enforced in our software.
            </p>
            <p>
              <b>The official record is checked automatically.</b> Every two
              hours on weekdays we check each case against{' '}
              <a href="https://wcca.wicourts.gov/" target="_blank" rel="noreferrer">Wisconsin Circuit Court Access</a>,
              using the court system&rsquo;s sanctioned data feed. We never
              scrape the court website.
            </p>
            <p>
              <b>Machines observe; reporters explain.</b> A red entry in a
              case&rsquo;s activity log means the official record changed. The
              teal entries &mdash; what happened, in plain English &mdash; are
              written by our reporters. Criminal cases always carry a
              presumption-of-innocence note.
            </p>
            <p>
              <b>See something wrong?</b> Email{' '}
              <a href={`mailto:${feed.requestEmail}`}>{feed.requestEmail}</a>{' '}
              and we&rsquo;ll correct the file.
            </p>
            <p>
              <a href={`${import.meta.env.BASE_URL}about.html`}>Read the full methodology &rarr;</a>
            </p>
          </div>
        </details>

        <details className="about">
          <summary>Court terms, plain English</summary>
          <div className="about-body gloss-body">
            <div className="gloss">
              {GLOSSARY.map((g) => (
                <p key={g.term}>
                  <b>{g.term}</b> &mdash; {g.def}
                </p>
              ))}
            </div>
            <p className="gloss-note">
              General plain-language definitions for Wisconsin circuit courts
              &mdash; not legal advice. Confused by something in a case file?{' '}
              <a href={`mailto:${feed.requestEmail}`}>Tell us</a> and
              we&rsquo;ll explain it here.
            </p>
          </div>
        </details>
      </div>

      {standing.length > 0 && (
        <p className="standing" role="group" aria-label="Where cases stand. Choose one to filter.">
          <span className="standing-label">Where cases stand</span>
          {standing.map((s) => (
            <button
              key={s.key}
              className={`chip chip-ink${activeStage === s.key ? ' chip-on' : ''}`}
              aria-pressed={activeStage === s.key}
              onClick={() => setActiveStage(activeStage === s.key ? '' : s.key)}
            >
              {s.label} <b>{s.n}</b>
            </button>
          ))}
        </p>
      )}

      <nav className="filters" aria-label="Filter cases by topic">
        {/* One row that scrolls sideways on a phone instead of wrapping. */}
        <span className="chip-row">
          {tags.map((t) => (
            <button
              key={t}
              className={`chip${t === activeTag ? ' chip-on' : ''}`}
              aria-pressed={t === activeTag}
              onClick={() => setActiveTag(t)}
            >
              {t}
            </button>
          ))}
        </span>
        <span className="filters-tools">
          {realCount >= 3 && (
            <span className="viewtoggle" role="group" aria-label="Show cases as">
              <button type="button" aria-pressed={!showList} onClick={() => setView('cards')}>Cards</button>
              <button type="button" aria-pressed={showList} onClick={() => setView('list')}>List</button>
            </span>
          )}
          {realCount >= 3 && (
            <label className="sort">
              <span className="sort-word">Sort</span>
              <select aria-label="Sort cases" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="activity">Latest activity</option>
                <option value="hearing">Next hearing</option>
                <option value="az">A&ndash;Z</option>
              </select>
            </label>
          )}
          <input
            type="search"
            className="search"
            placeholder="Search cases or names&hellip;"
            aria-label="Search cases"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
      </nav>

      {docket.length > 0 && (
        <p className="docket">
          <span className="docket-label">Next on the docket</span>
          {docket.map(({ c, h }) => (
            <a
              key={`${c.id}-${h.date}`}
              href={`#${c.id}`}
              className="docket-item"
              title={h.note ? `${c.headline} (${h.note})` : c.headline}
              onClick={(e) => {
                if (showList) {
                  e.preventDefault();
                  pickCase(c.id);
                } else {
                  window.dispatchEvent(new CustomEvent('wpr-open-case', { detail: c.id }));
                }
              }}
            >
              <span className="mono docket-date">
                {docketFmt.format(datePartsToMs(h.date))}
              </span>
              {c.headline}
            </a>
          ))}
        </p>
      )}

      {cases.length === 0 ? (
        <p className="empty">No tracked cases match. Clear the search or pick another topic or stage &mdash; or ask us to track a case below.</p>
      ) : (
        <>
          {showList ? (
            <CaseList cases={watching} isNew={hasNewActivity} onPick={pickCase} />
          ) : (
            <section className="stack" aria-label="Tracked cases">
              {watching.map((c) => (
                <CaseFile
                  key={c.id}
                  c={c}
                  generatedMs={generatedMs}
                  presumptionNote={feed.presumptionNote}
                  defaultOpen={c.id === focusId}
                  isNew={hasNewActivity(c)}
                />
              ))}
            </section>
          )}

          {closed.length > 0 && (
            <details
              className="cabinet"
              open={closed.some((c) => c.id === focusId) || undefined}
            >
              <summary>
                Closed files <span className="mono">({closed.length})</span>
              </summary>
              <section className="stack" aria-label="Closed cases">
                {closed.map((c) => (
                  <CaseFile
                    key={c.id}
                    c={c}
                    generatedMs={generatedMs}
                    presumptionNote={feed.presumptionNote}
                    defaultOpen={c.id === focusId}
                    isNew={hasNewActivity(c)}
                  />
                ))}
              </section>
            </details>
          )}
        </>
      )}

      <RequestForm email={feed.requestEmail} />

      <footer className="colophon">
        <p>{feed.disclaimer}</p>
        <p>
          Source: <a href="https://wcca.wicourts.gov/" target="_blank" rel="noreferrer">Wisconsin Circuit Court Access</a>, via the court system&rsquo;s official per-case RSS feeds. Not affiliated with or endorsed by the Wisconsin court system.
        </p>
        <p>
          Follow along: <a href={`${import.meta.env.BASE_URL}tracker.xml`}>case-activity feed (RSS)</a> &middot; <a href={`${import.meta.env.BASE_URL}hearings.ics`}>hearing calendar (.ics)</a> &mdash; both update automatically. <a href={`${import.meta.env.BASE_URL}about.html`}>Methodology &amp; editorial rules</a>.
        </p>
        <p>
          <a href="https://wausaupilotandreview.com/" target="_blank" rel="noreferrer">Wausau Pilot &amp; Review</a> &middot; 715-301-5539 &middot; <span className="tagline">Where Locals Look First For News</span>
        </p>
      </footer>
    </main>
  );
}
