import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowFile } from './types.js';

/** Workflow files from a checkout, with repo-relative paths. */
export function readLocalWorkflows(repoDir: string): WorkflowFile[] | undefined {
  const dir = join(repoDir, '.github', 'workflows');
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ path: `.github/workflows/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
}
