// Analysis of one merge commit.
//
// 1. auto  = diff(automatic merge of P1,P2 -> M)  (what the merge commit itself did)
// 2. drops = for each parent S: every hunk of diff(base -> S) that M no longer carries
// 3. evil  = hunks of `auto` outside conflict regions that drops do not explain

import { autoMergeDiff, pickStrategy, type AutoMerge, type Strategy } from "./automerge.ts";
import { commitInfo, introducingCommit, type Attribution } from "./attribution.ts";
import { isIgnored, levelFor, type Config, type Level } from "./config.ts";
import { filePath, fullSide, parseDiff, type Block, type FileDiff } from "./diff.ts";
import { splitLines, type Git } from "./git.ts";
import { MOVED_NOTE, SOFTEN_NOTE, isExemptFromSoftening, isGenerated, isMoved, isVersionOnly, linesAddedByMerge, type SoftenReason } from "./soften.ts";
import { bagOf, significant, subtract, total } from "./tokens.ts";
import type { Finding, FindingKind, MergeReport, Side } from "./types.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/** Lines of surrounding context compared on both sides when judging a hunk. */
const WINDOW = 2;
/** Fraction of a hunk's added tokens that may go missing before it counts as partially dropped. */
const PARTIAL_THRESHOLD = 0.2;
const SNIPPET = 12;
/** A hunk of at least NEARLY_MIN delta tokens that is NEARLY gone counts as dropped, not partial. */
const NEARLY = 0.9;
const NEARLY_MIN = 10;

export interface AnalyzeOptions {
  config: Config;
  /** Resolved sha of the main branch tip, used to tell which parent is main. */
  mainSha?: string;
  strategy?: Strategy;
}

const DEFAULT_LEVEL: Record<FindingKind, Record<Side | "none", Level>> = {
  dropped: { main: "error", branch: "notice", none: "error" },
  "partially-dropped": { main: "warning", branch: "notice", none: "warning" },
  evil: { main: "warning", branch: "warning", none: "warning" },
};

export function analyzeMerge(git: Git, rev: string, opts: AnalyzeOptions): MergeReport {
  const sha = git.resolve(rev);
  if (!sha) throw new Error(`unknown revision: ${rev}`);
  const parents = git.parents(sha);
  const report: MergeReport = {
    merge: commitInfo(git, sha),
    parents,
    status: "clean",
    conflictedFiles: [],
    changedFromAutoMerge: [],
    findings: [],
    notes: [],
  };
  if (parents.length < 2) {
    report.status = "not-a-merge";
    report.notes.push("not a merge commit; nothing to check");
    return report;
  }
  if (parents.length > 2) {
    report.status = "unsupported";
    report.notes.push(`octopus merge with ${parents.length} parents is not supported; only two-parent merges are checked`);
    return report;
  }
  try {
    analyzeTwoParent(git, report, opts);
  } catch (e) {
    report.status = "error";
    report.error = (e as Error).message;
  }
  return report;
}

