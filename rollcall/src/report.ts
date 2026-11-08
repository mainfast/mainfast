// Renders the audit. Every value that did not come from this file (check names from other apps,
// workflow paths and job names, ruleset names, branch and repository names, GitHub error text)
// goes through the suite's escaping helpers (@mainfast/shared/markdown): the Markdown lands in a
// check-run summary, the job summary and the tracking issue, all rendered by GitHub.
import { mdCell, mdCode, mdText, plainText, safeUrl } from '@mainfast/shared/markdown';
import { DOCS_URL, PRODUCT } from './brand.js';
import type { AuditReport, Finding } from './types.js';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A code span that is safe inside a GFM table cell. */
const cellCode = (s: string) => mdCode(s).replace(/\|/g, '\\|');
const prRefs = (ns: number[]) => ns.map((n) => `#${n}`).join(', ');

/** Not the same as "none are configured": nothing was audited, and saying so is the point of this check. */
function rulesUnread(r: AuditReport): boolean {
  return !r.required.length && r.notes.some((n) => /\/(rules\/branches\/|rulesets)[^:]*: 403/.test(n));
}

export function title(r: AuditReport): string {
  if (rulesUnread(r)) return 'Required checks could not be read';
  const e = r.findings.filter((f) => f.severity === 'error').length;
  const w = r.findings.length - e;
  return plainText(
    r.findings.length ? `${plural(e, "error")}, ${plural(w, "warning")} in ${plural(r.required.length, "required check")}` : `${plural(r.required.length, "required check")} report as intended`,
    255,
    true,
  );
}

function sampleLine(r: AuditReport): string {
  const total = r.sampledPulls.length + r.sampledOpen.length;
  return `across the last ${r.sampledPulls.length} merged${r.sampledOpen.length ? ` and ${r.sampledOpen.length} open` : ''} ${total === 1 ? 'PR' : 'PRs'}`;
}

export interface MarkdownOptions {
  /** Link to the workflow run. */
  runUrl?: string;
  /** Heading level prefix, default `###`. */
  heading?: string;
}

/** Findings table + tallies, for the job summary, the check-run summary and the tracking issue (under GitHub's 65535-char limit). */
export function toMarkdown(r: AuditReport, o: MarkdownOptions = {}): string {
  const h = o.heading ?? '###';
  const lines: string[] = [`${h} ${PRODUCT}: ${mdCode(r.repository)} → ${mdCode(r.branch)}`, '', `**${title(r)}** ${sampleLine(r)}.`, ''];
  if (!r.required.length) {
    lines.push(
      rulesUnread(r)
        ? '**Not audited:** GitHub refused to show the branch rules (see Notes), so required checks may exist that this run cannot see.'
        : 'No required status checks found in branch protection or active rulesets.',
      '',
    );
  }
  if (r.findings.length) {
    lines.push('| | Finding | Detail | Fix |', '|---|---|---|---|');
    for (const f of r.findings) lines.push(`| ${f.severity} | \`${f.code}\` | ${mdCell(f.message, 1500)} | ${mdCell(f.hint ?? '', 800)} |`);
    lines.push('');
  }
  if (r.tallies.length) {
    lines.push('| Required check | Required by | Passed | Skipped | Neutral | Failed | Pending | Missing | Produced by |', '|---|---|---|---|---|---|---|---|---|');
    for (const t of r.tallies)
      lines.push(
        `| ${cellCode(t.context)} | ${mdCell(t.sources.join(', '))} | ${t.passed}/${t.sampled} | ${t.skipped || ''} | ${t.neutral || ''} | ${t.failed || ''} | ${t.pending || ''} | ${t.missing || ''} | ${
          t.producers.length ? t.producers.map(cellCode).join(', ') : '—'
        } |`,
      );
    lines.push('');
  }
  if (r.notes.length) lines.push('<details><summary>Notes</summary>', '', ...r.notes.map((n) => `- ${mdText(n, 1000)}`), '', '</details>', '');
  const run = safeUrl(o.runUrl);
  lines.push(
    `Sampled merged: ${prRefs(r.sampledPulls) || 'none'}${r.sampledOpen.length ? ` · open: ${prRefs(r.sampledOpen)}` : ''}${run ? ` · [run](${run})` : ''} · [docs](${DOCS_URL})`,
  );
  const md = lines.join('\n');
  return md.length > 65000 ? `${md.slice(0, 65000)}\n\n…truncated; see the JSON output.` : md;
}

/** A fenced code block whose fence is longer than any backtick run inside (JSON can carry backticks from check names). */
export function codeBlock(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((x) => x.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

/** Plain text for an annotation (GitHub shows it as plain text). */
export function annotationText(f: Finding): string {
  return plainText(`${f.message}${f.hint ? ` Fix: ${f.hint}` : ''}`, 4000, true);
}

export function toText(r: AuditReport): string {
  const out = [`${PRODUCT}: ${r.repository} ${r.branch} — ${title(r)} ${sampleLine(r)}`];
  for (const t of r.tallies)
    out.push(
      `  ${t.context}: passed ${t.passed}/${t.sampled}, skipped ${t.skipped}, neutral ${t.neutral}, failed ${t.failed}, pending ${t.pending}, missing ${t.missing} [${t.sources.join(', ')}]`,
    );
  for (const f of r.findings) {
    out.push(`${f.severity.toUpperCase()} [${f.code}] ${f.message}`);
    if (f.hint) out.push(`  fix: ${f.hint}`);
  }
  for (const n of r.notes) out.push(`note: ${n}`);
  out.push(r.ok ? 'ok' : 'FAILED');
  return out.map((l) => plainText(l, 4000, true)).join('\n');
}
