import { CONFIG_FILE, CONFIG_FILE_ALT } from './brand.js';
import { parseConfig, type MigrationsConfig } from './config.js';
import { frameworks } from './frameworks/index.js';
import { mergeBase, mergedTree, revParse, Tree } from './git.js';
import { matchesAny } from '@mainfast/shared/glob';
import { FRAMEWORKS, type Finding, type FrameworkId } from './types.js';

export interface MigrationRoot {
  framework: FrameworkId;
  root: string;
  /** The branch added, changed or removed files under this root. */
  touched: boolean;
}

export interface MigrationsReport {
  ok: boolean;
  main: { ref: string; sha: string };
  head: { ref: string; sha: string };
  mergeBase: string;
  roots: MigrationRoot[];
  /** Problems this PR would bring to main. */
  findings: Finding[];
  /** Problems main already has; not this PR's fault, reported for context. */
  preExisting: Finding[];
}

export interface AnalyzeOptions {
  repo: string;
  mainRef: string;
  headRef: string;
  /** Config to use; when omitted, `.mainfast.yml` is read from mainRef. */
  config?: MigrationsConfig;
}

export function loadConfigFromRef(tree: Tree): MigrationsConfig {
  const text = tree.read(CONFIG_FILE) ?? tree.read(CONFIG_FILE_ALT);
  return parseConfig(text);
}

function touched(base: Tree, head: Tree, root: string): boolean {
  const prefix = `${root}/`;
  for (const [p, blob] of head.entries) {
    if (!p.startsWith(prefix)) continue;
    const b = base.entries.get(p);
    if (!b || ('sha' in b && 'sha' in blob && b.sha !== blob.sha)) return true;
  }
  for (const p of base.under(root)) if (!head.has(p)) return true;
  return false;
}

export function discoverRoots(main: Tree, head: Tree, config: MigrationsConfig): Array<{ framework: FrameworkId; root: string }> {
  const ids = config.frameworks === 'auto' ? [...FRAMEWORKS] : config.frameworks;
  const files = [...new Set([...main.files(), ...head.files()])];
  const read = (p: string) => head.read(p) ?? main.read(p);
  const out: Array<{ framework: FrameworkId; root: string }> = [];
  for (const id of ids) {
    const explicit = config.paths[id];
    const roots = explicit?.length ? explicit : frameworks[id].detect(files, read);
    for (const root of roots) if (!matchesAny(root, config.ignore)) out.push({ framework: id, root });
  }
  return out;
}

export function analyze(opts: AnalyzeOptions): MigrationsReport {
  const mainSha = revParse(opts.repo, opts.mainRef);
  const headSha = revParse(opts.repo, opts.headRef);
  const baseSha = mergeBase(opts.repo, mainSha, headSha);
  if (!baseSha)
    throw new Error(
      `no merge-base between ${opts.mainRef} and ${opts.headRef}; fetch full history (actions/checkout with fetch-depth: 0)`,
    );
  const main = Tree.atRef(opts.repo, mainSha, opts.mainRef);
  const head = Tree.atRef(opts.repo, headSha, opts.headRef);
  const base = baseSha === mainSha ? main : Tree.atRef(opts.repo, baseSha, 'merge-base');
  const config = opts.config ?? loadConfigFromRef(main);
  return analyzeTrees({ main, head, base, mainRef: opts.mainRef, headRef: opts.headRef, mainSha, headSha, baseSha, config });
}

export interface AnalyzeTreesOptions {
  main: Tree;
  head: Tree;
  base: Tree;
  mainRef: string;
  headRef: string;
  mainSha: string;
  headSha: string;
  baseSha: string;
  config: MigrationsConfig;
}

/** The analysis itself, on trees from any source: `analyze` builds them with git, the hosted App through the API. */
export function analyzeTrees(opts: AnalyzeTreesOptions): MigrationsReport {
  const { main, head, base, mainSha, headSha, baseSha, config } = opts;
  const roots: MigrationRoot[] = [];
  const findings: Finding[] = [];
  const preExisting: Finding[] = [];
  for (const { framework: id, root } of discoverRoots(main, head, config)) {
    const fw = frameworks[id];
    roots.push({ framework: id, root, touched: touched(base, head, root) });
    const merged = mergedTree(base, main, head, root, fw.mergeFile);
    const onMain = fw.inspect(main, root);
    const mainKeys = new Set(onMain.map((f) => f.key));
    const afterMerge = fw.inspect(merged, root);
    findings.push(...afterMerge.filter((f) => !mainKeys.has(f.key)));
    preExisting.push(...onMain);
    if (fw.compare) findings.push(...fw.compare({ root, base, main, head, outOfOrder: config.outOfOrder[id] }));
  }
  const seen = new Set<string>();
  const unique = findings.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
  return {
    ok: !unique.some((f) => f.severity === 'error'),
    main: { ref: opts.mainRef, sha: mainSha },
    head: { ref: opts.headRef, sha: headSha },
    mergeBase: baseSha,
    roots,
    findings: unique,
    preExisting,
  };
}
