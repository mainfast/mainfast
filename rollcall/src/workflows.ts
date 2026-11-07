// Static view of .github/workflows: which check-run names each job will report
// on a pull request, and what can make it not run or report "skipped".
import { parse } from 'yaml';
import type { WorkflowFile } from './types.js';

export interface PrFilters {
  event: string;
  paths?: string[];
  pathsIgnore?: string[];
  branches?: string[];
  branchesIgnore?: string[];
  types?: string[];
}

export interface JobInfo {
  workflow: string;
  workflowName: string;
  id: string;
  /** Name as written (job `name:` or the job id). */
  rawName: string;
  /** The check-run name(s) this job reports, as a pattern. */
  pattern: RegExp;
  /** Human form of the pattern, e.g. "test (…)" for a matrix job. */
  display: string;
  matrix: boolean;
  reusable: boolean;
  /**
   * The name is only expressions (`${{ matrix.name }}`), so it could be anything. The job is never
   * reported as producing a required check: claiming every check for it would blame it for all.
   */
  opaque: boolean;
  if?: string;
  needs: string[];
}

export interface WorkflowInfo {
  path: string;
  name: string;
  /** Pull-request-ish triggers (pull_request, pull_request_target, merge_group). */
  prTriggers: PrFilters[];
  /**
   * Only runs when another workflow calls it (`workflow_call`, optionally `workflow_dispatch`).
   * Its PR triggers live in the caller, and its checks report as "<caller job> / <job>".
   */
  callableOnly: boolean;
  jobs: JobInfo[];
  error?: string;
}

const PR_EVENTS = ['pull_request', 'pull_request_target', 'merge_group'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function list(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  return (Array.isArray(v) ? v : [v]).map(String);
}

function triggers(on: unknown): PrFilters[] {
  if (typeof on === 'string') return PR_EVENTS.includes(on) ? [{ event: on }] : [];
  if (Array.isArray(on)) return on.filter((e) => PR_EVENTS.includes(String(e))).map((e) => ({ event: String(e) }));
  if (on && typeof on === 'object') {
    const out: PrFilters[] = [];
    for (const [event, cfg] of Object.entries(on as Record<string, any>)) {
      if (!PR_EVENTS.includes(event)) continue;
      const c = (cfg ?? {}) as Record<string, unknown>;
      out.push({
        event,
        paths: list(c.paths),
        pathsIgnore: list(c['paths-ignore']),
        branches: list(c.branches),
        branchesIgnore: list(c['branches-ignore']),
        types: list(c.types),
      });
    }
    return out;
  }
  return [];
}

/** Whether the workflow runs only when called (or by hand), so no PR event starts it directly. */
function isCallableOnly(on: unknown): boolean {
  const events = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === 'object' ? Object.keys(on) : [];
  return events.includes('workflow_call') && events.every((e) => e === 'workflow_call' || e === 'workflow_dispatch');
}

const EXPRESSION = /\$\{\{([^}]*)\}\}/g;

const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** The values `${{ matrix.key }}` can take, when the matrix spells them all out. */
function matrixValues(expr: string, matrix: unknown): string[] | undefined {
  const key = /^\s*matrix\.([A-Za-z_][\w-]*)\s*$/.exec(expr)?.[1];
  if (!key || !matrix || typeof matrix !== 'object') return undefined;
  const m = matrix as Record<string, unknown>;
  const include = Array.isArray(m.include) ? m.include : [];
  const fromInclude = include.map((row) => (row as Record<string, unknown> | null)?.[key]).filter((v) => v !== undefined);
  const listed = m[key];
  if (listed !== undefined && !Array.isArray(listed)) return undefined;
  const all = [...((listed as unknown[] | undefined) ?? []), ...fromInclude];
  if (!all.length || !all.every(isScalar) || all.some((v) => /\$\{\{/.test(String(v)))) return undefined;
  return [...new Set(all.map(String))];
}

/**
 * The event names and repository a PR run sees make many conditions constant. `true` means the
 * condition always holds on a PR into this repository, `false` never, `undefined` unknown.
 */
export function conditionOnPr(cond: string, events: readonly string[], repository: string): boolean | undefined {
  const text = cond.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const owner = repository.split('/')[0]!;
  const atom = (raw: string): boolean | undefined => {
    const a = raw.trim();
    const cmp = /^([\w.-]+)\s*(==|!=)\s*'([^']*)'$/.exec(a);
    if (cmp) {
      const [, left, op, right] = cmp;
      let eq: boolean | undefined;
      if (left === 'github.event_name') eq = events.every((e) => e === right) ? true : events.includes(right!) ? undefined : false;
      else if (left === 'github.repository') eq = right!.toLowerCase() === repository.toLowerCase();
      else if (left === 'github.repository_owner') eq = right!.toLowerCase() === owner.toLowerCase();
      else if (left!.startsWith('github.event.inputs.') || left!.startsWith('inputs.')) eq = right === '';
      if (eq === undefined) return undefined;
      return op === '==' ? eq : !eq;
    }
    if (/^startsWith\(\s*github\.ref\s*,\s*'refs\/tags\/[^']*'\s*\)$/.test(a)) return false;
    return undefined;
  };
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? '')) i++;
  };
  const or = (): boolean | undefined => {
    let v = and();
    for (space(); text.startsWith('||', i); space()) {
      i += 2;
      const r = and();
      v = v === true || r === true ? true : v === false && r === false ? false : undefined;
    }
    return v;
  };
  const and = (): boolean | undefined => {
    let v = not();
    for (space(); text.startsWith('&&', i); space()) {
      i += 2;
      const r = not();
      v = v === false || r === false ? false : v === true && r === true ? true : undefined;
    }
    return v;
  };
  const not = (): boolean | undefined => {
    space();
    if (text[i] === '!' && text[i + 1] !== '=') {
      i++;
      const v = not();
      return v === undefined ? undefined : !v;
    }
    if (text[i] === '(') {
      i++;
      const v = or();
      space();
      if (text[i] === ')') i++;
      return v;
    }
    const start = i;
    let depth = 0;
    let quoted = false;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (c === "'") quoted = !quoted;
      if (quoted) continue;
      if (c === '(') depth++;
      if (c === ')' && depth-- === 0) break;
      if (depth === 0 && (text.startsWith('&&', i) || text.startsWith('||', i))) break;
    }
    return atom(text.slice(start, i));
  };
  const value = or();
  space();
  return i >= text.length ? value : undefined;
}