function analyzeTwoParent(git: Git, report: MergeReport, opts: AnalyzeOptions): void {
  const { config } = opts;
  const m = report.merge.sha;
  const [p1, p2] = report.parents as [string, string];

  const bases = git.mergeBases(p1, p2);
  const base = bases[0] ?? EMPTY_TREE;
  report.mergeBase = bases[0];
  if (bases.length === 0) report.notes.push("parents share no history; comparing against the empty tree");
  if (bases.length > 1) {
    report.notes.push(`criss-cross merge: ${bases.length} merge bases; side changes are measured from ${base.slice(0, 7)}`);
  }

  report.mainParent = mainParentIndex(git, m, p1, p2, opts.mainSha);
  if (opts.mainSha === undefined) report.notes.push("main branch not found; treating the second parent as the main side");

  const strategy = pickStrategy(git, opts.strategy);
  report.strategy = strategy;
  const auto = autoMergeDiff(git, m, p1, p2, strategy);

  const relevant = auto.files.filter((f) => !isIgnored(config, f.oldPath, f.newPath));
  report.changedFromAutoMerge = relevant.map(filePath).sort();
  report.conflictedFiles = [...auto.conflicted].filter((p) => !isIgnored(config, p)).sort();
  const ignoredCount = auto.files.length - relevant.length;
  if (ignoredCount > 0) report.notes.push(`${ignoredCount} file(s) differing from the automatic merge are ignored by config`);

  if (relevant.length === 0) {
    report.status = "clean";
    return;
  }

  const changed = new Set<string>();
  for (const f of relevant) {
    if (f.newPath) changed.add(f.newPath);
    if (f.oldPath) changed.add(f.oldPath);
  }

  const findings: Finding[] = [];
  const mainIdx = report.mainParent ?? 1;
  for (const [idx, parent] of [p1, p2].entries()) {
    const side: Side = idx === mainIdx ? "main" : "branch";
    findings.push(...findDrops(git, { base, parent, merge: m, side, changed, auto, config }));
  }
  findings.push(...findEvil(git, { merge: m, p1, p2, auto, files: relevant, drops: findings, config, report }));

  for (const f of findings) f.level = levelFor(config, f.path, f.level);
  report.findings = findings.filter((f) => f.level !== "off");
  report.status = report.findings.length > 0 ? "findings" : "conflict-resolution";
}

function mainParentIndex(git: Git, m: string, p1: string, p2: string, mainSha?: string): number | undefined {
  if (!mainSha) return undefined;
  // Reaching main is not enough: a back-merge that landed through a PR is an ancestor of main
  // with the branch as its first parent. Only main's own line says which parent is main.
  const line = git.firstParentLine(mainSha);
  if (line.has(m)) return 0;
  if (line.has(p2)) return 1;
  if (line.has(p1)) return 0;
  if (git.isAncestor(p2, mainSha)) return 1;
  if (git.isAncestor(p1, mainSha)) return 0;
  return 1;
}

// --- dropped changes -------------------------------------------------------

interface DropCtx {
  base: string;
  parent: string;
  merge: string;
  side: Side;
  changed: Set<string>;
  auto: AutoMerge;
  config: Config;
}

const SIDE_DIFF = ["diff", "--no-color", "--no-ext-diff", "--find-renames", "-U0"];

