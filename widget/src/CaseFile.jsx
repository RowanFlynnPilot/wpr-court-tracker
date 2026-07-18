import React, { useEffect, useMemo, useState } from 'react';
import { datePartsToMs } from './App.jsx';

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

  const hearingUpcoming =
    c.nextHearing && datePartsToMs(c.nextHearing.date) >= startOfToday();

  // All-day .ics event as a data URI - no backend, works from the iframe.
  // All-day on purpose: hearing times live in free-text notes; a wrong
  // parsed time on a reader's calendar is worse than no time.
  const icsHref = useMemo(() => {
    if (!c.nextHearing) return null;
    const start = c.nextHearing.date.replaceAll('-', '');
    const nextDay = new Date(datePartsToMs(c.nextHearing.date) + 86400000);
    const end =
      `${nextDay.getFullYear()}` +
      `${String(nextDay.getMonth() + 1).padStart(2, '0')}` +
      `${String(nextDay.getDate()).padStart(2, '0')}`;
    const esc = (s) => s.replace(/([,;\\])/g, '\\$1');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Wausau Pilot & Review//Court Tracker//EN',
      'BEGIN:VEVENT',
      `UID:${c.caseNo}-${start}@wpr-court-tracker`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${esc(`Hearing: ${c.headline}`)}`,
      `DESCRIPTION:${esc(`${c.nextHearing.note} (Case ${c.caseNo}, ${c.county} County)`)}`,
      `URL:${c.wccaUrl}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return (
      'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'))
    );
  }, [c]);
  const lastActivity = ledger.length ? ledger[0].ms : null;
  const detailId = `detail-${c.id}`;

  return (
    <article id={c.id} className={`folder${c.placeholder ? ' folder-sample' : ''}`}>
      <div className="folder-tabrow">
        <span className="folder-tab">{c.caseTypeLabel}</span>
        {isNew && <span className="stamp">New activity</span>}
        {newlyTracked && !isNew && <span className="stamp stamp-teal">Newly tracked</span>}
        {c.placeholder && <span className="sample-flag">Sample</span>}
      </div>
      <div className="folder-body">
        <div className="folder-head">
          <div>
            <h2 className="case-headline">{c.headline}</h2>
            <p className="case-meta">
              {c.county} County
              {c.officialCaption && <> &middot; {c.officialCaption}</>}
            </p>
          </div>
          <button
            className="toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close file' : 'Open file'}
          </button>
        </div>

        <p className="case-summary">{c.summary}</p>

        {hearingUpcoming && (
          <p className="hearing">
            <span className="hearing-date mono">
              {dateFmt.format(datePartsToMs(c.nextHearing.date))}
            </span>
            <span>{c.nextHearing.note}</span>
            <a
              className="hearing-ics"
              href={icsHref}
              download={`hearing-${c.caseNo}.ics`}
            >
              Add to calendar
            </a>
          </p>
        )}

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

        <div id={detailId} className="detail" hidden={!open}>
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
              {ledger.map((row) => (
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
              ))}
            </ol>
          )}
          <p className="detail-links">
            {(c.links ?? []).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>
            ))}
            <a href={c.wccaUrl} target="_blank" rel="noreferrer">Full court record (WCCA)</a>
            <button className="linkbtn" aria-live="polite" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link to this case'}
            </button>
          </p>
        </div>
      </div>
    </article>
  );
}
