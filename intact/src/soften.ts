// Some dropped changes are true but rarely worth failing a build. These stay visible as
// warnings. Lockfiles and pins are exempt on purpose, and a `severity` entry in `.mainfast.yml`
// still overrides the result.
//
// Only evidence the merge author cannot create may lower a level. Lines elsewhere in the merge
// are written by that author, so "moved" adds a note and leaves the finding an error.

import { DEFAULT_IGNORE, matchesAny } from "./config.ts";
import type { Block, FileDiff } from "./diff.ts";
import type { Git } from "./git.ts";
import { significant } from "./tokens.ts";

export type SoftenReason = "version-only" | "generated";

export const MOVED_NOTE = "its lines appear elsewhere in the merge, so it may have been moved";

export const SOFTEN_NOTE: Record<SoftenReason, string> = {
  "version-only": "only version numbers or commit ids differ, so this is a warning",
  generated: "generated file, so this is a warning",
};

/** Never lowered: a dropped lockfile bump or pin can undo a security fix. */
const NEVER_SOFTENED = [
  ...DEFAULT_IGNORE,
  "**/Pipfile.lock",
  "**/flake.lock",
  "**/packages.lock.json",
  "**/gradle.lockfile",
  "**/Package.resolved",
  "**/Podfile.lock",
  "**/mix.lock",
  "**/pubspec.lock",
  "**/.github/**",
  "**/Dockerfile",
  "**/Dockerfile.*",
  "**/*.dockerfile",
  "**/docker-compose*.y*ml",
  "**/compose*.y*ml",
];

const GENERATED_PATHS = [
  "**/__snapshots__/**",
  "**/*.snap",
  "**/*.ambr",
  "**/*.golden",
  "**/baselines/**",
  "**/*.generated.*",
  "**/*.g.cs",
  "**/*.pb.go",
  "**/*_pb2.py",
  "**/*.min.js",
  "**/*.min.css",
];
const GENERATED_HEADER = /@generated|\bDO NOT EDIT\b|\bauto-?generated\b/i;
const HEADER_LINES = 5;

/** x.y.z with optional pre-release, or a full commit id. Four-part numbers such as IP addresses do not match. */
const VERSION = /(?<![\d.])v?\d+\.\d+\.\d+(?![.\d])(?:[-+][0-9A-Za-z.+-]*)?|\b[0-9a-f]{40}\b/g;
const PLACEHOLDER = "\u0000";
/** A moved line this short could match by chance. */
const MOVED_MIN_LENGTH = 20;

const normalize = (line: string): string => line.trim().replace(VERSION, PLACEHOLDER);

/** Every line pairs with one on the other side once its version numbers are masked. */
export function isVersionOnly(h: Pick<Block, "added" | "removed">): boolean {
  if (h.added.length === 0 || h.removed.length === 0) return false;
  const counts = new Map<string, number>();
  for (const line of h.removed) {
    const n = normalize(line);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let paired = 0;
  for (const line of h.added) {
    const n = normalize(line);
    const left = counts.get(n) ?? 0;
    if (left > 0 && n.includes(PLACEHOLDER)) {
      counts.set(n, left - 1);
      paired++;
    }
  }
  const longest = Math.max(h.added.length, h.removed.length);
  return paired === longest;
}

/** Lines the merge carries that the parent did not, in any file. */
export function linesAddedByMerge(parentToMerge: FileDiff[]): Set<string> {
  const lines = new Set<string>();
  for (const f of parentToMerge) for (const b of f.blocks) for (const l of b.added) lines.add(l.trim());
  return lines;
}

/** Every meaningful line the side added is somewhere else in the merge. */
export function isMoved(h: Pick<Block, "added">, elsewhere: Set<string>): boolean {
  const lines = h.added.filter(significant).map((l) => l.trim());
  return lines.some((l) => l.length >= MOVED_MIN_LENGTH) && lines.every((l) => elsewhere.has(l));
}

export function isExemptFromSoftening(...paths: Array<string | undefined>): boolean {
  return paths.some((p) => p !== undefined && matchesAny(p, NEVER_SOFTENED));
}

export function isGenerated(git: Git, rev: string, path: string): boolean {
  if (matchesAny(path, GENERATED_PATHS)) return true;
  // --source needs git 2.40; on older versions this quietly falls through to the header check.
  const attr = git.run(["check-attr", "--source", rev, "linguist-generated", "--", path], { okStatus: [0, 1, 128, 129] });
  if (attr.status === 0 && /: linguist-generated: (set|true)\s*$/.test(attr.stdout)) return true;
  const head = git.show(rev, path);
  return head !== undefined && GENERATED_HEADER.test(head.split("\n", HEADER_LINES).join("\n"));
}
