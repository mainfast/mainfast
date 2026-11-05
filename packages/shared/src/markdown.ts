// Escaping for text we did not write (file paths, migration and revision names, branch names,
// PR titles, commit subjects, check names and summaries from other apps, PR-description quotes)
// before it goes into a PR comment, a check-run summary or a job summary, which GitHub renders as
// Markdown with some HTML. Every untrusted value goes through one of these; nothing untrusted is
// interpolated raw. Shared by every Mainfast check (first written for Evidence, commit cc1037a).
//
// - `mdText`: HTML-encodes & < > (so `<!--` / `-->` can never open or close an HTML comment, hide
//   the rest of the comment, or forge a sticky-comment marker), backslash-escapes the Markdown
//   metacharacters \ ` * _ [ ] ( ) ! # | ~, and neutralises `@login` / `@org/team` mentions with a
//   zero-width space after the `@` (an attacker-chosen branch or file name must not ping people).
//   Safe inside a table cell.
// - `mdCode`: a code span whose backtick fence is longer than any backtick run inside it. Not for
//   table cells (GFM splits cells on `|` even inside code spans); use `mdText` there. GitHub does
//   not resolve mentions inside code spans.
// - `mdInline`: our own detail strings use `backticks` for paths and snippets; this renders those
//   segments with `mdCode` and everything else with `mdText`. Backticks an attacker adds only move
//   the code/text boundary; both sides are escaped, so no input can inject Markdown or HTML.
// All three collapse newlines (one list item / one cell stays one line) and cap length.
// `plainText` is for check-run annotation and title fields, which GitHub shows as plain text.

export const MAX_INLINE = 500;

const NEWLINES = /\r\n|[\r\n\u2028\u2029\u0085]/g;
// C0/C1 controls except tab; bidi overrides and isolates (can make text read differently).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Cut to `max` characters (by code point), marking the cut. */
export function cap(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : `${cps.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** One line: newlines become spaces, control characters are dropped, tabs become spaces. */
export function oneLine(s: string): string {
  return s.replace(NEWLINES, " ").replace(/\t/g, " ").replace(CONTROL, "");
}

const MD_SPECIAL = /[&<>\\`*_[\]()!#|~]/g;
const HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** `@name` -> `@\u200Bname`: GitHub no longer reads it as a mention (users, `org/team`). */
export function noMentions(s: string): string {
  return s.replace(/@(?=[A-Za-z0-9])/g, "@\u200B");
}

/** Untrusted text as inert Markdown (one line, capped, no mentions). */
export function mdText(s: string, max = MAX_INLINE): string {
  return noMentions(cap(oneLine(s), max).replace(MD_SPECIAL, (ch) => HTML[ch] ?? `\\${ch}`));
}

/** Untrusted text as a code span (one line, capped). Do not use inside a table cell. */
export function mdCode(s: string, max = MAX_INLINE): string {
  const body = cap(oneLine(s), max);
  if (!body.trim()) return mdText(body);
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  // CommonMark strips one leading and trailing space when both are present; pad when the content
  // starts or ends with a backtick (it would merge with the fence) or with a space (it would be eaten).
  const pad = /^[` ]|[` ]$/.test(body) ? " " : "";
  return `${fence}${pad}${body}${pad}${fence}`;
}

/** A string that uses `backticks` for code-like parts: code parts become safe code spans, the rest `mdText`. */
export function mdInline(s: string, max = MAX_INLINE): string {
  const t = cap(oneLine(s), max);
  let out = "";
  let last = 0;
  for (const m of t.matchAll(/`([^`]+)`/g)) {
    out += mdText(t.slice(last, m.index), Infinity) + mdCode(m[1]!, Infinity);
    last = m.index + m[0].length;
  }
  return out + mdText(t.slice(last), Infinity);
}

/** Plain-text field (annotation message/title, check-run title): controls dropped, capped; newlines kept unless `singleLine`. */
export function plainText(s: string, max: number, singleLine = false): string {
  const t = singleLine ? oneLine(s) : s.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  return cap(t, max);
}

/** Only an https URL with no characters that could break out of `(...)` in a Markdown link. */
export function safeUrl(u: string | undefined): string | undefined {
  return u && /^https:\/\/[^\s()<>\\`"']+$/.test(u) ? u : undefined;
}

/**
 * `mdInline` for a GFM table cell: code spans keep their look, and a `|` inside one is written as
 * `\|`, which GFM unescapes inside code spans in tables instead of splitting the cell there.
 */
export function mdCell(s: string, max = MAX_INLINE): string {
  const t = cap(oneLine(s), max);
  let out = "";
  let last = 0;
  for (const m of t.matchAll(/`([^`]+)`/g)) {
    out += mdText(t.slice(last, m.index), Infinity) + mdCode(m[1]!, Infinity).replace(/\|/g, "\\|");
    last = m.index + m[0].length;
  }
  return out + mdText(t.slice(last), Infinity);
}
