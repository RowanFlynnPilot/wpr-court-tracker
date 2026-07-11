import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// When embedded, report rendered height so the WordPress iframe can size
// itself (listener snippet in README "Embed"). Payload is just a number;
// '*' is fine.
if (window.parent !== window) {
  let last = 0;
  const report = () => {
    const height = document.documentElement.scrollHeight;
    if (height === last) return;
    last = height;
    window.parent.postMessage({ source: 'wpr-court-tracker', height }, '*');
  };
  // Observe body, not documentElement: body's box tracks rendered content
  // (folders opening, feed loading), which is what must drive the resize.
  new ResizeObserver(report).observe(document.body);
  // Belt and suspenders for webviews that starve the render loop (where
  // ResizeObserver never fires): re-measure after any interaction, and a
  // few times after load while the feed and fonts come in.
  document.addEventListener('click', () => setTimeout(report, 60));
  window.addEventListener('load', () => {
    report();
    for (const ms of [400, 1200, 3000]) setTimeout(report, ms);
  });
}
