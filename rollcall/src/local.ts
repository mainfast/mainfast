import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRepoFile, repoPathKind, UnsafeRepoPathError } from '@mainfast/shared/repo-file';
import type { WorkflowFile } from './types.js';

/** Workflow files from a checkout, with repo-relative paths. A symlink is not read: it could lead anywhere. */
export function readLocalWorkflows(repoDir: string): WorkflowFile[] | undefined {
  const rel = '.github/workflows';
  if (repoPathKind(repoDir, rel) !== 'directory') return undefined;
  const out: WorkflowFile[] = [];
  for (const f of readdirSync(join(repoDir, rel)).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    try {
      const text = readRepoFile(repoDir, `${rel}/${f}`);
      if (text !== undefined) out.push({ path: `${rel}/${f}`, text });
    } catch (e) {
      if (!(e instanceof UnsafeRepoPathError)) throw e;
    }
  }
  return out;
}