/**
 * Pattern for a name that may contain ${{ expressions }}. `${{ matrix.x }}` with listed values
 * becomes exactly those values; anything else matches any text. `opaque`: nothing in the name is
 * known, as in `${{ matrix.x }}` from a computed matrix or `${{ a }} / ${{ b }}`.
 */
function namePattern(name: string, matrix?: unknown): { source: string; display: string; opaque: boolean } {
  let source = '';
  let literal = '';
  let at = 0;
  let unknown = false;
  for (const m of name.matchAll(EXPRESSION)) {
    const text = name.slice(at, m.index);
    source += escapeRe(text);
    literal += text;
    const values = matrixValues(m[1]!, matrix);
    if (!values) unknown = true;
    source += values ? `(?:${values.map(escapeRe).join('|')})` : '.+';
    at = m.index + m[0].length;
  }
  const rest = name.slice(at);
  source += escapeRe(rest);
  literal += rest;
  return { source, display: name.replace(EXPRESSION, '…'), opaque: unknown && !/[\p{L}\p{N}]/u.test(literal) };
}

export function parseWorkflow(file: WorkflowFile): WorkflowInfo {
  let doc: any;
  try {
    doc = parse(file.text);
  } catch (e) {
    return { path: file.path, name: file.path, prTriggers: [], callableOnly: false, jobs: [], error: e instanceof Error ? e.message : String(e) };
  }
  const name = typeof doc?.name === 'string' ? doc.name : file.path;
  // YAML 1.1 parsers read a bare `on:` key as boolean true; the yaml package keeps "on"
  const on = doc?.on ?? doc?.true;
  const jobs: JobInfo[] = [];
  for (const [id, raw] of Object.entries((doc?.jobs ?? {}) as Record<string, any>)) {
    const j = raw ?? {};
    const rawName = typeof j.name === 'string' ? j.name : id;
    const hasExpr = /\$\{\{/.test(rawName);
    const matrix = Boolean(j.strategy?.matrix);
    const reusable = typeof j.uses === 'string';
    const { source, display, opaque } = namePattern(rawName, j.strategy?.matrix);
    let src = source;
    let disp = display;
    // GitHub appends the matrix values in parentheses unless the name already uses an expression
    if (matrix && !hasExpr) {
      src = `${source} \\(.+\\)`;
      disp = `${display} (…)`;
    }
    // a job that calls a reusable workflow reports "<caller> / <called job>"
    if (reusable) {
      src = `${src} / .+`;
      disp = `${disp} / …`;
    }
    jobs.push({
      workflow: file.path,
      workflowName: name,
      id,
      rawName,
      pattern: opaque ? /(?!)/ : new RegExp(`^${src}$`),
      display: disp,
      matrix,
      reusable,
      opaque,
      if: j.if === undefined ? undefined : String(j.if),
      needs: list(j.needs) ?? [],
    });
  }
  return { path: file.path, name, prTriggers: triggers(on), callableOnly: isCallableOnly(on), jobs };
}

export function parseWorkflows(files: WorkflowFile[]): WorkflowInfo[] {
  return files.map(parseWorkflow);
}

export function producersOf(context: string, workflows: WorkflowInfo[]): JobInfo[] {
  return workflows.filter((w) => !w.callableOnly).flatMap((w) => w.jobs.filter((j) => j.pattern.test(context)));
}

export function filtersOf(w: WorkflowInfo): string[] {
  const out: string[] = [];
  for (const t of w.prTriggers) {
    if (t.paths) out.push(`${t.event}.paths: ${t.paths.join(', ')}`);
    if (t.pathsIgnore) out.push(`${t.event}.paths-ignore: ${t.pathsIgnore.join(', ')}`);
    if (t.branches) out.push(`${t.event}.branches: ${t.branches.join(', ')}`);
    if (t.branchesIgnore) out.push(`${t.event}.branches-ignore: ${t.branchesIgnore.join(', ')}`);
  }
  return out;
}

/** True when the branch filter of a trigger lets PRs into `branch` through. */
export function branchAllowed(t: PrFilters, branch: string): boolean {
  const match = (g: string) => new RegExp(`^${g.split('**').map((p) => p.split('*').map(escapeRe).join('[^/]*')).join('.*')}$`).test(branch);
  if (t.branches && !t.branches.some(match)) return false;
  if (t.branchesIgnore && t.branchesIgnore.some(match)) return false;
  return true;
}
