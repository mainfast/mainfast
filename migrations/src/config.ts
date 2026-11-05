// `.mainfast.yml`, section `migrations:`. Read from main (the base), never from the
// PR head, so a PR cannot switch its own check off.
import { loadSection } from '@mainfast/shared/config';
import { CONFIG_SECTION, DEFAULT_STALE_LABEL } from './brand.js';
import { FRAMEWORKS, type FrameworkId, type OrderPolicy } from './types.js';

const POLICIES: readonly OrderPolicy[] = ['error', 'warning', 'off'];

/**
 * Default severity of an ordering conflict per framework. Rails and Flyway can be told to
 * apply an older migration on databases that are past it (Rails always does; Flyway with
 * outOfOrder=true), so it is a warning there. Prisma and Drizzle produce drift or a forked
 * journal: error. Alembic and Django ledgers are graphs with no version order; their forks
 * (multiple heads, conflicting leaves) are always errors and the entry is kept for symmetry.
 */
export const DEFAULT_OUT_OF_ORDER: Readonly<Record<FrameworkId, OrderPolicy>> = {
  alembic: 'error',
  django: 'error',
  prisma: 'error',
  rails: 'warning',
  flyway: 'warning',
  drizzle: 'error',
};

export interface MigrationsConfig {
  /** Frameworks to run; "auto" detects them from the tree. */
  frameworks: FrameworkId[] | 'auto';
  /** Explicit migration directories per framework; replaces autodetect for that framework. */
  paths: Partial<Record<FrameworkId, string[]>>;
  /** Globs of migration directories to skip. */
  ignore: string[];
  /** Severity of "branch migration is not newer than main's latest" (and a Drizzle journal fork), per framework. */
  outOfOrder: Record<FrameworkId, OrderPolicy>;
  /** Label put on open PRs that went stale when main moved. */
  label: string;
}

export const KNOWN_KEYS = ['frameworks', 'paths', 'ignore', 'outOfOrder', 'label'] as const;

export const DEFAULT_CONFIG: MigrationsConfig = {
  frameworks: 'auto',
  paths: {},
  ignore: [],
  outOfOrder: { ...DEFAULT_OUT_OF_ORDER },
  label: DEFAULT_STALE_LABEL,
};

function strList(v: unknown, where: string): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  if (!arr.every((x) => typeof x === 'string')) throw new Error(`${where}: expected a list of strings`);
  return (arr as string[]).map((s) => s.replace(/^\.\//, '').replace(/\/$/, ''));
}

function isFramework(x: string): x is FrameworkId {
  return (FRAMEWORKS as readonly string[]).includes(x);
}

export function parseConfig(text: string | undefined): MigrationsConfig {
  if (!text) return { ...DEFAULT_CONFIG, paths: {}, outOfOrder: { ...DEFAULT_OUT_OF_ORDER } };
  // Validates the top level (unknown keys rejected) and ignores the other products' sections.
  const raw = loadSection(text, CONFIG_SECTION, { known: KNOWN_KEYS });
  const cfg: MigrationsConfig = { ...DEFAULT_CONFIG, paths: {}, outOfOrder: { ...DEFAULT_OUT_OF_ORDER } };

  if (raw.frameworks !== undefined && raw.frameworks !== 'auto') {
    const list = strList(raw.frameworks, `${CONFIG_SECTION}.frameworks`);
    const bad = list.filter((f) => !isFramework(f));
    if (bad.length) throw new Error(`${CONFIG_SECTION}.frameworks: unknown ${bad.join(', ')} (known: ${FRAMEWORKS.join(', ')})`);
    cfg.frameworks = list as FrameworkId[];
  }
  if (raw.paths !== undefined) {
    if (typeof raw.paths !== 'object' || raw.paths === null || Array.isArray(raw.paths))
      throw new Error(`${CONFIG_SECTION}.paths: expected a mapping of framework -> directories`);
    for (const [k, v] of Object.entries(raw.paths)) {
      if (!isFramework(k)) throw new Error(`${CONFIG_SECTION}.paths: unknown framework ${k}`);
      cfg.paths[k] = strList(v, `${CONFIG_SECTION}.paths.${k}`);
    }
  }
  cfg.ignore = strList(raw.ignore, `${CONFIG_SECTION}.ignore`);
  if (raw.outOfOrder !== undefined) cfg.outOfOrder = parseOutOfOrder(raw.outOfOrder);
  if (raw.label !== undefined) cfg.label = String(raw.label);
  return cfg;
}

const isPolicy = (v: unknown): v is OrderPolicy => typeof v === 'string' && (POLICIES as readonly string[]).includes(v);

/** `outOfOrder: warning` (every framework) or `outOfOrder: { rails: warning, prisma: off }` (the rest keep their default). */
export function parseOutOfOrder(v: unknown): Record<FrameworkId, OrderPolicy> {
  const where = `${CONFIG_SECTION}.outOfOrder`;
  // YAML 1.1 habits: a bare `off` or `no` may arrive as false
  const norm = (x: unknown) => (x === false ? 'off' : x);
  if (typeof v !== 'object' || v === null) {
    const p = norm(v);
    if (!isPolicy(p)) throw new Error(`${where}: expected error, warning, off or a map of framework -> severity`);
    return Object.fromEntries(FRAMEWORKS.map((f) => [f, p])) as Record<FrameworkId, OrderPolicy>;
  }
  if (Array.isArray(v)) throw new Error(`${where}: expected error, warning, off or a map of framework -> severity`);
  const out = { ...DEFAULT_OUT_OF_ORDER };
  for (const [k, raw] of Object.entries(v)) {
    if (!isFramework(k)) throw new Error(`${where}: unknown framework ${k} (known: ${FRAMEWORKS.join(', ')})`);
    const p = norm(raw);
    if (!isPolicy(p)) throw new Error(`${where}.${k}: expected error, warning or off`);
    out[k] = p;
  }
  return out;
}