function findDrops(git: Git, ctx: DropCtx): Finding[] {
  const { base, parent, merge, side, changed, auto, config } = ctx;
  const sideFiles = parseDiff(git.out([...SIDE_DIFF, base, parent])).filter(
    (f) => !isIgnored(config, f.oldPath, f.newPath),
  );
  // Only files where the merge differs from the automatic merge can have lost anything.
  const candidates = sideFiles.filter((f) => changed.has(f.newPath ?? "") || changed.has(f.oldPath ?? ""));
  if (candidates.length === 0) return [];

  const mapFiles = parseDiff(git.out([...SIDE_DIFF, parent, merge]));
  const mapByOld = new Map<string, FileDiff>();
  const mapByNew = new Map<string, FileDiff>();
  for (const f of mapFiles) {
    if (f.oldPath) mapByOld.set(f.oldPath, f);
    if (f.newPath) mapByNew.set(f.newPath, f);
  }
  const attr: Attribution = { git, base, tip: parent, cache: new Map() };
  const isConflicted = (...ps: Array<string | null | undefined>) => ps.some((p) => p != null && auto.conflicted.has(p));
  const out: Finding[] = [];
  const mk = (kind: FindingKind, f: Omit<Finding, "kind" | "level" | "side">): Finding => ({
    kind,
    level: DEFAULT_LEVEL[kind][side],
    side,
    ...f,
  });
  const sideWord = side === "main" ? "main" : "the branch";
  const addedByMerge = linesAddedByMerge(mapFiles);
  const soften = (f: Finding, reason: SoftenReason): void => {
    if (f.kind !== "dropped" || f.level !== "error" || isExemptFromSoftening(f.path, f.parentPath)) return;
    f.level = "warning";
    f.softened = reason;
    f.message += ` (${SOFTEN_NOTE[reason]})`;
  };

  for (const sf of candidates) {
    if (sf.status === "D") {
      const old = sf.oldPath!;
      const restored = mapByNew.get(old);
      if (restored && restored.status === "A") {
        out.push(mk("dropped", {
          path: old,
          conflicted: isConflicted(old),
          message: `${sideWord} deleted ${old}, but the merge brings it back`,
          commit: introducingCommit(attr, { paths: [old], kind: "delete" }),
        }));
      }
      continue;
    }
    const p = sf.newPath!;
    const mf = mapByOld.get(p);
    if (!mf) continue; // identical in parent and merge: every hunk survived
    const conflicted = isConflicted(p, mf.newPath, sf.oldPath);

    if (mf.status === "D") {
      out.push(mk("dropped", {
        path: p,
        conflicted,
        message: sf.status === "A"
          ? `${sideWord} added ${p}, but the merge deletes it`
          : `${sideWord} changed ${p}, but the merge deletes the file`,
        commit: introducingCommit(attr, { paths: [p], kind: "any" }),
      }));
      continue;
    }
    const mPath = mf.newPath!;
    if (sf.status === "R" && sf.oldPath && mPath === sf.oldPath) {
      out.push(mk("dropped", {
        path: mPath,
        parentPath: p,
        conflicted,
        message: `${sideWord} renamed ${sf.oldPath} to ${p}, but the merge keeps the old name`,
        commit: introducingCommit(attr, { paths: [p, sf.oldPath], kind: "any" }),
      }));
    }

    if (sf.binary || mf.binary) {
      const mBlob = git.blobId(merge, mPath);
      const baseBlob = git.blobId(base, sf.oldPath ?? p);
      if (mBlob && mBlob === baseBlob) {
        out.push(mk("dropped", {
          path: mPath,
          parentPath: p !== mPath ? p : undefined,
          conflicted,
          message: `binary file: the merge has the merge-base version, ${sideWord}'s change is gone`,
          commit: introducingCommit(attr, { paths: [p], kind: "any" }),
        }));
      }
      continue;
    }

    const psLines = splitLines(git.show(parent, p) ?? "");
    const mLines = splitLines(git.show(merge, mPath) ?? "");
    for (const h of sf.blocks) {
      const v = judgeHunk(h, mf.blocks, psLines, mLines);
      if (!v) continue;
      const commit = introducingCommit(attr, {
        paths: [p, ...(sf.oldPath && sf.oldPath !== p ? [sf.oldPath] : [])],
        kind: h.added.length > 0 ? "add" : "delete",
        lines: h.added.length > 0 ? { from: h.newFrom, to: h.newTo } : undefined,
        removed: h.removed,
      });
      const what = describeHunk(h);
      const finding = mk(v.kind, {
        path: mPath,
        parentPath: p !== mPath ? p : undefined,
        conflicted,
        message: v.kind === "dropped"
          ? `the merge drops ${sideWord}'s change (${what})`
          : `the merge keeps only part of ${sideWord}'s change (${what}; ${v.detail})`,
        mergeLines: { start: v.mFrom + 1, end: v.mTo },
        parentLines: { start: h.newFrom + 1, end: h.newTo },
        added: h.added.slice(0, SNIPPET),
        removed: h.removed.slice(0, SNIPPET),
        actual: mLines.slice(v.mFrom, v.mTo).slice(0, SNIPPET),
        commit,
      });
      if (isVersionOnly(h)) soften(finding, "version-only");
      else if (finding.kind === "dropped" && isMoved(h, addedByMerge)) finding.message += ` (${MOVED_NOTE})`;
      out.push(finding);
    }
  }
  const generated = new Map<string, boolean>();
  for (const f of out) {
    if (f.level !== "error") continue;
    const inParent = f.parentPath ?? f.path;
    if (!generated.has(inParent)) generated.set(inParent, isGenerated(git, parent, inParent));
    if (generated.get(inParent)) soften(f, "generated");
  }
  return out;
}

function describeHunk(h: Block): string {
  const parts: string[] = [];
  if (h.added.length) parts.push(`+${h.added.length}`);
  if (h.removed.length) parts.push(`-${h.removed.length}`);
  return `${parts.join("/")} line${h.added.length + h.removed.length === 1 ? "" : "s"}`;
}

