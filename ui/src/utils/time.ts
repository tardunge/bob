// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" — UTC, but with no
// timezone marker. Without one, `new Date(...)` parses the string as *local*
// time, so users in non-UTC zones see clocks off by their offset. Appending
// 'Z' (and using the 'T' separator) yields ISO 8601 that's unambiguously UTC;
// `toLocale*` methods then render in the browser's own timezone automatically.
export function parseServerTimestamp(ts: string): Date {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(ts)) return new Date(ts);
  return new Date(ts.replace(' ', 'T') + 'Z');
}
