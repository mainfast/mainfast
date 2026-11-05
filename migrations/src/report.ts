import { DOCS_URL, PRODUCT } from './brand.js';
import type { MigrationsReport } from './engine.js';
import type { Finding } from './types.js';
import { mdCell, mdCode, mdInline, mdText } from '@mainfast/shared/markdown';

// Everything from the repository or the PR (branch names, paths, revision ids, file names inside
// messages) is untrusted: it goes through @mainfast/shared/markdown, never raw.

const short = (sha: string) => sha.slice(0, 7);
const icon = (f: Finding) => (f.severity === 'error' ? 'error' : 'warning');

export function toMarkdown(r: MigrationsReport, opts: { title?: string } = {}): string {
  const lines: string[] = [];
  const errors = r.findings.filter((f) => f.severity === 'error').length;
  const warnings = r.findings.length - errors;
  lines.push(`### ${opts.title ?? PRODUCT}`);
  lines.push('');
  if (!r.roots.length) {
    lines.push('No migration ledgers found.');
    return lines.join('\n');
  }
  lines.push(
    r.findings.length
      ? `**${errors} error(s), ${warnings} warning(s)** merging ${mdCode(r.head.ref, 200)} (${short(r.head.sha)}) into ${mdCode(r.main.ref, 200)} (${short(r.main.sha)}).`
      : `Migration ledgers stay consistent after merging ${mdCode(r.head.ref, 200)} (${short(r.head.sha)}) into ${mdCode(r.main.ref, 200)} (${short(r.main.sha)}).`,
  );
  lines.push('');
  if (r.findings.length) {
    lines.push('| | Framework | Where | Problem | Fix |');
    lines.push('|---|---|---|---|---|');
    for (const f of r.findings)
      lines.push(
        `| ${icon(f)} | ${f.framework} | ${mdText(f.root, 200)} | ${mdCell(f.message, 1000)} | ${f.hint ? mdCell(f.hint, 1000) : ''} |`,
      );
    lines.push('');
  }
  lines.push(
    `<details><summary>Ledgers checked (${r.roots.length})</summary>\n\n` +
      r.roots.map((x) => `- ${x.framework}: ${mdCode(x.root, 200)}${x.touched ? ' (changed in this PR)' : ''}`).join('\n') +
      (r.preExisting.length ? `\n\nAlready on main, not caused by this PR: ${r.preExisting.length}\n` +
        r.preExisting.map((f) => `- ${f.framework} ${mdCode(f.root, 200)}: ${mdInline(f.message, 1000)}`).join('\n') : '') +
      `\n\nmerge-base ${short(r.mergeBase)} · [docs](${DOCS_URL})\n</details>`,
  );
  return lines.join('\n');
}

export function toText(r: MigrationsReport): string {
  const out: string[] = [];
  out.push(`${PRODUCT}: ${r.head.ref} (${short(r.head.sha)}) -> ${r.main.ref} (${short(r.main.sha)}), merge-base ${short(r.mergeBase)}`);
  for (const x of r.roots) out.push(`  checked ${x.framework} ${x.root}${x.touched ? ' (changed)' : ''}`);
  for (const f of r.findings) {
    out.push(`${f.severity.toUpperCase()} ${f.framework} ${f.root} [${f.code}] ${f.message}`);
    if (f.hint) out.push(`  fix: ${f.hint}`);
  }
  for (const f of r.preExisting) out.push(`note (already on main) ${f.framework} ${f.root} [${f.code}] ${f.message}`);
  out.push(r.ok ? 'ok' : 'FAILED');
  return out.join('\n');
}
