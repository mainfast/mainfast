// Evidence card (Markdown) for the sticky PR comment and the check run, plus check-run annotations.
import { CHECK_NAME, COMMENT_MARKER, DOCS_URL, PRODUCT_NAME } from "./constants.ts";
import type { EvidenceReport } from "./evaluate.ts";
import { FLAG_FIXES } from "./fixes.ts";
import { cap, mdCode, mdInline, mdText, oneLine, plainText, safeUrl } from "./markdown.ts";

const MAX_SUMMARY = 65_000; // check-run output.summary/text limit is 65535 chars
const MAX_CELL_ITEM = 200; // one check name, claim quote, ... inside a table cell
const MAX_LIST = 20; // items listed per cell before "+N more"

// Every *Cell() returns text that is safe inside a table cell: our own text plus untrusted values
// passed through `e.t` (mdText for Markdown). Untrusted values never reach the card any other way.
// The same cells feed the plain-text render (CLI in a terminal), where `e.t` only caps and
// flattens: nothing there is rendered as Markdown, so escapes would only be noise.

interface Esc {
  /** Untrusted value. */
  t(s: string, max?: number): string;
  /** Our detail text with `code` segments (may contain untrusted parts). */
  i(s: string): string;
  /** Untrusted value as code. */
  code(s: string, max?: number): string;
}

const MD: Esc = { t: (s, max) => mdText(s, max), i: (s) => mdInline(s), code: (s, max) => mdCode(s, max) };
const flat = (s: string, max = 500) => cap(oneLine(s), max);
const TEXT: Esc = { t: flat, i: (s) => flat(s, 2000), code: flat };

function joinCapped(items: string[], sep: string): string {
  const shown = items.slice(0, MAX_LIST).join(sep);
  return items.length > MAX_LIST ? `${shown}${sep}+${items.length - MAX_LIST} more` : shown;
}

/** `e` escapes the values we did not write: mdText for the card, identity for the plain-text check title. */
function headline(r: EvidenceReport, e: (s: string) => string = (s) => s): string {
  const fails = r.flags.filter((f) => f.severity === "fail").length;
  const warns = r.flags.length - fails;
  if (!r.applies) return "Not an agent PR";
  const parts = [fails ? `${fails} failing` : "", warns ? `${warns} warning${warns > 1 ? "s" : ""}` : ""].filter(Boolean);
  if (r.conclusion === "pending") return `Waiting for checks on ${e(r.pr.headSha.slice(0, 7))}${parts.length ? ` (${parts.join(", ")} so far)` : ""}`;
  return parts.length ? parts.join(", ") : "All evidence present";
}

export function checkTitle(r: EvidenceReport): string {
  return headline(r);
}

function badge(r: EvidenceReport): string {
  if (!r.applies) return "PASS"; // success: apply_to: agents gates agent PRs only
  return { success: "PASS", failure: "FAIL", neutral: "WARN", pending: "PENDING" }[r.conclusion];
}

function testsCell(r: EvidenceReport, e: Esc = MD): string {
  const c = r.checks;
  if (!c.evaluated) return "not evaluated (offline)";
  const names = joinCapped(c.tests.map((t) => `${e.t(t.name, MAX_CELL_ITEM)}: ${e.t(t.state, 40)}`), ", ");
  switch (c.testsState) {
    case "passed":
      return `passed — ${names}`;
    case "failed":
      return `FAILED — ${names}`;
    case "pending":
      return `running — ${names}`;
    case "skipped":
      return `SKIPPED — ${names}`;
    case "empty":
      return `ran zero tests — ${names}`;
    case "none":
      return c.staleTestsOn ? `NONE on this commit (last ran on ${e.t(c.staleTestsOn.sha.slice(0, 7))})` : "NONE on this commit";
  }
}

function requiredCell(r: EvidenceReport, e: Esc = MD): string {
  const c = r.checks;
  if (!c.evaluated) return "not evaluated (offline)";
  const unknown = c.notes.some((n) => /classic required checks unknown/.test(n)) ? " (classic protection unreadable; list them in `required_checks`)" : "";
  if (!c.required.length)
    return c.requiredSources.length ? `none configured${unknown}` : "unknown (no ruleset/protection readable; set `required_checks`)";
  const ok = c.required.filter((x) => x.state === "success").length;
  const bad = c.required.filter((x) => x.state !== "success").map((x) => `${e.t(x.context, MAX_CELL_ITEM)}: ${e.t(x.state, 40)}`);
  return `${ok}/${c.required.length} passed${bad.length ? ` — ${joinCapped(bad, ", ")}` : ""}${unknown}`;
}

function coverageCell(r: EvidenceReport, e: Esc = MD): string {
  const c = r.coverage;
  if (c.unavailable) return c.unavailable;
  if (!c.present) return "no report";
  const format = e.t(String(c.format), 40);
  if (c.pct === undefined) return `no instrumented changed lines (${format})`;
  return `${c.pct}% (${c.covered}/${c.instrumented} changed lines, ${format})${c.notInReport.length ? `; ${c.notInReport.length} changed file(s) not in report` : ""}`;
}

