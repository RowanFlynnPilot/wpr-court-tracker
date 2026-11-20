// Reader-facing labels for a case file's story links.
//
// A news story's address usually carries its publication date
// (/2026/10/27/...). When a link has only a generic label such as
// "WPR coverage", that date is added, so two stories on one file can be
// told apart. A label that already carries a number is taken to be one an
// editor dated or described by hand, and is left alone.

const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

// { y, mo, d } read from a /YYYY/MM/DD/ path, or null.
export function storyDate(url) {
  const m = /^https?:\/\/[^/]+\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(url || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

export function linkLabel(link, thisYear = new Date().getFullYear()) {
  const label = (link.label || '').trim();
  const date = storyDate(link.url);
  if (!date || /\d/.test(label)) return label;
  const day = `${AP_MONTHS[date.mo - 1]} ${date.d}`;
  return `${label}, ${day}${date.y === thisYear ? '' : `, ${date.y}`}`;
}
