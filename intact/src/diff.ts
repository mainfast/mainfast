// Parser for `git diff` / `git show --remerge-diff` unified output.
//
// Positions are 0-based, half-open: a block replaces old[oldFrom, oldTo) with
// new[newFrom, newTo). A pure insertion has oldFrom === oldTo (inserted before
// old line oldFrom); a pure deletion has newFrom === newTo.

export interface Block {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
  removed: string[];
  added: string[];
}

export type FileStatus = "A" | "D" | "M" | "R";

export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  status: FileStatus;
  binary: boolean;
  blocks: Block[];
  /** `remerge CONFLICT (...)` header lines, remerge-diff only. */
  conflictMessages: string[];
  /** Old side reconstructed from context lines, sparse unless the diff had full context. */
  oldSparse: Map<number, string>;
  newSparse: Map<number, string>;
}

/** Path the file has on either side, preferring the new one. */
export function filePath(f: FileDiff): string {
  return (f.newPath ?? f.oldPath)!;
}

function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  // C-style quoting used by git for unusual names.
  const body = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const nx = body[++i]!;
    if (/[0-7]/.test(nx)) {
      const oct = body.slice(i, i + 3);
      bytes.push(parseInt(oct, 8));
      i += 2;
    } else {
      const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
      bytes.push(map[nx] ?? nx.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function stripPrefix(p: string): string | null {
  const u = unquote(p.trim());
  if (u === "/dev/null") return null;
  if (u.startsWith("a/") || u.startsWith("b/")) return u.slice(2);
  return u;
}

function pathsFromGitHeader(rest: string): [string, string] {
  // rest is `a/P b/P` (or quoted). When unquoted and both sides equal, split exactly.
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*")\s+(.*)$/.exec(rest);
    if (m) return [stripPrefix(m[1]!)!, stripPrefix(m[2]!)!];
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(0, half).slice(2) === rest.slice(half + 1).slice(2)) {
    const p = rest.slice(2, half);
    return [p, p];
  }
  const idx = rest.indexOf(" b/");
  return [rest.slice(2, idx), rest.slice(idx + 3)];
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = text.split("\n");
  let cur: FileDiff | null = null;
  let oi = 0;
  let ni = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let run: Block | null = null;
  let headerPaths: [string, string] = ["", ""];
  let sawMinus = false;

  const closeRun = () => {
    if (run && cur) cur.blocks.push(run);
    run = null;
  };
  const finish = () => {
    closeRun();
    if (!cur) return;
    if (!sawMinus && cur.oldPath === "" && cur.newPath === "") {
      // No ---/+++ lines (pure rename, mode change, binary): fall back to header paths.
      cur.oldPath = cur.status === "A" ? null : headerPaths[0];
      cur.newPath = cur.status === "D" ? null : headerPaths[1];
    }
    if (cur.oldPath === "") cur.oldPath = cur.status === "A" ? null : headerPaths[0];
    if (cur.newPath === "") cur.newPath = cur.status === "D" ? null : headerPaths[1];
    if (cur.status === "M" && cur.oldPath && cur.newPath && cur.oldPath !== cur.newPath) cur.status = "R";
    files.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (cur && (oldLeft > 0 || newLeft > 0)) {
      const tag = line[0];
      const body = line.slice(1);
      if (tag === " ") {
        closeRun();
        cur.oldSparse.set(oi, body);
        cur.newSparse.set(ni, body);
        oi++; ni++; oldLeft--; newLeft--;
        continue;
      }
      if (tag === "-") {
        if (!run) run = { oldFrom: oi, oldTo: oi, newFrom: ni, newTo: ni, removed: [], added: [] };
        run.removed.push(body);
        cur.oldSparse.set(oi, body);
        oi++; run.oldTo = oi; oldLeft--;
        continue;
      }
      if (tag === "+") {
        if (!run) run = { oldFrom: oi, oldTo: oi, newFrom: ni, newTo: ni, removed: [], added: [] };
        run.added.push(body);
        cur.newSparse.set(ni, body);
        ni++; run.newTo = ni; newLeft--;
        continue;
      }
      if (tag === "\\") continue; // "\ No newline at end of file"
      // Malformed or truncated hunk: fall through to header handling.
      oldLeft = 0; newLeft = 0;
    }
    if (line.startsWith("\\")) continue;
    if (line.startsWith("diff --git ")) {
      finish();
      headerPaths = pathsFromGitHeader(line.slice("diff --git ".length));
      sawMinus = false;
      cur = {
        oldPath: "",
        newPath: "",
        status: "M",
        binary: false,
        blocks: [],
        conflictMessages: [],
        oldSparse: new Map(),
        newSparse: new Map(),
      };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("@@")) {
      closeRun();
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] === undefined ? 1 : Number(m[2]);
      const c = Number(m[3]);
      const d = m[4] === undefined ? 1 : Number(m[4]);
      oi = b === 0 ? a : a - 1;
      ni = d === 0 ? c : c - 1;
      oldLeft = b;
      newLeft = d;
      continue;
    }
    if (line.startsWith("remerge ")) { cur.conflictMessages.push(line.slice("remerge ".length)); continue; }
    if (line.startsWith("new file mode")) { cur.status = "A"; continue; }
    if (line.startsWith("deleted file mode")) { cur.status = "D"; continue; }
    if (line.startsWith("rename from ")) { cur.oldPath = unquote(line.slice(12)); cur.status = "R"; continue; }
    if (line.startsWith("rename to ")) { cur.newPath = unquote(line.slice(10)); cur.status = "R"; continue; }
    if (line.startsWith("copy from ") || line.startsWith("copy to ")) continue;
    if (line.startsWith("--- ")) { sawMinus = true; cur.oldPath = stripPrefix(line.slice(4)); continue; }
    if (line.startsWith("+++ ")) { cur.newPath = stripPrefix(line.slice(4)); continue; }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) { cur.binary = true; continue; }
  }
  finish();
  return files;
}

/** Reconstruct a full side from a diff run with unlimited context. Returns undefined if sparse. */
export function fullSide(sparse: Map<number, string>): string[] | undefined {
  const out: string[] = [];
  for (let i = 0; i < sparse.size; i++) {
    const v = sparse.get(i);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

/** Context large enough to make every hunk span the whole file. */
export const FULL_CONTEXT = "-U100000000";
