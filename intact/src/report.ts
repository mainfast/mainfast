import { BRAND } from "./brand.ts";
import type { CheckReport, Finding, MergeReport } from "./types.ts";

const LEVEL_LABEL = { error: "ERROR", warning: "WARN ", notice: "NOTE ", off: "OFF  " } as const;

const STATUS_LABEL: Record<MergeReport["status"], string> = {
  clean: "ok    clean (identical to the automatic merge)",
  "conflict-resolution": "ok    conflicts resolved, nothing dropped",
  findings: "FAIL  findings",
  unsupported: "skip  unsupported",
  "not-a-merge": "skip  not a merge commit",
  error: "ERROR analysis failed",
};

export function lineRef(f: Finding): string {
  if (!f.mergeLines) return f.path;
  const { start, end } = f.mergeLines;
  return end > start ? `${f.path}:${start}-${end}` : `${f.path}:${start}`;
}

function quote(lines: string[] | undefined, prefix: string, max = 6): string[] {
  if (!lines || lines.length === 0) return [];
  const shown = lines.slice(0, max).map((l) => `${prefix}${l}`);
  if (lines.length > max) shown.push(`${prefix}... (${lines.length - max} more)`);
  return shown;
}

export function formatFinding(f: Finding, indent = "    "): string[] {
  const out: string[] = [];
  const tag = f.side ? `${f.kind} (${f.side})` : f.kind;
  out.push(`${indent}${LEVEL_LABEL[f.level]} ${tag}  ${lineRef(f)}${f.conflicted ? "  [conflicted file]" : ""}`);
  const sub = indent + "      ";
  out.push(`${sub}${f.message}`);
  if (f.parentPath) out.push(`${sub}path on that side: ${f.parentPath}`);
  if (f.commit) {
    const who = f.kind === "evil" ? "merge commit" : "introduced by";
    out.push(`${sub}${who} ${f.commit.short} "${f.commit.subject}" (${f.commit.author} <${f.commit.email}>)`);
  }
  if (f.kind === "evil") {
    out.push(...quote(f.added, `${sub}+ `));
    out.push(...quote(f.removed, `${sub}- `));
  } else {
    if (f.added?.length) {
      out.push(`${sub}${f.side ?? "side"} added:`);
      out.push(...quote(f.added, `${sub}  + `));
    }
    if (f.removed?.length) {
      out.push(`${sub}${f.side ?? "side"} removed:`);
      out.push(...quote(f.removed, `${sub}  - `));
    }
    if (f.actual) {
      out.push(`${sub}merge has:`);
      out.push(...(f.actual.length ? quote(f.actual, `${sub}    `) : [`${sub}    (nothing)`]));
    }
  }
  return out;
}

export function formatMerge(m: MergeReport): string[] {
  const out: string[] = [];
  out.push(`${STATUS_LABEL[m.status].slice(0, 5)} ${m.merge.short} ${m.merge.subject}`);
  const detail = STATUS_LABEL[m.status].slice(6);
  const facts: string[] = [detail];
  if (m.strategy) facts.push(`via ${m.strategy}`);
  out.push(`      ${facts.join(", ")}`);
  if (m.conflictedFiles.length) out.push(`      conflicted: ${m.conflictedFiles.join(", ")}`);
  for (const n of m.notes) out.push(`      note: ${n}`);
  if (m.error) out.push(`      error: ${m.error}`);
  for (const g of groupFindings(m.findings)) {
    out.push(...formatFinding(g[0]!));
    if (g.length > 1) {
      const refs = g.slice(1).map((f) => (f.mergeLines ? String(f.mergeLines.start) : "file"));
      const shown = refs.slice(0, 30).join(", ") + (refs.length > 30 ? `, ... (${refs.length - 30} more)` : "");
      out.push(`          and ${g.length - 1} more ${g[0]!.kind} hunk${g.length === 2 ? "" : "s"} like it in ${g[0]!.path} at line ${shown}`);
      out.push(`          (a resolution that took one side's whole file looks like this; --json lists every hunk)`);
    }
  }
  return out;
}

