import React, { useEffect, useMemo, useState } from 'react';
import CaseFile from './CaseFile.jsx';
import badge from './assets/wpr-badge.png';
import {
  ALLOWED_CASE_TYPES,
  CRIMINAL_CASE_TYPES,
  buildCaseEntry,
  buildIssueUrl,
  caseType,
  extractFromText,
  parseWccaUrl,
} from './parseCase.js';

// Case Entry Desk: newsroom-facing intake form. Paste the case page text
// (or upload a saved file / print-to-PDF); it's parsed ON THIS MACHINE to
// prefill the form; the editor reviews every field against a live preview
// and submits via the prefilled "Track a case" GitHub issue, which the
// validation workflow turns into a sign-off PR. This page never contacts
// the court system.

const FALLBACK_PRESUMPTION =
  'A criminal charge is an accusation. Every defendant is presumed ' +
  'innocent unless and until proven guilty.';
const TOPIC_SUGGESTIONS = ['Courts', 'Public safety', 'Government', 'Open records'];

const EMPTY = {
  wccaUrl: '',
  county: 'Marathon',
  headline: '',
  summary: '',
  topics: '',
  hearingDate: '',
  hearingNote: '',
  updates: [],
  links: [],
};

export default function CaseDesk() {
  const [f, setF] = useState(EMPTY);
  const [sourceText, setSourceText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [fileStatus, setFileStatus] = useState('');
  const [presumptionNote, setPresumptionNote] = useState(FALLBACK_PRESUMPTION);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}feed.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((feed) => feed?.presumptionNote && setPresumptionNote(feed.presumptionNote))
      .catch(() => {});
  }, []);

  const set = (key) => (e) => setF((v) => ({ ...v, [key]: e.target.value }));

  const urlInfo = useMemo(() => {
    if (!f.wccaUrl.trim()) return { state: 'empty' };
    try {
      const { caseNo, countyNo } = parseWccaUrl(f.wccaUrl.trim());
      return { state: 'ok', caseNo, countyNo, type: caseType(caseNo) };
    } catch (e) {
      return { state: 'bad', error: e.message };
    }
  }, [f.wccaUrl]);

  const blocked =
    urlInfo.state === 'ok' && !(urlInfo.type in ALLOWED_CASE_TYPES);
  const mismatch =
    urlInfo.state === 'ok' && parsed?.caseNo && parsed.caseNo !== urlInfo.caseNo;
  const ready =
    urlInfo.state === 'ok' &&
    !blocked &&
    f.headline.trim() &&
    f.summary.trim() &&
    f.topics.trim();

  // Prefill only fields the editor hasn't already typed in.
  const applyParse = (text) => {
    const x = extractFromText(text);
    setParsed(x);
    setF((v) => ({
      ...v,
      county: v.county === 'Marathon' && x.county ? x.county : v.county,
      hearingDate: v.hearingDate || x.nextHearing?.date || '',
      hearingNote: v.hearingNote || x.nextHearing?.note || '',
      updates:
        v.updates.length || !x.filingDate
          ? v.updates
          : [{ date: x.filingDate, note: 'Case filed in circuit court.' }],
    }));
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileStatus(`Reading ${file.name}…`);
    try {
      let text;
      if (/\.pdf$/i.test(file.name)) {
        text = await pdfToText(file);
      } else if (/\.html?$/i.test(file.name)) {
        const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
        text = doc.body?.innerText ?? '';
      } else {
        text = await file.text();
      }
      setSourceText(text);
      applyParse(text);
      setFileStatus(`Read ${file.name} — check the fields on the right.`);
    } catch (err) {
      setFileStatus(`Couldn't read ${file.name}: ${err.message}`);
    }
  };

  const row = (key, blank) => ({
    add: () => setF((v) => ({ ...v, [key]: [...v[key], { ...blank }] })),
    edit: (i, prop) => (e) =>
      setF((v) => {
        const list = v[key].map((r, j) =>
          j === i ? { ...r, [prop]: e.target.value } : r
        );
        return { ...v, [key]: list };
      }),
    remove: (i) => () =>
      setF((v) => ({ ...v, [key]: v[key].filter((_, j) => j !== i) })),
  });
  const updates = row('updates', { date: '', note: '' });
  const links = row('links', { label: '', url: '' });

  const addTopic = (t) =>
    setF((v) => {
      const cur = v.topics.split(',').map((s) => s.trim()).filter(Boolean);
      if (cur.includes(t)) return v;
      return { ...v, topics: [...cur, t].join(', ') };
    });

  const appendToSummary = (line) =>
    setF((v) => ({ ...v, summary: v.summary ? `${v.summary}\n${line}` : line }));

  const copyJson = async () => {
    const json = JSON.stringify(buildCaseEntry(f), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this entry:', json);
    }
  };

  const previewCase =
    urlInfo.state === 'ok' && !blocked && f.headline.trim()
      ? {
          id: 'preview',
          wccaUrl: f.wccaUrl.trim(),
          county: f.county,
          headline: f.headline.trim(),
          summary: f.summary.trim(),
          tags: f.topics.split(',').map((t) => t.trim()).filter(Boolean),
          ...(f.hearingDate
            ? { nextHearing: { date: f.hearingDate, note: f.hearingNote } }
            : {}),
          updates: f.updates.filter((u) => u.date && u.note.trim()),
          links: f.links.filter((l) => l.label.trim() && l.url.trim()),
          caseNo: urlInfo.caseNo,
          caseTypeLabel: ALLOWED_CASE_TYPES[urlInfo.type],
          isCriminal: CRIMINAL_CASE_TYPES.has(urlInfo.type),
          status: 'watching',
          observed: [],
        }
      : null;

  return (
    <main className="shell desk">
      <header className="masthead">
        <img className="badge" src={badge} alt="" width="104" height="104" />
        <div>
          <p className="eyebrow">Wausau Pilot &amp; Review &middot; Newsroom</p>
          <h1>Case Entry Desk</h1>
          <p className="dek">
            Paste a case page (or upload a saved copy), check what the desk
            found, and publish through the sign-off pull request. Nothing
            you paste leaves this page until you submit the reviewed fields.
          </p>
        </div>
      </header>

      <div className="desk-grid">
        <section className="desk-source" aria-labelledby="source-title">
          <h2 id="source-title" className="desk-h">1 &middot; The record</h2>
          <label className="desk-label">
            WCCA case link (paste from your browser)
            <input
              type="url"
              value={f.wccaUrl}
              onChange={set('wccaUrl')}
              placeholder="https://wcca.wicourts.gov/caseDetail.html?caseNo=…&countyNo=37"
            />
          </label>
          {urlInfo.state === 'bad' && <p className="desk-warn">{urlInfo.error}</p>}
          {urlInfo.state === 'ok' && !blocked && (
            <p className="desk-ok">
              <span className="mono">{urlInfo.caseNo}</span> &middot;{' '}
              {ALLOWED_CASE_TYPES[urlInfo.type]}
              {CRIMINAL_CASE_TYPES.has(urlInfo.type) &&
                ' — will carry the presumption-of-innocence note'}
            </p>
          )}
          {blocked && (
            <p className="desk-block" role="alert">
              Case type {urlInfo.type} is not tracked publicly (family,
              juvenile, guardianship and mental-health cases never are).
              This is editorial policy; the pipeline enforces it too.
            </p>
          )}

          <label className="desk-label">
            Case page text — open the case on WCCA, select all, copy, paste here
            <textarea
              rows="9"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              onBlur={() => sourceText.trim() && applyParse(sourceText)}
              placeholder="Paste the whole page — the desk picks out what it can."
            />
          </label>
          <div className="desk-filerow">
            <button
              className="send-alt"
              onClick={() => sourceText.trim() && applyParse(sourceText)}
              disabled={!sourceText.trim()}
            >
              Read the pasted text
            </button>
            <label className="desk-upload">
              or upload a saved copy (.pdf from Print&nbsp;&rarr;&nbsp;Save as PDF, .html, .txt)
              <input type="file" accept=".pdf,.html,.htm,.txt" onChange={handleFile} />
            </label>
          </div>
          {fileStatus && <p className="desk-filestatus" aria-live="polite">{fileStatus}</p>}

          {parsed && (
            <div className="desk-spotted">
              <h3>What the desk spotted</h3>
              {parsed.spotted.length === 0 && (
                <p className="desk-muted">
                  Nothing recognizable — fill the form by hand.
                </p>
              )}
              <ul>
                {parsed.spotted.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {mismatch && (
                <p className="desk-warn" role="alert">
                  Heads up: the pasted record says{' '}
                  <span className="mono">{parsed.caseNo}</span> but the link
                  says <span className="mono">{urlInfo.caseNo}</span>. Make
                  sure the link and the record are the same case.
                </p>
              )}
              {parsed.chargeLines.length > 0 && (
                <>
                  <h4>Charge lines &mdash; click to add to the summary</h4>
                  {parsed.chargeLines.map((c) => (
                    <button key={c} className="desk-chip" onClick={() => appendToSummary(c)}>
                      {c}
                    </button>
                  ))}
                </>
              )}
              {parsed.hearingCandidates.length > 1 && (
                <>
                  <h4>Other dates on the record &mdash; click to use as next hearing</h4>
                  {parsed.hearingCandidates.map((h) => (
                    <button
                      key={h.date + h.note}
                      className="desk-chip"
                      onClick={() =>
                        setF((v) => ({ ...v, hearingDate: h.date, hearingNote: h.note }))
                      }
                    >
                      <span className="mono">{h.date}</span> {h.note}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </section>

        <section className="desk-form" aria-labelledby="form-title">
          <h2 id="form-title" className="desk-h">2 &middot; What readers see</h2>
          <label className="desk-label">
            Headline (published verbatim)
            <input type="text" value={f.headline} onChange={set('headline')} />
          </label>
          <label className="desk-label">
            Summary — why WPR is tracking this case
            <textarea rows="5" value={f.summary} onChange={set('summary')} />
          </label>
          <label className="desk-label">
            Topics (comma-separated filter chips)
            <input type="text" value={f.topics} onChange={set('topics')} />
          </label>
          <p className="desk-chiprow">
            {TOPIC_SUGGESTIONS.map((t) => (
              <button key={t} className="desk-chip" onClick={() => addTopic(t)}>
                + {t}
              </button>
            ))}
          </p>
          <div className="desk-two">
            <label className="desk-label">
              Next hearing date
              <input type="date" value={f.hearingDate} onChange={set('hearingDate')} />
            </label>
            <label className="desk-label">
              Hearing details
              <input
                type="text"
                value={f.hearingNote}
                onChange={set('hearingNote')}
                placeholder="Judicial pretrial, Branch 3, 10:40 a.m."
              />
            </label>
          </div>

          <h3 className="desk-subhead">Timeline entries</h3>
          {f.updates.map((u, i) => (
            <div key={i} className="desk-row">
              <input type="date" value={u.date} onChange={updates.edit(i, 'date')} />
              <input
                type="text"
                value={u.note}
                onChange={updates.edit(i, 'note')}
                placeholder="What happened, in plain English"
              />
              <button className="desk-x" onClick={updates.remove(i)} aria-label="Remove entry">
                &times;
              </button>
            </div>
          ))}
          <button className="send-alt desk-add" onClick={updates.add}>
            + Add timeline entry
          </button>

          <h3 className="desk-subhead">Related links</h3>
          {f.links.map((l, i) => (
            <div key={i} className="desk-row">
              <input
                type="text"
                value={l.label}
                onChange={links.edit(i, 'label')}
                placeholder="WPR coverage"
              />
              <input
                type="url"
                value={l.url}
                onChange={links.edit(i, 'url')}
                placeholder="https://wausaupilotandreview.com/…"
              />
              <button className="desk-x" onClick={links.remove(i)} aria-label="Remove link">
                &times;
              </button>
            </div>
          ))}
          <button className="send-alt desk-add" onClick={links.add}>
            + Add link
          </button>
        </section>
      </div>

      <section className="desk-preview" aria-labelledby="preview-title">
        <h2 id="preview-title" className="desk-h">3 &middot; Preview &mdash; exactly as it will publish</h2>
        {previewCase ? (
          <CaseFile
            c={previewCase}
            generatedMs={Date.now()}
            presumptionNote={presumptionNote}
            isNew={false}
            defaultOpen={true}
          />
        ) : (
          <p className="desk-muted">
            The folder preview appears once the WCCA link and a headline are in.
          </p>
        )}
      </section>

      <section className="desk-actions">
        {ready ? (
          <a className="send" href={buildIssueUrl(f)} target="_blank" rel="noreferrer">
            Review &amp; submit on GitHub
          </a>
        ) : (
          <button className="send" disabled>
            Review &amp; submit on GitHub
          </button>
        )}
        <button className="send-alt" aria-live="polite" onClick={copyJson} disabled={!ready}>
          {copied ? 'Entry copied' : 'Copy JSON entry instead'}
        </button>
        <p className="desk-muted desk-flow">
          Submitting opens a GitHub issue prefilled with these fields. The
          tracker validates it against editorial policy and opens a pull
          request &mdash; <b>merging that PR is the sign-off</b> and
          publishes within minutes.
        </p>
      </section>
    </main>
  );
}

async function pdfToText(file) {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    const parts = [];
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) parts.push('\n');
      else if (parts.length) parts.push(' ');
      parts.push(item.str);
      lastY = y;
    }
    text += `${parts.join('')}\n`;
  }
  return text;
}
