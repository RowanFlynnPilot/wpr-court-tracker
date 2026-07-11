import React, { useEffect, useMemo, useState } from 'react';
import CaseFile from './CaseFile.jsx';
import RequestForm from './RequestForm.jsx';
import badge from './assets/wpr-badge.png';

const DAY_MS = 86400000;

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

export default function App() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const [activeTag, setActiveTag] = useState('All');

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
    const list =
      activeTag === 'All'
        ? feed.cases
        : feed.cases.filter((c) => c.tags.includes(activeTag));
    return [...list].sort((a, b) => latestActivity(b) - latestActivity(a));
  }, [feed, activeTag]);

  const watching = cases.filter((c) => c.status !== 'closed');
  const closed = cases.filter((c) => c.status === 'closed');

  if (error) {
    return (
      <main className="shell">
        <p className="load-error" role="alert">
          The case list didn&rsquo;t load ({error}). Reload the page to try again.
        </p>
      </main>
    );
  }
  if (!feed) {
    return (
      <main className="shell">
        <p className="loading">Opening the case files&hellip;</p>
      </main>
    );
  }

  const generatedMs = Date.parse(feed.generatedAt);
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
      <header className="masthead">
        <img className="badge" src={badge} alt="" width="104" height="104" />
        <div>
          <p className="eyebrow">Wausau Pilot &amp; Review</p>
          <h1>Marathon County Court Tracker</h1>
          <p className="dek">
            Cases of public interest our newsroom is following, with activity
            checked against the official court record.
          </p>
          <p className="updated">Checked {updatedLabel}</p>
        </div>
      </header>

      <nav className="filters" aria-label="Filter cases by topic">
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
      </nav>

      {cases.length === 0 ? (
        <p className="empty">No tracked cases match this topic yet. Choose another topic, or ask us to track a case below.</p>
      ) : (
        <>
          <section className="stack" aria-label="Tracked cases">
            {watching.map((c) => (
              <CaseFile
                key={c.id}
                c={c}
                generatedMs={generatedMs}
                presumptionNote={feed.presumptionNote}
                defaultOpen={c.id === focusId}
                isNew={
                  c.observed?.length > 0 &&
                  generatedMs - Date.parse(c.observed[0].updated) < 7 * DAY_MS
                }
              />
            ))}
          </section>

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
                    isNew={
                      c.observed?.length > 0 &&
                      generatedMs - Date.parse(c.observed[0].updated) < 7 * DAY_MS
                    }
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
          Source: <a href="https://wcca.wicourts.gov/" target="_blank" rel="noreferrer">Wisconsin Circuit Court Access</a>, via the court system&rsquo;s official per-case RSS feeds. Built by <a href="https://wausaupilotandreview.com/" target="_blank" rel="noreferrer">Wausau Pilot &amp; Review</a> &mdash; <span className="tagline">More News. Less Fluff. All Local.</span>
        </p>
      </footer>
    </main>
  );
}
