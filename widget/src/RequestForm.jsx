import React, { useState } from 'react';

const KINDS = [
  'Track a case',
  'Help with a records request',
  'News tip about a case',
];

export default function RequestForm({ email }) {
  const [kind, setKind] = useState(KINDS[0]);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [copied, setCopied] = useState(false);

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

  return (
    <section className="request" aria-labelledby="request-title">
      <h2 id="request-title">Ask the newsroom</h2>
      <p>
        Want us to track a case, or need help navigating court records? Tell
        us below &mdash; it opens an email draft to{' '}
        <a href={`mailto:${email}`}>{email}</a>. We read every message.
      </p>
      <div className="request-grid">
        <label>
          What do you need?
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
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
        <button className="send-alt" onClick={copyMessage} disabled={!details.trim()}>
          {copied ? 'Copied — paste into any email' : 'No mail app? Copy the message'}
        </button>
      </div>
    </section>
  );
}
