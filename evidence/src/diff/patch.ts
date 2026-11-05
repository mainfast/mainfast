// Unified diff parsing. GitHub's `GET /pulls/{n}/files` returns one `patch` per file that starts at
// the first `@@` hunk; `git diff` returns a multi-file diff with headers. Both end up here.
import type { FileChange, FileStatus } from "../types.ts";

export interface DiffLine {
  kind: "add" | "del";
  text: string;
  /** Line number in the new file for adds, in the old file for deletes. */
  line: number;
}

export function parseHunks(patch: string | undefined): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let oldLn = 0;
  let newLn = 0;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      oldLn = Number(h[1]);
      newLn = Number(h[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const c = raw[0];
    if (c === "+") out.push({ kind: "add", text: raw.slice(1), line: newLn++ });
    else if (c === "-") out.push({ kind: "del", text: raw.slice(1), line: oldLn++ });
    else if (c === " " || raw === "") {
      oldLn++;
      newLn++;
    } else inHunk = false; // next file header in a multi-file diff
  }
  return out;
}

export function addedLines(fc: FileChange): DiffLine[] {
  return parseHunks(fc.patch).filter((l) => l.kind === "add");
}

export function removedLines(fc: FileChange): DiffLine[] {
  return parseHunks(fc.patch).filter((l) => l.kind === "del");
}

function unquote(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    return p.slice(1, -1).replace(/\\(["\\tn])/g, (_, c: string) => (c === "t" ? "\t" : c === "n" ? "\n" : c));
  }
  return p;
}

/** Parse `git diff -M --no-color --no-ext-diff` output into FileChange records (GitHub-like). */
export function parseGitDiff(text: string): FileChange[] {
  const files: FileChange[] = [];
  const chunks = text.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "));
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const header = lines[0]!;
    let status: FileStatus = "modified";
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let binary = false;
    let i = 1;
    for (; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.startsWith("@@")) break;
      if (l.startsWith("new file mode")) status = "added";
      else if (l.startsWith("deleted file mode")) status = "removed";
      else if (l.startsWith("rename from ")) {
        oldPath = unquote(l.slice(12));
        status = "renamed";
      } else if (l.startsWith("rename to ")) newPath = unquote(l.slice(10));
      else if (l.startsWith("copy from ")) {
        oldPath = unquote(l.slice(10));
        status = "copied";
      } else if (l.startsWith("copy to ")) newPath = unquote(l.slice(8));
      else if (l.startsWith("--- ")) {
        const p = unquote(l.slice(4));
        if (p !== "/dev/null") oldPath ??= p.replace(/^a\//, "");
      } else if (l.startsWith("+++ ")) {
        const p = unquote(l.slice(4));
        if (p !== "/dev/null") newPath ??= p.replace(/^b\//, "");
      } else if (l.startsWith("Binary files")) binary = true;
    }
    if (!oldPath || !newPath) {
      // Fall back to the `diff --git a/x b/x` header (no hunks: pure rename, mode change, binary).
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(header);
      if (m) {
        oldPath ??= m[1];
        newPath ??= m[2];
      }
    }
    const path = status === "removed" ? (oldPath ?? newPath ?? "") : (newPath ?? oldPath ?? "");
    const patch = binary ? undefined : lines.slice(i).join("\n").replace(/\n$/, "") || undefined;
    const parsed = parseHunks(patch);
    files.push({
      path,
      previousPath: status === "renamed" || status === "copied" ? oldPath : undefined,
      status,
      additions: parsed.filter((d) => d.kind === "add").length,
      deletions: parsed.filter((d) => d.kind === "del").length,
      patch: binary ? undefined : (patch ?? ""),
    });
  }
  return files;
}
