// Changed-line coverage from an lcov or Cobertura report. Optional: no report, no number.
import type { EvidencePolicy } from "../config.ts";
import { matchesAny } from "@mainfast/shared/glob";
import { addedLines } from "../diff/patch.ts";
import type { CoverageReport, FileChange, LineCoverage } from "../types.ts";
import type { Finding } from "./finding.ts";

export function parseLcov(text: string): CoverageReport {
  const files = new Map<string, LineCoverage>();
  let cur: LineCoverage | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const path = line.slice(3);
      cur = files.get(path) ?? { lines: new Map() };
      files.set(path, cur);
    } else if (line.startsWith("DA:") && cur) {
      const [ln, hits] = line.slice(3).split(",");
      const n = Number(ln);
      const h = Number(hits);
      if (Number.isFinite(n) && Number.isFinite(h)) cur.lines.set(n, Math.max(cur.lines.get(n) ?? 0, h));
    } else if (line === "end_of_record") cur = undefined;
  }
  return { format: "lcov", files };
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Cobertura XML (coverage.py `coverage xml`, Istanbul `cobertura`, gocover-cobertura). */
export function parseCobertura(xml: string): CoverageReport {
  const files = new Map<string, LineCoverage>();
  const sources = [...xml.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => decodeXml(m[1]!.trim())).filter(Boolean);
  const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
  for (const m of xml.matchAll(classRe)) {
    const filename = attr(m[1]!, "filename");
    if (!filename) continue;
    const rel = decodeXml(filename);
    // Join with the first <source> root so suffix lookup can disambiguate same-named files.
    const root = sources[0];
    const path = root && !rel.startsWith("/") ? `${root.replace(/\/+$/, "")}/${rel}` : rel;
    const cov = files.get(path) ?? { lines: new Map<number, number>() };
    files.set(path, cov);
    // Only the class's own <lines>, not the per-method copies.
    const body = m[2]!.replace(/<methods>[\s\S]*?<\/methods>/g, "");
    for (const l of body.matchAll(/<line\b([^>]*)\/?>/g)) {
      const n = Number(attr(l[1]!, "number"));
      const h = Number(attr(l[1]!, "hits"));
      if (Number.isFinite(n) && Number.isFinite(h)) cov.lines.set(n, Math.max(cov.lines.get(n) ?? 0, h));
    }
  }
  return { format: "cobertura", files };
}

export function parseCoverage(text: string, nameHint = ""): CoverageReport {
  const t = text.trimStart();
  if (t.startsWith("<") || /\.xml$/i.test(nameHint)) return parseCobertura(text);
  return parseLcov(text);
}

/** Merge several reports (e.g. per-package lcov files). Hit counts take the max. */
export function mergeCoverage(reports: CoverageReport[]): CoverageReport | undefined {
  if (!reports.length) return undefined;
  const files = new Map<string, LineCoverage>();
  for (const r of reports)
    for (const [p, c] of r.files) {
      const into = files.get(p) ?? { lines: new Map() };
      for (const [n, h] of c.lines) into.lines.set(n, Math.max(into.lines.get(n) ?? 0, h));
      files.set(p, into);
    }
  return { format: reports[0]!.format, files };
}

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Find the report entry for a repo-relative path: exact, or the longest path-suffix match. */
export function lookup(report: CoverageReport, repoPath: string): LineCoverage | undefined {
  const target = norm(repoPath);
  let best: { cov: LineCoverage; len: number } | undefined;
  for (const [p, cov] of report.files) {
    const n = norm(p);
    if (n === target) return cov;
    if (n.endsWith(`/${target}`) || target.endsWith(`/${n}`)) {
      const len = Math.min(n.length, target.length);
      if (!best || len > best.len) best = { cov, len };
    }
  }
  return best?.cov;
}

/** Shown on the card for a fork PR instead of a coverage figure. */
export const FORK_COVERAGE_NOTE = "not available on fork PRs (artifact comes from the fork's own CI)";

export interface CoverageEval {
  present: boolean;
  /** Set when coverage is deliberately ignored (fork PR): no figure, no coverage flag. */
  unavailable?: string;
  format?: string;
  /** Changed (added) lines the report instruments. */
  instrumented: number;
  covered: number;
  pct?: number;
  uncovered: Array<{ path: string; lines: number[] }>;
  /** Changed source files with no entry in the report at all. */
  notInReport: string[];
  findings: Finding[];
}

const NON_SOURCE = /\.(md|txt|json|ya?ml|toml|lock|csv|svg|png|jpe?g|gif|html?|css|scss|snap)$/i;

export function evaluateCoverage(files: FileChange[], report: CoverageReport | undefined, policy: EvidencePolicy, unavailable?: string): CoverageEval {
  const findings: Finding[] = [];
  if (unavailable) return { present: false, unavailable, instrumented: 0, covered: 0, uncovered: [], notInReport: [], findings };
  if (!report) {
    findings.push({ id: "coverage_missing", title: "No coverage report", detail: "No lcov or Cobertura report was provided, so changed-line coverage is unknown." });
    return { present: false, instrumented: 0, covered: 0, uncovered: [], notInReport: [], findings };
  }
  let instrumented = 0;
  let covered = 0;
  const uncovered: CoverageEval["uncovered"] = [];
  const notInReport: string[] = [];
  for (const f of files) {
    if (f.status === "removed" || NON_SOURCE.test(f.path) || matchesAny(f.path, policy.paths.tests)) continue;
    const added = addedLines(f);
    if (!added.length) continue;
    const cov = lookup(report, f.path);
    if (!cov) {
      notInReport.push(f.path);
      continue;
    }
    const miss: number[] = [];
    for (const l of added) {
      const h = cov.lines.get(l.line);
      if (h === undefined) continue; // not executable (comment, blank, type-only)
      instrumented++;
      if (h > 0) covered++;
      else miss.push(l.line);
    }
    if (miss.length) uncovered.push({ path: f.path, lines: miss });
  }
  const pct = instrumented ? Math.round((covered / instrumented) * 1000) / 10 : undefined;
  if (pct !== undefined && pct < policy.coverage.minChangedLinesPct) {
    findings.push({
      id: "coverage_below_threshold",
      title: `Changed-line coverage ${pct}% is below ${policy.coverage.minChangedLinesPct}%`,
      detail: uncovered.map((u) => `\`${u.path}\`: lines ${compress(u.lines)}`).join("\n"),
      locations: uncovered.flatMap((u) => u.lines.slice(0, 10).map((line) => ({ path: u.path, line, message: "changed line not covered by tests" }))),
    });
  }
  return { present: true, format: report.format, instrumented, covered, pct, uncovered, notInReport, findings };
}

export function compress(lines: number[]): string {
  const s = [...lines].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j;
  }
  return out.join(", ");
}
