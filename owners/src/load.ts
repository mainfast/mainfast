// Gathers the inputs. The Action reads everything through the API at the right refs and never
// looks at a checkout: CODEOWNERS and `.mainfast.yml` from the base (PR) or default branch
// (audit), the PR's own CODEOWNERS and tree from its head commit. The CLI's offline `lint` reads
// a local checkout.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeownersFile, OwnersApi, PrFile } from './api.js';
import { CODEOWNERS_LOCATIONS } from './codeowners.js';
import type { OwnersInput } from './audit.js';
import { CONFIG_FILE, CONFIG_FILE_ALT } from './brand.js';
import { configFromDoc, parseConfig, type OwnersConfig } from './config.js';
import { resolveConfig } from '@mainfast/shared/config';
import type { GitHub } from '@mainfast/shared/github';

export function localFiles(repoDir: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

export function localCodeowners(repoDir: string): CodeownersFile | undefined {
  for (const p of CODEOWNERS_LOCATIONS) {
    const full = join(repoDir, p);
    if (existsSync(full) && statSync(full).isFile()) return { path: p, text: readFileSync(full, 'utf8'), size: statSync(full).size };
  }
  return undefined;
}

/** The CODEOWNERS GitHub uses at `ref`: the first of .github/, root, docs/ that exists. */
export async function codeownersAt(api: OwnersApi, ref: string): Promise<CodeownersFile | undefined> {
  for (const p of CODEOWNERS_LOCATIONS) {
    const f = await api.codeownersFile(p, ref);
    if (f) return f;
  }
  return undefined;
}

type Loaded = Pick<OwnersInput, 'codeowners' | 'files' | 'truncated' | 'pr' | 'ref' | 'notes'>;

/** Audit: CODEOWNERS and the tree at `ref` (a branch name or sha). */
export async function loadAudit(api: OwnersApi, ref: string): Promise<Loaded> {
  const tree = await api.treePaths(ref);
  return { ref, files: tree.paths, truncated: tree.truncated, codeowners: await codeownersAt(api, ref), notes: [] };
}

export const touchesCodeowners = (files: PrFile[]): boolean =>
  files.some((f) => CODEOWNERS_LOCATIONS.includes(f.filename) || (f.previous_filename !== undefined && CODEOWNERS_LOCATIONS.includes(f.previous_filename)));

/**
 * PR: the changed files, CODEOWNERS from the base branch (what GitHub uses to request reviews),
 * and, only when the PR edits a CODEOWNERS file, the PR's version and its tree at the head commit.
 */
const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Same-repository PR by an OWNER / MEMBER / COLLABORATOR: may see org-private owner checks. */
export function isTrustedPr(pr: { author_association?: string; head?: { repo?: { full_name?: string } | null }; base?: { repo?: { full_name?: string } | null } } | undefined): boolean {
  const head = pr?.head?.repo?.full_name;
  const base = pr?.base?.repo?.full_name;
  return Boolean(head && base && head.toLowerCase() === base.toLowerCase() && TRUSTED_ASSOCIATIONS.includes(String(pr?.author_association ?? '')));
}

export async function loadPr(api: OwnersApi, pr: { number: number; baseRef: string; headSha: string; trusted: boolean }): Promise<Loaded> {
  const files = await api.prFiles(pr.number);
  const codeowners = await codeownersAt(api, pr.baseRef);
  const notes: string[] = [];
  if (files.length >= 3000) notes.push('GitHub lists at most 3000 changed files per PR; files beyond that were not checked.');
  let proposed: NonNullable<OwnersInput['pr']>['proposed'];
  if (touchesCodeowners(files)) {
    const tree = await api.treePaths(pr.headSha);
    proposed = { ref: pr.headSha, codeowners: await codeownersAt(api, pr.headSha), files: tree.paths, truncated: tree.truncated };
  }
  return { ref: pr.baseRef, files: [], codeowners, pr: { number: pr.number, files, proposed, trusted: pr.trusted }, notes };
}

/** `.mainfast.yml` (or `.mainfast.yaml`) at `ref` through the contents API, with `extends:` applied. */
export async function loadConfigFromRepo(gh: GitHub, owner: string, repo: string, ref: string): Promise<{ cfg: OwnersConfig; source: string }> {
  let file = CONFIG_FILE;
  let text = await gh.getFileText(owner, repo, CONFIG_FILE, ref);
  if (text === undefined) {
    file = CONFIG_FILE_ALT;
    text = await gh.getFileText(owner, repo, CONFIG_FILE_ALT, ref);
  }
  if (text === undefined) return { cfg: parseConfig(undefined), source: `defaults (no ${CONFIG_FILE} on ${ref})` };
  const resolved = await resolveConfig(text, {
    repoFile: (o, r, path, at) => gh.getFileText(o, r, path, at),
    localFile: (path) => gh.getFileText(owner, repo, path, ref),
  });
  return { cfg: configFromDoc(resolved.doc), source: `${file} on ${ref}${resolved.extendedFrom ? ` (extends ${resolved.extendedFrom})` : ''}` };
}
