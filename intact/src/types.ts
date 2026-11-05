import type { Strategy } from "./automerge.ts";
import type { Level } from "./config.ts";
import type { SoftenReason } from "./soften.ts";

export interface CommitInfo {
  sha: string;
  short: string;
  subject: string;
  author: string;
  email: string;
  date: string;
}

export type FindingKind = "dropped" | "partially-dropped" | "evil";
export type Side = "main" | "branch";

export interface LineRange {
  /** 1-based, inclusive. end < start means an empty range positioned before `start`. */
  start: number;
  end: number;
}

export interface Finding {
  kind: FindingKind;
  level: Level;
  /** For drops: which parent's change went missing. */
  side?: Side;
  /** Path in the merge commit (or in the parent, when the merge deleted it). */
  path: string;
  /** Path in the parent whose change was dropped, when different. */
  parentPath?: string;
  conflicted: boolean;
  message: string;
  /** Why a dropped change was lowered from error to warning. */
  softened?: SoftenReason;
  /** Lines in the merge commit's version of the file. */
  mergeLines?: LineRange;
  /** Lines in the parent that carried the change. */
  parentLines?: LineRange;
  /** What the side added (dropped/partially-dropped) or what the merge added (evil). */
  added?: string[];
  /** What the side removed (that came back), or what the merge removed (evil). */
  removed?: string[];
  /** What the merge commit has in that region. */
  actual?: string[];
  /** Commit that introduced the dropped change, or the merge commit for evil changes. */
  commit?: CommitInfo;
}

export type MergeStatus = "clean" | "conflict-resolution" | "findings" | "unsupported" | "not-a-merge" | "error";

export interface MergeReport {
  merge: CommitInfo;
  parents: string[];
  mergeBase?: string;
  /** Index into parents of the main-side parent, when known. */
  mainParent?: number;
  strategy?: Strategy;
  status: MergeStatus;
  conflictedFiles: string[];
  /** Files where the merge commit differs from the automatic merge. */
  changedFromAutoMerge: string[];
  findings: Finding[];
  notes: string[];
  error?: string;
}

export interface CheckReport {
  tool: string;
  version: string;
  repo: string;
  range?: string;
  mainRef?: string;
  merges: MergeReport[];
  summary: {
    merges: number;
    clean: number;
    conflictResolution: number;
    withFindings: number;
    unsupported: number;
    errors: number;
    findings: Record<Level, number>;
  };
}
