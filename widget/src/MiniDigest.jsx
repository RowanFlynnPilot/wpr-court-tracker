import React, { useEffect, useMemo, useState } from 'react';
import { datePartsToMs } from './App.jsx';

// Newsletter digest card. Rendered to PNG by scripts/render-digest.mjs at
// deploy time (email clients strip iframes/JS), so keep it self-contained
// and compact: the whole card is one image in an inbox. `?image=1` hides
// the "Full tracker" link — a region inside an image can't carry a link.

const DAY_MS = 86400000;
const RECENT_DAYS = 7;
const MAX_ROWS = 5;

const dayFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'America/Chicago',
});
const stampFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Chicago',
});

export default function MiniDigest() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const imageMode = useMemo(
    () => new URLSearchParams(window.location.search).get('image') === '1',
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

  if (error) return <p className="digest-error">Digest failed to load: {error}</p>;
  if (!feed) return <p className="loading">Preparing the digest&hellip;</p>;

  const generatedMs = Date.parse(feed.generatedAt);
  const real = feed.cases.filter((c) => !c.placeholder);

  const recent = real
    .filter(
      (c) =>
        c.observed?.length > 0 &&
        generatedMs - Date.parse(c.observed[0].updated) < RECENT_DAYS * DAY_MS
    )
    .sort((a, b) => Date.parse(b.observed[0].updated) - Date.parse(a.observed[0].updated))
    .slice(0, MAX_ROWS);

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const hearings = real
    .filter((c) => c.status !== 'closed' && c.nextHearing && datePartsToMs(c.nextHearing.date) >= startOfToday)
    .sort((a, b) => datePartsToMs(a.nextHearing.date) - datePartsToMs(b.nextHearing.date))
    .slice(0, MAX_ROWS);

  const watched = real.filter((c) => c.status !== 'closed').length;

  // Cases in their first week on the watchlist - the "why is this here"
  // section. Rendered only when there's something to announce.
  const newlyTracked = real
    .filter(
      (c) =>
        c.firstTrackedAt &&
        generatedMs - Date.parse(c.firstTrackedAt) < RECENT_DAYS * DAY_MS
    )
    .sort((a, b) => Date.parse(b.firstTrackedAt) - Date.parse(a.firstTrackedAt))
    .slice(0, MAX_ROWS);

  return (
    <div className="mini-card digest-ready">
      <div className="mini-head">
        <span className="mini-title">Court Tracker Digest</span>
        <span className="mini-date">{stampFmt.format(generatedMs)}</span>
      </div>

      {newlyTracked.length > 0 && (
        <div className="mini-section">
          <h2 className="mini-h mini-h-tracked">Newly tracked</h2>
          {newlyTracked.map((c) => (
            <div key={c.id} className="digest-row">
              <span className="digest-when digest-when-tracked">
                {dayFmt.format(Date.parse(c.firstTrackedAt))}
              </span>
              <span className="digest-what">
                <b>{c.headline}</b>
                Added to the WPR watchlist.
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mini-section">
        <h2 className="mini-h mini-h-activity">New court activity &mdash; past {RECENT_DAYS} days</h2>
        {recent.length === 0 ? (
          <p className="digest-empty">No new activity on tracked cases this week.</p>
        ) : (
          recent.map((c) => (
            <div key={c.id} className="digest-row">
              <span className="digest-when">
                {dayFmt.format(Date.parse(c.observed[0].updated))}
              </span>
              <span className="digest-what">
                <b>{c.headline}</b>
                Court record updated{c.status === 'closed' ? ' (closed case)' : ''}.
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mini-section">
        <h2 className="mini-h mini-h-hearings">Upcoming hearings</h2>
        {hearings.length === 0 ? (
          <p className="digest-empty">None scheduled on tracked cases.</p>
        ) : (
          hearings.map((c) => (
            <div key={c.id} className="digest-row">
              <span className="digest-when digest-when-hearing">
                {dayFmt.format(datePartsToMs(c.nextHearing.date))}
              </span>
              <span className="digest-what">
                <b>{c.headline}</b>
                {c.nextHearing.note}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mini-foot">
        <p className="mini-count">
          {watched} case{watched === 1 ? '' : 's'} watched &middot; Marathon County Circuit Court &middot; Wausau Pilot &amp; Review
        </p>
        <p className="mini-presumption">{feed.presumptionNote}</p>
        {!imageMode && (
          <p className="mini-full">
            <a href="./">Open the full tracker &rarr;</a>
          </p>
        )}
      </div>
    </div>
  );
}
