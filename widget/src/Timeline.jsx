import React, { useMemo, useState } from 'react';
import { caseHearings, datePartsToMs } from './App.jsx';

// Case timeline strip: the file's whole history at a glance. Two lanes so
// identity never rests on colour alone - court-record changes are red
// TICKS in the top lane, newsroom notes are teal DOTS in the bottom lane,
// the hearing is an ink diamond. The ledger below is the table view.
//
// Palette note (dataviz validator, manila surface): stamp red vs brand
// teal passes CVD separation (dE 10.3) and contrast; the brand teal sits
// under the chroma floor, which is why lane + shape + label carry
// identity too. The teal must stay the ledger's teal so the two match.

const DAY = 86400000;
const dayFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Chicago',
});
const monFmt = new Intl.DateTimeFormat('en-US', { month: 'short' });

const clip = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function Timeline({ c, generatedMs }) {
  const [tip, setTip] = useState(null);

  const m = useMemo(() => {
    const court = (c.observed ?? []).map((o) => Date.parse(o.updated)).sort((a, b) => a - b);
    const notes = (c.updates ?? [])
      .map((u) => ({ ms: datePartsToMs(u.date), note: u.note }))
      .sort((a, b) => a.ms - b.ms);
    // Every hearing on the file gets a diamond: the next one and any later.
    const hearings = caseHearings(c).map((h) => ({ ms: datePartsToMs(h.date), note: h.note }));
    const points = [...court, ...notes.map((n) => n.ms)];
    if (points.length === 0) return null;

    let start = Math.min(...points);
    let end = Math.max(generatedMs, ...hearings.map((h) => h.ms), ...points);
    const pad = Math.max((end - start) * 0.03, 3 * DAY);
    start -= pad;
    end += pad;
    const x = (ms) => ((ms - start) / (end - start)) * 100;

    // Month labels, thinned to at most ~6 so they never collide.
    const months = [];
    const d = new Date(start);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    while (d.getTime() < end) {
      months.push(new Date(d));
      d.setMonth(d.getMonth() + 1);
    }
    const step = Math.max(1, Math.ceil(months.length / 6));
    const today = x(generatedMs);
    const labels = months
      .filter((_, i) => i % step === 0)
      .map((mo) => ({ mo, x: x(mo.getTime()) }))
      // Keep clear of the edges; the "today" label wins any collision.
      .filter((l) => l.x > 4 && l.x < 96 && Math.abs(l.x - today) > 11)
      // Year on the first label shown and on each January.
      .map((l, i) => ({
        x: l.x,
        text:
          monFmt.format(l.mo) +
          (i === 0 || l.mo.getMonth() === 0 ? ` ’${String(l.mo.getFullYear()).slice(2)}` : ''),
      }));

    return { court, notes, hearings, x, labels, today };
  }, [c, generatedMs]);

  if (!m) return null;

  const show = (lane, ms, text) => () => setTip({ lane, x: m.x(ms), text });
  const hide = () => setTip(null);
  const tipEl = (lane) =>
    tip && tip.lane === lane ? (
      <span
        className={`tl-tip${tip.x < 22 ? ' tl-tip-l' : tip.x > 78 ? ' tl-tip-r' : ''}`}
        style={{ left: `${tip.x}%` }}
        role="status"
      >
        {tip.text}
      </span>
    ) : null;

  const nCourt = m.court.length;
  const nNotes = m.notes.length;
  const isUpcoming = (ms) => ms >= generatedMs - DAY;
  const hearingTip = (h) =>
    `Hearing · ${dayFmt.format(h.ms)}${h.note ? ` · ${clip(h.note, 80)}` : ''}`;
  const summary =
    `${nCourt} court-record change${nCourt === 1 ? '' : 's'} and ` +
    `${nNotes} newsroom note${nNotes === 1 ? '' : 's'}` +
    (m.hearings.length
      ? `; hearing${m.hearings.length === 1 ? '' : 's'} ${m.hearings.map((h) => dayFmt.format(h.ms)).join(' and ')}`
      : '');

  return (
    <figure className="tl" aria-label={`Case timeline: ${summary}. Details are in the activity list.`}>
      <div className="tl-lane">
        <span className="tl-lab"><i className="tl-key tl-key-court" aria-hidden="true" />Court record</span>
        <span className="tl-plot">
          <svg className="tl-track" width="100%" height="24" aria-hidden="true">
            <line className="tl-base" x1="0" x2="100%" y1="12" y2="12" />
            <line className="tl-today" x1={`${m.today}%`} x2={`${m.today}%`} y1="0" y2="24" />
            {m.court.map((ms, i) => (
              <g key={`${ms}-${i}`}>
                <line className="tl-tick" style={{ '--i': Math.min(i, 24) }} x1={`${m.x(ms)}%`} x2={`${m.x(ms)}%`} y1="5" y2="19" />
                <line
                  className="tl-hit"
                  x1={`${m.x(ms)}%`}
                  x2={`${m.x(ms)}%`}
                  y1="0"
                  y2="24"
                  onMouseEnter={show('court', ms, `Court record updated · ${dayFmt.format(ms)}`)}
                  onMouseLeave={hide}
                  onClick={show('court', ms, `Court record updated · ${dayFmt.format(ms)}`)}
                />
              </g>
            ))}
          </svg>
          {tipEl('court')}
        </span>
      </div>

      <div className="tl-lane">
        <span className="tl-lab"><i className="tl-key tl-key-wpr" aria-hidden="true" />Newsroom</span>
        <span className="tl-plot">
          <svg className="tl-track" width="100%" height="24" aria-hidden="true">
            <line className="tl-base" x1="0" x2="100%" y1="12" y2="12" />
            <line className="tl-today" x1={`${m.today}%`} x2={`${m.today}%`} y1="0" y2="24" />
            {m.notes.map((n, i) => (
              <svg key={`${n.ms}-${i}`} x={`${m.x(n.ms)}%`} y="12" overflow="visible">
                <circle className="tl-dot" style={{ '--i': Math.min(i, 24) }} r="5" />
                <circle
                  className="tl-hit-dot"
                  r="11"
                  onMouseEnter={show('wpr', n.ms, `${dayFmt.format(n.ms)} · ${clip(n.note)}`)}
                  onMouseLeave={hide}
                  onClick={show('wpr', n.ms, `${dayFmt.format(n.ms)} · ${clip(n.note)}`)}
                />
              </svg>
            ))}
            {m.hearings.map((h, i) => (
              <svg key={`h-${h.ms}-${i}`} x={`${m.x(h.ms)}%`} y="12" overflow="visible">
                <rect
                  className={`tl-hearing${isUpcoming(h.ms) ? '' : ' tl-hearing-past'}`}
                  x="-4.5"
                  y="-4.5"
                  width="9"
                  height="9"
                  transform="rotate(45)"
                />
                <circle
                  className="tl-hit-dot"
                  r="11"
                  onMouseEnter={show('wpr', h.ms, hearingTip(h))}
                  onMouseLeave={hide}
                  onClick={show('wpr', h.ms, hearingTip(h))}
                />
              </svg>
            ))}
          </svg>
          {tipEl('wpr')}
        </span>
      </div>

      <div className="tl-lane tl-axis" aria-hidden="true">
        <span className="tl-lab" />
        <span className="tl-plot tl-months">
          {m.labels.map((l) => (
            <span key={l.x} style={{ left: `${l.x}%` }}>{l.text}</span>
          ))}
          <span className="tl-now" style={{ left: `${m.today}%` }}>today</span>
        </span>
      </div>

      <figcaption className="tl-cap">
        <span>
          <b>{nCourt}</b> court-record change{nCourt === 1 ? '' : 's'} &middot;{' '}
          <b>{nNotes}</b> newsroom note{nNotes === 1 ? '' : 's'}
          {c.firstTrackedAt && <> &middot; tracked since {dayFmt.format(Date.parse(c.firstTrackedAt))}</>}
        </span>
        {m.hearings.length > 0 && (
          <span className="tl-legend">
            <i className="tl-key tl-key-hearing" aria-hidden="true" />hearing date{m.hearings.length === 1 ? '' : 's'}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
