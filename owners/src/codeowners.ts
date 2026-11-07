// CODEOWNERS parsing and matching with GitHub's rules: gitignore-style patterns,
// last matching line wins, a line with no owners makes paths unowned, no `!`
// negation, no `[ ]` ranges, `\#` escapes a leading hash.

/** Where GitHub looks, in order; the first file found is the one used. */
export const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
/** GitHub ignores a CODEOWNERS file larger than this. */
export const MAX_CODEOWNERS_BYTES = 3 * 1024 * 1024;

export type Owner =
  | { kind: 'user'; raw: string; login: string }
  | { kind: 'team'; raw: string; org: string; slug: string }
  | { kind: 'email'; raw: string; email: string };

export interface Rule {
  line: number;
  /** The line as written, trimmed (to tell a PR's new lines from the base's). */
  source: string;
  pattern: string;
  owners: Owner[];
  regex: RegExp;
}

export interface SyntaxProblem {
  line: number;
  message: string;
  source: string;
}

export interface Codeowners {
  path: string;
  rules: Rule[];
  problems: SyntaxProblem[];
}

const escapeRe = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export function patternToRegExp(pattern: string): RegExp {
  let p = pattern;
  const trailingSlash = p.endsWith('/');
  if (trailingSlash) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  // "docs/*" matches files directly in docs/, not deeper (GitHub docs example)
  const directOnly = /(^|\/)\*$/.test(p) && !p.endsWith('**');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '\\' && p[i + 1]) re += escapeRe(p[++i]!);
    else re += escapeRe(c);
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = directOnly ? '' : trailingSlash ? '/.*' : '(?:/.*)?';
  return new RegExp(`${prefix}${re}${suffix}$`);
}

export function parseOwner(raw: string): Owner | undefined {
  const team = raw.match(/^@([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
  if (team) return { kind: 'team', raw, org: team[1]!, slug: team[2]!.toLowerCase() };
  const user = raw.match(/^@([A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?)$/);
  if (user) return { kind: 'user', raw, login: user[1]! };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) return { kind: 'email', raw, email: raw };
  return undefined;
}

/** Splits on unescaped whitespace and strips an unescaped trailing comment. */
function tokens(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '\\' && i + 1 < line.length) {
      cur += c + line[++i];
      continue;
    }
    if (c === '#' && (cur === '' || /\s/.test(line[i - 1] ?? ' '))) break;
    if (/\s/.test(c)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseCodeowners(text: string, path = '.github/CODEOWNERS'): Codeowners {
  const rules: Rule[] = [];
  const problems: SyntaxProblem[] = [];
  text.split(/\r?\n/).forEach((source, i) => {
    const line = i + 1;
    const toks = tokens(source);
    if (!toks.length) return;
    const [pattern, ...ownerToks] = toks as [string, ...string[]];
    if (/^\[[^\]]+\]/.test(pattern) || /^\^\[/.test(pattern)) {
      problems.push({ line, source, message: 'GitLab-style [Section] headers are not supported by GitHub; the line is ignored' });
      return;
    }
    if (pattern.startsWith('!')) {
      problems.push({ line, source, message: 'negation (!) is not supported in CODEOWNERS; GitHub skips this line' });
      return;
    }
    if (/(^|[^\\])\[/.test(pattern)) {
      problems.push({ line, source, message: 'character ranges ([ ]) are not supported in CODEOWNERS; GitHub skips this line' });
      return;
    }
    const owners: Owner[] = [];
    for (const raw of ownerToks) {
      const o = parseOwner(raw);
      if (o) owners.push(o);
      else problems.push({ line, source, message: `\`${raw}\` is not a valid owner (@user, @org/team or an email)` });
    }
    rules.push({ line, source: source.trim(), pattern, owners, regex: patternToRegExp(pattern) });
  });
  return { path, rules, problems };
}

/** The rule GitHub applies to `file`: the last one that matches. */
export function ruleFor(co: Codeowners, file: string): Rule | undefined {
  for (let i = co.rules.length - 1; i >= 0; i--) if (co.rules[i]!.regex.test(file)) return co.rules[i];
  return undefined;
}

export function ownersOf(co: Codeowners, file: string): Owner[] {
  return ruleFor(co, file)?.owners ?? [];
}
