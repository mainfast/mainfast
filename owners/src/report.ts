// Renders the report. Every value that did not come from this file (file paths, CODEOWNERS
// patterns and lines, owners, team slugs, branch names, GitHub's own error text) goes through
// the suite's escaping helpers (@mainfast/shared/markdown): the Markdown lands in a PR comment
// and the job summary, both rendered by GitHub. Paths are code spans (no HTML, no mentions, no
// links); table cells use mdCell; our detail strings put untrusted parts in `backticks`.
import { mdCell, mdCode, mdText, oneLine, plainText, safeUrl } from '@mainfast/shared/markdown';
import { DOCS_URL, PRODUCT } from './brand.js';
import type { Finding, OwnersReport } from './types.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

const MAX_PATHS = 50;
const MAX_ROWS = 100;
const MAX_MD = 65_000;

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? `/${p}` : `/${p.slice(0, i)}/`;
}

/** A path as a CODEOWNERS pattern: spaces and a leading `#` escaped, one line. */
export function codeownersPattern(p: string): string {
  return oneLine(p).replace(/[\\ ]/g, (c) => `\\${c}`).replace(/^#/, '\\#');
}

/** A fenced code block whose fence is longer than any backtick run inside. */
export function codeBlock(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((x) => x.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

const errors = (fs: Finding[]) => fs.filter((f) => f.severity === 'error').length;
const short = (ref?: string) => (ref && /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref);

/** One plain line (CLI, check titles); no Markdown. */
export function headline(r: OwnersReport): string {
  const current = r.findings.filter((f) => f.scope === 'current');
  const proposed = r.findings.filter((f) => f.scope === 'proposed');
  if (r.mode === 'pr') {
    const files = r.unowned.length ? `${r.unowned.length} of ${plural(r.checkedFiles, "changed file")} ${r.unowned.length === 1 ? "has" : "have"} no code owner` : 'every changed file has a code owner';
    const pe = errors(proposed);
    const pw = proposed.length - pe;
    const p = r.proposed ? (proposed.length ? `; this PR's CODEOWNERS: ${plural(pe, "error")}, ${plural(pw, "warning")}` : "; this PR's CODEOWNERS looks right") : '';
    return plainText(`${files}${p}`, 255, true);
  }
  const e = errors(current);
  return plainText(
    current.length ? `${plural(e, "error")}, ${plural(current.length - e, "warning")} in ${r.codeownersPath ?? 'CODEOWNERS'}` : `${r.codeownersPath ?? 'CODEOWNERS'} is healthy`,
    255,
    true,
  );
}

function table(fs: Finding[]): string[] {
  const out = ['| | Finding | Detail | Fix |', '|---|---|---|---|'];
  for (const f of fs.slice(0, MAX_ROWS))
    out.push(`| ${f.severity} | \`${f.code}\` | ${mdCell(f.message, 1500)}${f.preexisting ? ' (already on the base branch)' : ''} | ${mdCell(f.hint ?? '', 800)} |`);
  if (fs.length > MAX_ROWS) out.push(`| | | …and ${fs.length - MAX_ROWS} more (see the \`report\` output) | |`);
  return out;
}

export interface MarkdownOptions {
  runUrl?: string;
}

/** PR comment and job summary (under GitHub's 65536-character comment limit). */
export function toMarkdown(r: OwnersReport, o: MarkdownOptions = {}): string {
  const out: string[] = [`### ${PRODUCT}`, '', `**${headline(r)}**${r.pr ? ` (#${r.pr})` : ''}.`, ''];
  if (r.mode === 'pr' && r.unowned.length) {
    const after = new Set(r.ownedAfterMerge);
    out.push(`Judged with ${mdCode(r.codeownersPath ?? 'CODEOWNERS')} on ${mdCode(r.ref ?? 'the base branch')}, the file GitHub uses to request reviews. Unowned paths:`, '');
    for (const p of r.unowned.slice(0, MAX_PATHS)) out.push(`- ${mdCode(p)}${after.has(p) ? " (this PR's CODEOWNERS owns it once merged)" : ''}`);
    if (r.unowned.length > MAX_PATHS) out.push(`- …and ${r.unowned.length - MAX_PATHS} more (see the \`unowned\` output)`);
    const dirs = [...new Set(r.unowned.filter((p) => !after.has(p)).map(dirOf))].slice(0, 10);
    if (dirs.length)
      out.push(
        '',
        `<details><summary>Suggested ${mdText(r.codeownersPath ?? '.github/CODEOWNERS')} lines</summary>`,
        '',
        codeBlock(dirs.map((d) => `${codeownersPattern(d)} @OWNER`).join('\n')),
        '',
        '</details>',
      );
    out.push('');
  }
  const current = r.findings.filter((f) => f.scope === 'current' && !(r.mode === 'pr' && f.code === 'unowned-files'));
  if (current.length) out.push(...table(current), '');
  if (r.proposed) {
    const proposed = r.findings.filter((f) => f.scope === 'proposed');
    const where = r.proposed.path ? `${mdCode(r.proposed.path)} at ${mdCode(short(r.proposed.ref) ?? 'the PR head')}` : 'removed';
    out.push(`#### This PR's CODEOWNERS (${where})`, '');
    out.push(...(proposed.length ? table(proposed) : ['No problems found: valid syntax, every owner can review, no dead or shadowed lines.']), '');
  }
  if (r.notes.length) out.push('**Notes**', '', ...r.notes.map((n) => `- ${mdCell(n, 1000)}`), '');
  const run = safeUrl(o.runUrl);
  out.push(`${run ? `[run](${run}) · ` : ''}[docs](${DOCS_URL})`);
  const md = out.join('\n');
  return md.length > MAX_MD ? `${md.slice(0, MAX_MD)}\n\n…truncated; see the \`report\` output.` : md;
}

/** Plain text for an annotation (GitHub shows it as plain text). */
export function annotationText(f: Finding): string {
  return plainText(`${f.message}${f.preexisting ? ' (already on the base branch)' : ''}${f.hint ? ` Fix: ${f.hint}` : ''}`, 4000, true);
}

/** CLI output. Terminal text: control characters dropped, one line per value. */
export function toText(r: OwnersReport): string {
  const t = (s: string) => plainText(s, 2000, true);
  const out = [t(`${PRODUCT}: ${r.repository}${r.pr ? ` #${r.pr}` : ''} — ${headline(r)}`)];
  for (const f of r.findings) {
    out.push(t(`${f.severity.toUpperCase()} [${f.code}]${f.scope === 'proposed' ? ' (this PR)' : ''} ${f.message}${f.preexisting ? ' (already on the base branch)' : ''}`));
    if (f.code === 'unowned-files' && f.paths) for (const p of f.paths.slice(0, MAX_PATHS)) out.push(`  ${t(p)}`);
    if (f.hint) out.push(t(`  fix: ${f.hint}`));
  }
  for (const n of r.notes) out.push(t(`note: ${n}`));
  out.push(r.ok ? 'ok' : 'FAILED');
  return out.join('\n');
}