/** Hunks of one kind from one side in one file; groups of up to GROUP_AFTER stay expanded. */
const GROUP_AFTER = 3;
export function groupFindings(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.path}\0${f.kind}\0${f.side ?? ""}\0${f.level}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const out: Finding[][] = [];
  for (const g of groups.values()) {
    if (g.length > GROUP_AFTER) out.push(g);
    else for (const f of g) out.push([f]);
  }
  return out;
}

export function formatHuman(r: CheckReport): string {
  const out: string[] = [];
  const scope = r.range ? ` in ${r.range}` : "";
  out.push(`${BRAND.productName} ${r.version}: ${r.merges.length} merge commit${r.merges.length === 1 ? "" : "s"}${scope}${r.mainRef ? ` (main: ${r.mainRef})` : ""}`);
  if (r.merges.length === 0) {
    out.push("nothing to check");
    return out.join("\n") + "\n";
  }
  out.push("");
  for (const m of r.merges) {
    out.push(...formatMerge(m));
    out.push("");
  }
  const s = r.summary;
  out.push(
    `summary: ${s.clean} clean, ${s.conflictResolution} resolved, ${s.withFindings} with findings` +
      `${s.unsupported ? `, ${s.unsupported} unsupported` : ""}${s.errors ? `, ${s.errors} errors` : ""}` +
      ` | ${s.findings.error} error, ${s.findings.warning} warning, ${s.findings.notice} notice`,
  );
  return out.join("\n") + "\n";
}

/** Markdown for GitHub job summaries and check-run output. */
export function formatMarkdown(r: CheckReport): string {
  const s = r.summary;
  const out: string[] = [];
  const failed = s.findings.error + s.findings.warning > 0 || s.errors > 0;
  out.push(`## ${BRAND.productName}: ${failed ? "merge dropped or invented changes" : "merges intact"}`);
  out.push("");
  out.push(`${r.merges.length} merge commit(s) checked${r.range ? ` in \`${r.range}\`` : ""}. ` +
    `${s.findings.error} error, ${s.findings.warning} warning, ${s.findings.notice} notice.`);
  out.push("");
  for (const m of r.merges) {
    out.push(`### \`${m.merge.short}\` ${escapeMd(m.merge.subject)}: ${m.status}`);
    if (m.conflictedFiles.length) out.push(`Conflicted: ${m.conflictedFiles.map((p) => `\`${p}\``).join(", ")}`);
    for (const n of m.notes) out.push(`> ${escapeMd(n)}`);
    if (m.error) out.push(`> error: ${escapeMd(m.error)}`);
    if (m.findings.length) {
      out.push("");
      for (const g of groupFindings(m.findings)) {
        const f = g[0]!;
        const who = f.commit ? ` (${f.kind === "evil" ? "merge" : "from"} \`${f.commit.short}\` ${escapeMd(f.commit.subject)}, ${escapeMd(f.commit.author)})` : "";
        out.push(`- **${f.level}** ${f.kind}${f.side ? ` (${f.side})` : ""} \`${lineRef(f)}\`: ${escapeMd(f.message)}${who}`);
        const snippet = [...(f.added ?? []).map((l) => `+ ${l}`), ...(f.removed ?? []).map((l) => `- ${l}`)].slice(0, 8);
        if (snippet.length) {
          out.push("  ```diff");
          for (const l of snippet) out.push(`  ${l}`);
          out.push("  ```");
        }
        if (g.length > 1) {
          const refs = g.slice(1).map((x) => (x.mergeLines ? String(x.mergeLines.start) : "file")).slice(0, 30);
          out.push(`  - and ${g.length - 1} more like it at line ${refs.join(", ")}${g.length - 1 > 30 ? ", ..." : ""}`);
        }
      }
    }
    out.push("");
  }
  return out.join("\n");
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, "\\$1");
}
