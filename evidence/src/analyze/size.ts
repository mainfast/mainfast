// Diff size, excluding lockfiles and any `diff.exclude` globs (generated code, snapshots).
import type { EvidencePolicy } from "../config.ts";
import { matchesAny } from "@mainfast/shared/glob";
import type { FileChange } from "../types.ts";
import type { Finding } from "./finding.ts";

export interface SizeEval {
  files: number;
  additions: number;
  deletions: number;
  /** Counted toward the limit (lockfiles and excluded paths left out). */
  counted: { files: number; lines: number };
  findings: Finding[];
}

export function evaluateSize(files: FileChange[], policy: EvidencePolicy): SizeEval {
  const skip = [...policy.paths.lockfiles, ...policy.diff.exclude];
  const counted = files.filter((f) => !matchesAny(f.path, skip));
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const findings: Finding[] = [];
  const over: string[] = [];
  if (policy.diff.maxLines > 0 && lines > policy.diff.maxLines) over.push(`${lines} changed lines (limit ${policy.diff.maxLines})`);
  if (policy.diff.maxFiles > 0 && counted.length > policy.diff.maxFiles) over.push(`${counted.length} files (limit ${policy.diff.maxFiles})`);
  if (over.length) findings.push({ id: "diff_too_large", title: "Diff is larger than the policy allows", detail: `${over.join(", ")}. Large agent PRs hide changes; split it.` });
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    counted: { files: counted.length, lines },
    findings,
  };
}
