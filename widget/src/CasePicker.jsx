import React, { useEffect, useMemo, useRef, useState } from 'react';
import { latestActivity } from './App.jsx';

// Searchable "Working on" picker for the Case Entry Desk. A native
// <select> stops working past a handful of cases; this is a combobox:
// button -> popover with an autofocused search over headline, case
// number, party names, topics, status and hearing date.

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function haystack(c) {
  return [
    c.headline,
    c.caseNo,
    c.officialCaption,
    c.county,
    c.status,
    ...(c.tags || []),
    c.nextHearing?.date,
    c.nextHearing ? dateFmt.format(new Date(`${c.nextHearing.date}T12:00`)) : null,
    c.nextHearing?.note,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function CasePicker({ tracked, baseId, updateMode, onChoose }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const current = updateMode ? tracked.find((c) => c.id === baseId) : null;

  const results = useMemo(() => {
    const sorted = [...tracked].sort((a, b) => latestActivity(b) - latestActivity(a));
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    const terms = q.split(/\s+/);
    return sorted.filter((c) => {
      const h = haystack(c);
      return terms.every((t) => h.includes(t));
    });
  }, [tracked, query]);

  // Options: "new case" pinned first, then matches.
  const options = useMemo(
    () => [{ id: '', headline: 'A new case' }, ...results],
    [results]
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setActive(0);
    const onDocDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const choose = (id) => {
    onChoose(id);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) choose(options[active].id);
    }
  };

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="picker-value">
          {current ? (
            <>Updating: {current.headline}</>
          ) : (
            'A new case'
          )}
        </span>
        <span className="picker-caret" aria-hidden="true">&#9662;</span>
      </button>

      {open && (
        <div className="picker-pop">
          <input
            ref={inputRef}
            type="search"
            className="picker-search"
            role="combobox"
            aria-expanded="true"
            aria-controls="picker-listbox"
            aria-activedescendant={
              options[active] ? `picker-opt-${options[active].id || 'new'}` : undefined
            }
            placeholder="Search headline, case no., name, date&hellip;"
            aria-label="Search tracked cases"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="picker-list" role="listbox" id="picker-listbox">
            <li
              key="new"
              id="picker-opt-new"
              role="option"
              aria-selected={!updateMode}
              className={`picker-item picker-new${active === 0 ? ' picker-active' : ''}`}
              onMouseEnter={() => setActive(0)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose('');
              }}
            >
              + A new case
            </li>
            {results.map((c, i) => (
              <li
                key={c.id}
                id={`picker-opt-${c.id}`}
                role="option"
                aria-selected={updateMode && c.id === baseId}
                className={`picker-item${active === i + 1 ? ' picker-active' : ''}`}
                onMouseEnter={() => setActive(i + 1)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c.id);
                }}
              >
                <span className="picker-headline">{c.headline}</span>
                <span className="picker-meta">
                  <span className="mono">{c.caseNo}</span>
                  {c.status === 'closed' ? ' · closed' : ' · watching'}
                  {' · last activity '}
                  {latestActivity(c) ? dateFmt.format(latestActivity(c)) : '—'}
                  {c.nextHearing && (
                    <> &middot; hearing {dateFmt.format(new Date(`${c.nextHearing.date}T12:00`))}</>
                  )}
                </span>
              </li>
            ))}
            {results.length === 0 && (
              <li className="picker-empty">
                No tracked case matches &mdash; check the spelling, or start a
                new case.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
