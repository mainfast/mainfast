// gitignore-flavoured glob -> RegExp, shared by every `.mainfast.yml` path list:
// - `**` spans directories, `*` and `?` stay within one segment, `{a,b}` alternates;
// - a pattern without `/` matches the basename anywhere (`yarn.lock` ~ `apps/web/yarn.lock`);
// - a leading `/` anchors to the repository root (`/CODEOWNERS` only matches the root file);
// - a pattern that matches a directory matches everything under it (`dist/`, `docs`).
// (Intact's matcher, which was the superset of the four copies.)

const cache = new Map<string, RegExp>();

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let p = pattern.trim();
  let anchored = false;
  if (p.startsWith("/")) {
    anchored = true;
    p = p.slice(1);
  }
  if (p.endsWith("/")) p += "**";
  if (!anchored && !p.includes("/")) p = "**/" + p;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*") {
      if (p[i + 1] === "*") {
        const slashAfter = p[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = p.indexOf("}", i);
      if (end > i) {
        re += "(?:" + p.slice(i + 1, end).split(",").map(escapeRe).join("|") + ")";
        i = end;
      } else re += "\\{";
    } else re += escapeRe(c);
  }
  const rx = new RegExp(`^${re}(?:/.*)?$`);
  cache.set(pattern, rx);
  return rx;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
