import React from 'react';
import { datePartsToMs, latestActivity } from './App.jsx';

// Compact list view of the watched cases: one row each, for scanning a
// longer watchlist. Cards stay the default; picking a row switches back to
// cards and opens that file (App owns that hand-off via onPick).

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const tsFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'America/Chicago',
});

export default function CaseList({ cases, isNew, onPick }) {
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return (
    <table className="caselist" aria-label="Tracked cases, list view">
      <thead>
        <tr>
          <th scope="col">Where it stands</th>
          <th scope="col">Case</th>
          <th scope="col">Next hearing</th>
          <th scope="col">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => {
          const hearing = c.nextHearing ? datePartsToMs(c.nextHearing.date) : null;
          const last = latestActivity(c);
          return (
            <tr key={c.id} className="caselist-row">
              <td>
                {c.stageLabel ? (
                  <span className="stage-chip">{c.stageLabel}</span>
                ) : (
                  <span className="caselist-none">Not set</span>
                )}
              </td>
              <td className="caselist-case">
                <a
                  href={`#${c.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onPick(c.id);
                  }}
                >
                  {c.headline}
                </a>
                <span className="caselist-type mono">
                  {c.caseTypeLabel}
                  {c.placeholder && ' · sample'}
                  {isNew(c) && <span className="caselist-new"> &middot; new activity</span>}
                </span>
              </td>
              <td className="caselist-when mono" data-label="Next hearing">
                {hearing != null && hearing >= today ? dayFmt.format(hearing) : <span className="caselist-none">None on file</span>}
              </td>
              <td className="caselist-when mono" data-label="Last activity">
                {last ? tsFmt.format(last) : <span className="caselist-none">None yet</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
