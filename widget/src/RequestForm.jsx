import React, { useRef, useState } from 'react';

const KINDS = [
  'Track a case',
  'Help with a records request',
  'News tip about a case',
];

// Collapsed by default: one line and a button, so the case files own the
// page. The form opens in place (the embed's auto-height follows it).
export default function RequestForm({ email }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0]);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [copied, setCopied] = useState(false);
  const firstField = useRef(null);

  const body = () =>
    [
      `Request type: ${kind}`,
      name ? `Name: ${name}` : null,
      '',
      details,
      '',
      '(Sent from the WPR Court Tracker)',
    ]
      .filter((l) => l !== null)
      .join('\n');

  const openDraft = () => {
    const subject = `Court tracker: ${kind}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body())}`;
  };

  // Fallback for devices with no mail app: put the whole message on the
  // clipboard, addressed and ready to paste anywhere.
  const copyMessage = async () => {
    const text = `To: ${email}\nSubject: Court tracker: ${kind}\n\n${body()}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this message:', text);
    }
  };

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) setTimeout(() => firstField.current?.focus(), 0);
  };

  return (
    <section className={`request${open ? ' request-open' : ''}`} aria-labelledby="request-title">
      <div className="request-bar">
        <div>
          <h2 id="request-title">Ask the newsroom</h2>
          <p>Want us to track a case, or need help navigating court records?</p>
        </div>
        <button
          className="send"
          aria-expanded={open}
          aria-controls="request-form"
          onClick={toggle}
        >
          {open ? 'Close' : 'Send a request'}
        </button>
      </div>

      <div id="request-form" hidden={!open}>
        <p className="request-how">
          Fill this in and it opens an email draft to{' '}
          <a href={`mailto:${email}`}>{email}</a>. We read every message.
        </p>
        <div className="request-grid">
          <label>
            What do you need?
            <select ref={firstField} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Your name <span className="optional">(optional)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="request-wide">
            Details &mdash; case number or party name if you have it
            <textarea
              rows="4"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>
        </div>
        <div className="btnrow">
          <button className="send" onClick={openDraft} disabled={!details.trim()}>
            Open email draft
          </button>
          <button className="send-alt" aria-live="polite" onClick={copyMessage} disabled={!details.trim()}>
            {copied ? 'Copied — paste into any email' : 'No mail app? Copy the message'}
          </button>
        </div>
      </div>
    </section>
  );
}
