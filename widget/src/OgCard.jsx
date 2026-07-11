import React, { useEffect, useState } from 'react';
import badge from './assets/wpr-badge.png';

// 1200x630 social share card, screenshotted to /og-card.png at deploy
// time (scripts/render-cards.mjs). Shown when readers paste a tracker
// link into Facebook et al. - which they will, via "Copy link to this
// case". Fixed-size by design: og:image dimensions are a spec, not a
// suggestion.

export default function OgCard() {
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}feed.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFeed)
      .catch(() => setFeed(null));
  }, []);

  if (!feed) return <p className="loading">Preparing the card&hellip;</p>;

  const watched = feed.cases.filter(
    (c) => !c.placeholder && c.status !== 'closed'
  ).length;

  return (
    <div className="og-card og-ready">
      <img className="og-badge" src={badge} alt="" width="300" height="300" />
      <div>
        <p className="og-eyebrow">Wausau Pilot &amp; Review</p>
        <h1>Marathon County Court Tracker</h1>
        <p className="og-dek">
          Cases of public interest, checked against the official court
          record all day.
        </p>
        <p className="og-stat">
          {watched} case{watched === 1 ? '' : 's'} watched &middot; updated every 2 hours
        </p>
      </div>
      <div className="og-tabs" aria-hidden="true">
        <span>Felony</span>
        <span>Misdemeanor</span>
        <span>Civil</span>
        <span>Open records</span>
      </div>
    </div>
  );
}
