import type { Tree } from './git.js';

export const FRAMEWORKS = ['alembic', 'django', 'prisma', 'rails', 'flyway', 'drizzle'] as const;
export type FrameworkId = (typeof FRAMEWORKS)[number];

export type Severity = 'error' | 'warning';
export type OrderPolicy = 'error' | 'warning' | 'off';

export interface Finding {
  framework: FrameworkId;
  /** Migration directory the finding belongs to. */
  root: string;
  code: string;
  severity: Severity;
  message: string;
  files: string[];
  /** How to fix it, in one line. */
  hint?: string;
  /**
   * Identity used to drop findings main already has: a problem that exists on
   * main before the PR is not this PR's fault and is reported separately.
   */
  key: string;
}

export interface CompareContext {
  root: string;
  base: Tree;
  main: Tree;
  head: Tree;
  outOfOrder: OrderPolicy;
}

export interface Framework {
  id: FrameworkId;
  /** Migration roots found in a list of tracked files. */
  detect(files: string[], read: (path: string) => string | undefined): string[];
  /** Problems visible in one snapshot (main alone, or the simulated merge). */
  inspect(tree: Tree, root: string): Finding[];
  /** Problems that need main, branch and merge-base together (ordering). */
  compare?(ctx: CompareContext): Finding[];
  mergeFile?: (path: string, base?: string, main?: string, head?: string) => string | undefined;
}
