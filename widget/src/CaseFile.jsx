import React, { useEffect, useMemo, useState } from 'react';
import { datePartsToMs, upcomingHearings } from './App.jsx';
import Timeline from './Timeline.jsx';
import { linkLabel } from './linkLabel.js';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
});
const tsFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'America/Chicago',
});

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

export default function CaseFile({ c, generatedMs, presumptionNote, isNew, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  // A case's first week on the watchlist gets its own (teal) stamp -
  // otherwise a just-added case with an old docket looks dormant on debut.
  const newlyTracked =
    c.firstTrackedAt && generatedMs - Date.parse(c.firstTrackedAt) < 7 * 86400000;

  // The docket strip opens a case remotely (hash navigation handles the
  // scroll; this handles the folder).
  useEffect(() => {
    const onOpen = (e) => e.detail === c.id && setOpen(true);
    window.addEventListener('wpr-open-case', onOpen);
    return () => window.removeEventListener('wpr-open-case', onOpen);
  }, [c.id]);

  const copyLink = async () => {
    // Canonical standalone URL: works from the article embed and the
    // GitHub Pages page alike.
    const url = `${window.location.origin}${window.location.pathname}#${c.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const ledger = useMemo(() => {
    const rows = [];
    (c.updates ?? []).forEach((u, i) => {
      rows.push({ ms: datePartsToMs(u.date), kind: 'wpr', note: u.note, key: `w${i}-${u.date}` });
    });
    for (const o of c.observed ?? []) {
      rows.push({ ms: Date.parse(o.updated), kind: 'court', key: o.guid });
    }
    return rows.sort((a, b) => b.ms - a.ms);
  }, [c]);

  // Runs of 3+ consecutive court-record pings fold into one row, so a busy
  // docket never buries the reporter's notes. Readers can unfold any run.
  const [unfolded, setUnfolded] = useState(() => new Set());
  const toggleRun = (key) =>
    setUnfolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const display = useMemo(() => {
    const out = [];
    let run = [];
    const flush = () => {
      // Keyed on the run's OLDEST ping so the fold state survives new activity.
      if (run.length >= 3) out.push({ kind: 'run', rows: run, key: `run-${run[run.length - 1].key}` });
      else out.push(...run);
      run = [];
    };
    for (const row of ledger) {
      if (row.kind === 'court') run.push(row);
      else {
        flush();
        out.push(row);
      }
    }
    flush();
    return out;
  }, [ledger]);

  const ledgerRow = (row) => (
    <li key={row.key} className={`ledger-row ledger-${row.kind}`}>
      <span className="ledger-date mono">{tsFmt.format(row.ms)}</span>
      <span className="ledger-note">
        {row.kind === 'wpr' ? (
          row.note
        ) : (
          <>Court record updated &mdash;{' '}
            <a href={c.wccaUrl} target="_blank" rel="noreferrer">view the docket on WCCA</a>
          </>
        )}
      </span>
    </li>
  );

  // The bar shows the soonest hearing still ahead; any others already on
  // the calendar (a trial set behind a motion hearing) are listed under it.
  const upcoming = useMemo(() => upcomingHearings(c, startOfToday()), [c]);
  const nextUp = upcoming[0];
  const laterUp = upcoming.slice(1);

  // All-day .ics events as a data URI - no backend, works from the iframe.
  // All-day on purpose: hearing times live in free-text notes; a wrong
  // parsed time on a reader's calendar is worse than no time. One file
  // carries every upcoming hearing on the case.
  const icsHref = useMemo(() => {
    if (!upcoming.length) return null;
    const esc = (s) => s.replace(/([,;\\])/g, '\\$1');
    const seen = new Set();
    const events = upcoming.flatMap((h) => {
      const start = h.date.replaceAll('-', '');
      if (seen.has(start)) return [];
      seen.add(start);
      const nextDay = new Date(datePartsToMs(h.date) + 86400000);
      const end =
        `${nextDay.getFullYear()}` +
        `${String(nextDay.getMonth() + 1).padStart(2, '0')}` +
        `${String(nextDay.getDate()).padStart(2, '0')}`;
      return [
        'BEGIN:VEVENT',
        `UID:${c.caseNo}-${start}@wpr-court-tracker`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${esc(`Hearing: ${c.headline}`)}`,
        `DESCRIPTION:${esc(`${h.note || ''} (Case ${c.caseNo}, ${c.county} County)`)}`,
        `URL:${c.wccaUrl}`,
        'END:VEVENT',
      ];
    });
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Wausau Pilot & Review//Court Tracker//EN',
      ...events,
      'END:VCALENDAR',
    ];
    return (
      'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'))
    );
  }, [c, upcoming]);
  const lastActivity = ledger.length ? ledger[0].ms : null;
  const isClosed = c.status === 'closed';
  // One word on where the case stands, chosen by a reporter (optional).
  // A closed file says so whatever stage it last carried.
  const stageText = isClosed ? 'Closed' : c.stageLabel;
  const detailId = `detail-${c.id}`;
  // Story links are dated against the year the feed was built.
  const thisYear = new Date(generatedMs || Date.now()).getFullYear();

  return (
    <article id={c.id} className={`folder${c.placeholder ? ' folder-sample' : ''}${open ? ' folder-open' : ''}`}>
      <div className="folder-tabrow">
        <span className="folder-tab">{c.caseTypeLabel}</span>
        {isNew && <span className="stamp">New activity</span>}
        {newlyTracked && !isNew && <span className="stamp stamp-teal">Newly tracked</span>}
        {c.placeholder && <span className="sample-flag">Sample</span>}
      </div>
      <div className="folder-body">
        <div className="folder-head">
          <div>
            {stageText && (
              <p className="case-stage">
                <span className="sr-only">Where the case stands: </span>
                <span className={`stage-chip${isClosed ? ' stage-closed' : ''}`}>{stageText}</span>
              </p>
            )}
            <h2 className="case-headline">{c.headline}</h2>
            <p className="case-meta">
              {c.county} County
              {c.officialCaption && <> &middot; {c.officialCaption}</>}
            </p>
          </div>
          <button
            className="toggle toggle-head"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close file' : 'Open file'}
          </button>
        </div>

        <p className="case-summary">{c.summary}</p>

        {nextUp ? (
          <p className="hearing">
            <span className="hearing-date mono">
              {dateFmt.format(datePartsToMs(nextUp.date))}
            </span>
            <span className="hearing-what">
              {nextUp.note || 'Hearing scheduled'}
              {laterUp.map((h) => (
                <span key={`${h.date}-${h.note}`} className="hearing-later">
                  <span className="hearing-later-lab">Also set</span>
                  <span className="mono hearing-later-date">{dateFmt.format(datePartsToMs(h.date))}</span>
                  {h.note || 'Hearing scheduled'}
                </span>
              ))}
              <span className="hearing-caveat">
                Court dates can change. Check{' '}
                <a href={c.wccaUrl} target="_blank" rel="noreferrer">the docket</a>{' '}
                before you go.
              </span>
            </span>
            <a
              className="hearing-ics"
              href={icsHref}
              download={`hearing-${c.caseNo}.ics`}
            >
              Add to calendar
            </a>
          </p>
        ) : (
          !isClosed && (
            <p className="hearing hearing-none">
              <span className="hearing-label">What&rsquo;s next</span>
              <span className="hearing-what">
                No upcoming hearing on file. The court&rsquo;s calendar is on{' '}
                <a href={c.wccaUrl} target="_blank" rel="noreferrer">the docket</a>.
              </span>
            </p>
          )
        )}

        {!c.placeholder && <Timeline c={c} generatedMs={generatedMs} />}

        <p className="case-tags">
          {c.tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
          {lastActivity && (
            <span className="last-activity mono">
              Last activity {tsFmt.format(lastActivity)}
            </span>
          )}
        </p>

        {/* Unfolds by animating a grid row from 0fr to 1fr; visibility
            keeps the closed file out of the tab order and reading order. */}
        <div id={detailId} className={`detail-wrap${open ? ' is-open' : ''}`}>
        <div className="detail-clip">
        <div className="detail">
          {c.isCriminal && <p className="presumption">{presumptionNote}</p>}
          <div className="ledger-head">
            <h3 className="ledger-title">Activity</h3>
            <span className="case-no mono">
              Case no. {c.caseNo}
              {c.firstTrackedAt && (
                <> &middot; tracked since {tsFmt.format(Date.parse(c.firstTrackedAt))}</>
              )}
            </span>
          </div>
          {ledger.length === 0 ? (
            <p className="ledger-empty">No activity logged yet. We&rsquo;re watching this file.</p>
          ) : (
            <ol className="ledger">
              {display.flatMap((row) => {
                if (row.kind !== 'run') return [ledgerRow(row)];
                const n = row.rows.length;
                if (unfolded.has(row.key)) {
                  return [
                    ...row.rows.map(ledgerRow),
                    <li key={`${row.key}-fold`} className="ledger-row ledger-fold">
                      <span />
                      <button className="linkbtn" onClick={() => toggleRun(row.key)}>
                        Fold these {n} court-record updates
                      </button>
                    </li>,
                  ];
                }
                const newest = row.rows[0].ms;
                const oldest = row.rows[n - 1].ms;
                return [
                  <li key={row.key} className="ledger-row ledger-court ledger-run">
                    <span className="ledger-date mono">{tsFmt.format(newest)}</span>
                    <span className="ledger-note">
                      Court record updated <b>{n} times</b> between{' '}
                      {tsFmt.format(oldest)} and {tsFmt.format(newest)} &mdash;{' '}
                      <a href={c.wccaUrl} target="_blank" rel="noreferrer">view the docket on WCCA</a>
                      {' '}
                      <button
                        className="linkbtn ledger-more"
                        aria-expanded="false"
                        onClick={() => toggleRun(row.key)}
                      >
                        Show each date
                      </button>
                    </span>
                  </li>,
                ];
              })}
            </ol>
          )}
          <p className="detail-links">
            {(c.links ?? []).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{linkLabel(l, thisYear)}</a>
            ))}
            <a href={c.wccaUrl} target="_blank" rel="noreferrer">Full court record (WCCA)</a>
            <button className="linkbtn" aria-live="polite" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link to this case'}
            </button>
          </p>
        </div>
        </div>
        </div>

        {/* Phone layout: the button sits at the foot, full width, where
            the thumb is (the head one is hidden there). */}
        <button
          className="toggle toggle-foot"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close file' : 'Open file'}
        </button>
      </div>
    </article>
  );
}