function tamperCell(r: EvidenceReport): string {
  const t = r.tamper.touched;
  const parts = (
    [
      ["workflows", t.workflows],
      ["CODEOWNERS", t.codeowners],
      ["policy", t.policy],
      ["test config", t.testConfig],
      ["existing tests", t.tests],
      ["lockfiles", t.lockfiles],
    ] as const
  )
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k} (${v.length})`);
  const w: string[] = [];
  const s = r.tamper.testStats;
  const skips = s.reduce((n, x) => n + x.skips.length + x.focus.length, 0);
  if (skips) w.push(`${skips} skip/focus marker(s)`);
  if (r.tamper.net.assertions < 0) w.push(`assertions ${r.tamper.net.assertions}`);
  if (r.tamper.net.cases < 0) w.push(`test cases ${r.tamper.net.cases}`);
  return [...parts, ...w].join(", ") || "nothing sensitive touched";
}

function claimsCell(r: EvidenceReport, e: Esc = MD): string {
  if (!r.claims.length) return "no testable claims";
  return joinCapped(r.claims.map((c) => `"${e.t(c.quote, MAX_CELL_ITEM)}": ${c.verdict === "unbacked" ? "UNBACKED" : e.t(c.verdict, 40)}`), "; ");
}

export function renderCard(r: EvidenceReport, opts: { checkUrl?: string; marker?: boolean } = {}): string {
  const short = r.pr.headSha.slice(0, 7);
  const lines: string[] = [];
  if (opts.marker !== false) lines.push(COMMENT_MARKER);
  lines.push(`### ${PRODUCT_NAME}: ${badge(r)} — ${headline(r, (s) => mdText(s))}`);
  const meta = [`head ${mdCode(short)}`, r.provenance.agents.length ? r.provenance.agents.map((a) => mdText(a, 60)).join(", ") : "no agent detected"];
  const checkUrl = safeUrl(opts.checkUrl);
  if (checkUrl) meta.push(`[check run](${checkUrl})`);
  lines.push(meta.join(" · "), "");
  if (!r.applies) lines.push(`${mdText(r.appliesReason)}; this repository's policy gates agent PRs only (${mdCode("apply_to: all")} gates every PR).`, "");

  if (r.applies) {
    lines.push("| Evidence | On this commit |", "|---|---|");
    lines.push(`| Tests ran | ${testsCell(r)} |`);
    lines.push(`| Required checks | ${requiredCell(r)} |`);
    lines.push(`| Changed-line coverage | ${coverageCell(r)} |`);
    lines.push(`| Sensitive files / test weakening | ${tamperCell(r)} |`);
    lines.push(`| Description claims | ${claimsCell(r)} |`);
    lines.push(`| Diff size | +${r.size.additions} −${r.size.deletions} in ${r.size.files} file(s) |`);
    lines.push(`| Secret-like strings | ${r.secrets.length ? `${r.secrets.length} found` : "none"} |`, "");

    const section = (sev: "fail" | "warn", heading: string) => {
      const fs = r.flags.filter((f) => f.severity === sev);
      if (!fs.length) return;
      lines.push(`#### ${heading}`);
      for (const f of fs) {
        const [first, ...rest] = f.detail.split("\n");
        lines.push(`- **${mdText(f.title, 200)}** (${mdCode(f.id, 80)}) — ${mdInline(first ?? "")}`);
        for (const extra of rest.slice(0, 20)) lines.push(`  - ${mdInline(extra)}`);
        if (rest.length > 20) lines.push(`  - …and ${rest.length - 20} more`);
        lines.push(`  - Fix: ${mdInline(FLAG_FIXES[f.id])}`);
      }
      lines.push("");
    };
    section("fail", "Failing");
    section("warn", "Warnings");
  }

  const p = r.provenance;
  if (p.signals.length) {
    lines.push("<details><summary>Provenance signals</summary>", "");
    for (const s of p.signals.slice(0, 30)) lines.push(`- ${mdText(s.source, 40)}: ${mdText(s.detail)}`);
    if (p.humanCommits.length) lines.push(`- commits with no agent signal: ${joinCapped(p.humanCommits.map((s) => mdCode(s.slice(0, 7))), ", ")}`);
    lines.push("", "</details>", "");
  }
  if (r.checks.notes.length) {
    lines.push("<details><summary>Not readable with this token</summary>", "");
    for (const n of r.checks.notes.slice(0, 20)) lines.push(`- ${mdText(n)}`);
    lines.push("", "</details>", "");
  }
  if (r.policyWarnings.length) {
    lines.push("<details><summary>Policy warnings</summary>", "");
    for (const w of r.policyWarnings.slice(0, 50)) lines.push(`- ${mdText(w)}`);
    lines.push("", "</details>", "");
  }
  lines.push(`<sub>Evidence is for ${mdCode(r.pr.headSha, 80)} only and is re-evaluated on every push. Policy read from the base branch. [What is this?](${DOCS_URL})</sub>`);
  const out = lines.join("\n");
  return out.length > MAX_SUMMARY ? `${out.slice(0, MAX_SUMMARY - 40)}\n\n…(truncated)` : out;
}