interface Verdict {
  kind: "dropped" | "partially-dropped";
  mFrom: number;
  mTo: number;
  detail: string;
}

/** Map a position in the parent file to the merge file through the parent->merge blocks. */
function mapPos(pos: number, blocks: Block[]): number {
  let shift = 0;
  for (const b of blocks) {
    if (b.oldTo <= pos && !(b.oldFrom === b.oldTo && b.oldFrom === pos)) shift += b.added.length - b.removed.length;
    else if (b.oldFrom < pos) return b.newTo; // pos falls inside a replaced block
    else break;
  }
  return pos + shift;
}

/**
 * Did the merge keep hunk `h` (base -> parent)? `blocks` is parent -> merge for the
 * same file. Lines the merge did not touch are kept by definition; for touched
 * regions compare the hunk's delta tokens between the parent's and the merge's
 * version of the region.
 */
export function judgeHunk(h: Block, blocks: Block[], ps: string[], mLines: string[]): Verdict | undefined {
  const empty = h.newFrom === h.newTo;
  const touching = blocks.filter((b) =>
    empty
      ? b.oldFrom <= h.newFrom && b.oldTo >= h.newFrom
      : (b.oldFrom < h.newTo && b.oldTo > h.newFrom) || (b.oldFrom === b.oldTo && b.oldFrom > h.newFrom && b.oldFrom < h.newTo),
  );
  if (touching.length === 0) return undefined;

  const addTok = subtract(bagOf(h.added), bagOf(h.removed));
  const remTok = subtract(bagOf(h.removed), bagOf(h.added));
  const A = total(addTok);
  const R = total(remTok);
  if (A === 0 && R === 0) return undefined; // whitespace-only change

  let psFrom = h.newFrom;
  let psTo = h.newTo;
  let mFrom = mapPos(h.newFrom, blocks);
  let mTo = Math.max(mFrom, mapPos(h.newTo, blocks));
  for (const b of touching) {
    psFrom = Math.min(psFrom, b.oldFrom);
    psTo = Math.max(psTo, b.oldTo);
    mFrom = Math.min(mFrom, b.newFrom);
    mTo = Math.max(mTo, b.newTo);
  }
  const psBag = bagOf(ps.slice(Math.max(0, psFrom - WINDOW), psTo + WINDOW));
  const mBag = bagOf(mLines.slice(Math.max(0, mFrom - WINDOW), mTo + WINDOW));

  let missing = 0;
  for (const [t, n] of addTok) missing += Math.min(n, Math.max(0, (psBag.get(t) ?? 0) - (mBag.get(t) ?? 0)));
  let restored = 0;
  for (const [t, n] of remTok) restored += Math.min(n, Math.max(0, (mBag.get(t) ?? 0) - (psBag.get(t) ?? 0)));

  const sigAdded = h.added.some(significant);
  const sigRemoved = h.removed.some(significant);
  if (A > 0 && sigAdded) {
    if (missing === A || (A >= NEARLY_MIN && missing / A >= NEARLY)) return { kind: "dropped", mFrom, mTo, detail: "" };
    if (missing / A >= PARTIAL_THRESHOLD) {
      return { kind: "partially-dropped", mFrom, mTo, detail: `${missing} of ${A} added tokens missing` };
    }
    if (R > 0 && sigRemoved && restored === R) {
      return { kind: "partially-dropped", mFrom, mTo, detail: "the lines it replaced are back next to it" };
    }
    return undefined;
  }
  if (R > 0 && sigRemoved) {
    if (restored === R || (R >= NEARLY_MIN && restored / R >= NEARLY)) return { kind: "dropped", mFrom, mTo, detail: "" };
    if (restored / R >= 0.5) {
      return { kind: "partially-dropped", mFrom, mTo, detail: `${restored} of ${R} removed tokens are back` };
    }
  }
  return undefined;
}

// --- evil changes ----------------------------------------------------------

