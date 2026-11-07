// Where Intact reads `.mainfast.yml` and its `extends:` target from.
//
// Action: from the BASE of the change (the pull request's base commit, or the main branch
// for a push), so a pull request cannot loosen its own check; a `./path` extends is read at
// the same commit, an `owner/repo[:path][@ref]` extends through the contents API.
// CLI: from the working tree (it checks what you are about to push).
import { readFileSync } from "node:fs";
import { readRepoFile } from "@mainfast/shared/repo-file";
import { join } from "node:path";
import { SUITE } from "@mainfast/shared/brand";
import type { ExtendsFetcher } from "@mainfast/shared/config";
import { GitHub } from "@mainfast/shared/github";
import { BRAND } from "./brand.ts";
import { configPath, resolveIntactConfig, type Config } from "./config.ts";
import type { Git } from "./git.ts";
import { VERSION } from "./version.ts";

export function apiClient(token: string | undefined, apiUrl?: string): GitHub {
  return new GitHub({ token: token || undefined, apiUrl, userAgent: `${BRAND.cliName}/${VERSION}` });
}

/** `rev` = read local files at that commit; undefined = the working tree under `root`. */
export function extendsFetcher(git: Git, root: string, rev: string | undefined, gh: GitHub | undefined): ExtendsFetcher {
  return {
    async localFile(path) {
      if (rev) return git.show(rev, path);
      return readRepoFile(root, path);
    },
    async repoFile(owner, repo, path, ref) {
      if (!gh) throw new Error("no GitHub API client (set GITHUB_TOKEN to read a private repository)");
      return gh.getFileText(owner, repo, path, ref);
    },
  };
}

/** Config from the working tree (CLI) or an explicit file, with extends applied. */
export async function loadWorkingTreeConfig(git: Git, root: string, explicitPath: string | undefined, gh: GitHub | undefined): Promise<Config> {
  // An explicit path is the caller's choice; the repository's own file is not to be trusted as a path.
  if (explicitPath) return resolveIntactConfig(readFileSync(configPath(root, explicitPath)!, "utf8"), extendsFetcher(git, root, undefined, gh), explicitPath);
  const text = readRepoFile(root, BRAND.configFile);
  if (text === undefined) return resolveIntactConfig(undefined, undefined);
  return resolveIntactConfig(text, extendsFetcher(git, root, undefined, gh), join(root, BRAND.configFile));
}

/** Config as committed at `rev` (Action: the base of the change), with extends applied. */
export async function loadConfigAtRev(git: Git, root: string, rev: string, gh: GitHub | undefined): Promise<Config> {
  const text = git.show(rev, BRAND.configFile) ?? git.show(rev, SUITE.configFileAlt);
  const source = `${BRAND.configFile}@${rev.slice(0, 7)}`;
  return resolveIntactConfig(text, extendsFetcher(git, root, rev, gh), source);
}
