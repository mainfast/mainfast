// Reading a file from a checkout that may not be trustworthy. A symlink in a repository can point
// anywhere, so a path that passes through one is refused rather than followed: findings and parse
// errors can echo what was read, and they may reach an agent or a log.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

export const MAX_REPO_FILE_BYTES = 1024 * 1024;

export class UnsafeRepoPathError extends Error {}

function lstatOrUndefined(path: string) {
  try {
    return lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw e;
  }
}

/**
 * Checks `rel` stays inside `root` and passes through no symlink. Returns what it found at the end:
 * "file", "directory", "other", or undefined when it does not exist. `root` itself may be a symlink.
 */
export function repoPathKind(root: string, rel: string): "file" | "directory" | "other" | undefined {
  const clean = normalize(rel);
  if (isAbsolute(rel) || clean === ".." || clean.startsWith(`..${sep}`)) throw new UnsafeRepoPathError(`refusing a path outside the repository: ${rel}`);
  let cur = root;
  let kind: "file" | "directory" | "other" | undefined = "directory";
  for (const part of clean.split(sep).filter((p) => p && p !== ".")) {
    cur = join(cur, part);
    const st = lstatOrUndefined(cur);
    if (!st) return undefined;
    if (st.isSymbolicLink()) throw new UnsafeRepoPathError(`refusing to follow a symlink: ${rel}`);
    kind = st.isFile() ? "file" : st.isDirectory() ? "directory" : "other";
  }
  return kind;
}

/** The text of a regular file inside `root`, or undefined if there is none. Throws if it is unsafe. */
export function readRepoFile(root: string, rel: string, maxBytes: number = MAX_REPO_FILE_BYTES): string | undefined {
  const kind = repoPathKind(root, rel);
  if (kind === undefined) return undefined;
  if (kind !== "file") throw new UnsafeRepoPathError(`not a regular file: ${rel}`);
  // O_NOFOLLOW closes the gap between the check above and the read.
  const fd = openSync(join(root, rel), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (fstatSync(fd).size > maxBytes) throw new UnsafeRepoPathError(`too large to read (over ${maxBytes} bytes): ${rel}`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