interface EvilCtx {
  merge: string;
  p1: string;
  p2: string;
  auto: AutoMerge;
  files: FileDiff[];
  drops: Finding[];
  config: Config;
  report: MergeReport;
}

/** [from, to) line ranges in the automatic merge covered by conflict markers. */
export function markerRegions(lines: string[]): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("<<<<<<<")) {
      if (depth === 0) start = i;
      depth++;
    } else if (l.startsWith(">>>>>>>") && depth > 0) {
      depth--;
      if (depth === 0) out.push({ from: start, to: i + 1 });
    }
  }
  return out;
}

function findEvil(git: Git, ctx: EvilCtx): Finding[] {
  const { merge, p1, p2, auto, files, drops, report } = ctx;
  const author = report.merge;
  const out: Finding[] = [];
  const mk = (f: Omit<Finding, "kind" | "level">): Finding => ({ kind: "evil", level: DEFAULT_LEVEL.evil.none, commit: author, ...f });

  for (const af of files) {
    const path = filePath(af);
    const conflicted = auto.conflicted.has(path) || (af.oldPath != null && auto.conflicted.has(af.oldPath));
    const fileDrops = drops.filter((d) => d.path === path || d.parentPath === path || d.path === af.oldPath);
    const wholeFileDrop = fileDrops.some((d) => !d.mergeLines);

    if (af.binary) {
      const mb = git.blobId(merge, path);
      if (!conflicted && !wholeFileDrop && mb && mb !== git.blobId(p1, path) && mb !== git.blobId(p2, path)) {
        out.push(mk({ path, conflicted, message: "binary file differs from both parents and from the automatic merge" }));
      }
      continue;
    }
    if (af.status === "D") {
      if (!wholeFileDrop && !conflicted) {
        out.push(mk({ path, conflicted, message: "the merge deletes a file the automatic merge kept" }));
      }
      continue;
    }
    if (wholeFileDrop) continue;

    const autoLines = fullSide(af.oldSparse) ?? [];
    const regions = conflicted ? markerRegions(autoLines) : [];
    let parentLines: Set<string> | undefined;
    const inParents = (line: string) => {
      if (!parentLines) {
        parentLines = new Set();
        for (const rev of [p1, p2]) {
          for (const pth of new Set([path, af.oldPath].filter((x): x is string => !!x))) {
            for (const l of splitLines(git.show(rev, pth) ?? "")) parentLines.add(l.trim());
          }
        }
      }
      return parentLines.has(line.trim());
    };

    for (const b of af.blocks) {
      if (regions.some((r) => b.oldFrom <= r.to && b.oldTo >= r.from)) continue; // conflict resolution
      const covered = fileDrops.some((d) => d.mergeLines && d.mergeLines.start - 1 <= b.newTo && d.mergeLines.end >= b.newFrom);
      const novel = b.added.filter((l) => significant(l) && !inParents(l));
      const range = { start: b.newFrom + 1, end: b.newTo };
      if (novel.length > 0) {
        out.push(mk({
          path,
          conflicted,
          message: `the merge adds ${novel.length} line${novel.length === 1 ? "" : "s"} found in neither parent${conflicted ? ", outside the conflict" : ""}`,
          mergeLines: range,
          added: novel.slice(0, SNIPPET),
          removed: b.removed.slice(0, SNIPPET),
        }));
        continue;
      }
      if (covered) continue;
      const sigRemoved = b.removed.filter(significant);
      const sigAdded = b.added.filter(significant);
      if (sigRemoved.length === 0 && sigAdded.length === 0) continue;
      out.push(mk({
        path,
        conflicted,
        message: sigRemoved.length > 0
          ? `the merge removes ${sigRemoved.length} line${sigRemoved.length === 1 ? "" : "s"} the automatic merge kept${conflicted ? ", outside the conflict" : ""}`
          : `the merge re-adds ${sigAdded.length} line${sigAdded.length === 1 ? "" : "s"} the automatic merge removed`,
        mergeLines: range,
        added: b.added.slice(0, SNIPPET),
        removed: b.removed.slice(0, SNIPPET),
      }));
    }
  }
  return out;
}