/**
 * The same evidence as plain text, for a terminal: no Markdown, no HTML, no escapes. Untrusted
 * values are still flattened to one line, stripped of control and bidi characters and capped.
 */
export function renderText(r: EvidenceReport): string {
  const e = TEXT;
  const out: string[] = [];
  out.push(`${PRODUCT_NAME}: ${badge(r)} — ${headline(r, (s) => e.t(s))}`);
  out.push(`head ${r.pr.headSha.slice(0, 7)} · ${r.provenance.agents.length ? r.provenance.agents.map((a) => e.t(a, 60)).join(", ") : "no agent detected"}`);
  if (!r.applies) out.push(`${e.t(r.appliesReason)}; the policy gates agent PRs only (apply_to: all gates every PR).`);
  if (r.applies) {
    const rows: Array<[string, string]> = [
      ["Tests ran", testsCell(r, e)],
      ["Required checks", requiredCell(r, e)],
      ["Changed-line coverage", coverageCell(r, e)],
      ["Sensitive files", tamperCell(r)],
      ["Description claims", claimsCell(r, e)],
      ["Diff size", `+${r.size.additions} −${r.size.deletions} in ${r.size.files} file(s)`],
      ["Secret-like strings", r.secrets.length ? `${r.secrets.length} found` : "none"],
    ];
    out.push("");
    for (const [k, v] of rows) out.push(`  ${k.padEnd(22)} ${v}`);
    for (const sev of ["fail", "warn"] as const) {
      const fs = r.flags.filter((f) => f.severity === sev);
      if (!fs.length) continue;
      out.push("", sev === "fail" ? "Failing:" : "Warnings:");
      for (const f of fs) {
        const [first, ...rest] = f.detail.split("\n");
        out.push(`  ${sev === "fail" ? "FAIL" : "WARN"} ${f.id}: ${e.i(f.title)} — ${e.i(first ?? "")}`);
        for (const extra of rest.slice(0, 20)) out.push(`       ${e.i(extra)}`);
        if (rest.length > 20) out.push(`       …and ${rest.length - 20} more`);
        out.push(`       fix: ${FLAG_FIXES[f.id].replace(/`/g, "")}`);
      }
    }
  }
  const p = r.provenance;
  if (p.signals.length) {
    out.push("", "Provenance signals:");
    for (const s of p.signals.slice(0, 30)) out.push(`  ${s.source}: ${e.t(s.detail)}`);
    if (p.humanCommits.length) out.push(`  commits with no agent signal: ${joinCapped(p.humanCommits.map((s) => s.slice(0, 7)), ", ")}`);
  }
  for (const n of r.checks.notes.slice(0, 20)) out.push(`note: ${e.t(n)}`);
  for (const w of r.policyWarnings.slice(0, 50)) out.push(`policy warning: ${e.t(w)}`);
  return out.join("\n");
}

export interface CheckRunPayload {
  name: string;
  head_sha: string;
  status: "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral";
  output: {
    title: string;
    summary: string;
    annotations?: Array<{ path: string; start_line: number; end_line: number; annotation_level: "failure" | "warning" | "notice"; message: string; title?: string }>;
  };
}

/** Body for `POST /repos/{owner}/{repo}/check-runs`. Annotations are capped at 50 per request by GitHub. */
export function checkRunPayload(r: EvidenceReport): CheckRunPayload {
  const annotations = r.flags
    .flatMap((f) =>
      (f.locations ?? [])
        .filter((l) => l.line !== undefined)
        .map((l) => ({
          path: l.path,
          start_line: l.line!,
          end_line: l.line!,
          annotation_level: f.severity === "fail" ? ("failure" as const) : ("warning" as const),
          // Annotations are plain text on GitHub: no Markdown escaping, but controls dropped and capped.
          title: plainText(f.title, 255, true),
          message: plainText(l.message, 4_000),
        })),
    )
    .slice(0, 50);
  const pending = r.applies && r.conclusion === "pending";
  return {
    name: CHECK_NAME,
    head_sha: r.pr.headSha,
    status: pending ? "in_progress" : "completed",
    ...(pending ? {} : { conclusion: r.conclusion === "pending" ? "neutral" : r.conclusion }),
    output: { title: plainText(checkTitle(r), 255, true), summary: renderCard(r, { marker: false }), ...(annotations.length ? { annotations } : {}) },
  };
}
