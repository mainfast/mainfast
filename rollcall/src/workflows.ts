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
  if?: string;
  needs: string[];
}

export interface WorkflowInfo {
  path: string;
  name: string;
  /** Pull-request-ish triggers (pull_request, pull_request_target, merge_group). */
  prTriggers: PrFilters[];
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

/** Pattern for a name that may contain ${{ expressions }}. */
function namePattern(name: string): { source: string; display: string } {
  const parts = name.split(/\$\{\{[^}]*\}\}/);
  return { source: parts.map(escapeRe).join('.+'), display: name.replace(/\$\{\{[^}]*\}\}/g, '…') };
}

export function parseWorkflow(file: WorkflowFile): WorkflowInfo {
  let doc: any;
  try {
    doc = parse(file.text);
  } catch (e) {
    return { path: file.path, name: file.path, prTriggers: [], jobs: [], error: e instanceof Error ? e.message : String(e) };
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
    const { source, display } = namePattern(rawName);
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
      pattern: new RegExp(`^${src}$`),
      display: disp,
      matrix,
      reusable,
      if: j.if === undefined ? undefined : String(j.if),
      needs: list(j.needs) ?? [],
    });
  }
  return { path: file.path, name, prTriggers: triggers(on), jobs };
}

export function parseWorkflows(files: WorkflowFile[]): WorkflowInfo[] {
  return files.map(parseWorkflow);
}

export function producersOf(context: string, workflows: WorkflowInfo[]): JobInfo[] {
  return workflows.flatMap((w) => w.jobs.filter((j) => j.pattern.test(context)));
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
