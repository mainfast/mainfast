// `.mainfast.yml`, section `intact:`. The file is shared by the whole suite: Intact reads only
// its own section, ignores the other products' sections, and rejects unknown top-level keys
// (validation in @mainfast/shared/config; schema in schema/mainfast.schema.json).
//
// Lockfiles are CHECKED by default: a merge that drops main's lockfile bump can drop a
// security fix. `use_default_ignores: true` opts into ignoring them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MainfastConfigError,
  getSection,
  parseConfigDoc,
  resolveConfig,
  type ConfigDoc,
  type ExtendsFetcher,
} from "@mainfast/shared/config";
import { globToRegExp } from "@mainfast/shared/glob";
import { BRAND } from "./brand.ts";

export { globToRegExp };
export { MainfastConfigError as ConfigError } from "@mainfast/shared/config";

export type Level = "error" | "warning" | "notice" | "off";
export const LEVELS: Level[] = ["error", "warning", "notice", "off"];

export const INTACT_KEYS = ["enabled", "main_branch", "use_default_ignores", "ignore", "severity"] as const;

export interface Config {
  version: 1;
  mainBranch: string | undefined;
  ignore: string[];
  /** Ordered glob -> level. First match wins. */
  severity: Array<{ pattern: string; level: Level }>;
  source: string | undefined;
  /** The `extends:` value that was merged in (Pro). */
  extendedFrom?: string;
}

/** Ignored only with `use_default_ignores: true`. */
export const DEFAULT_IGNORE = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/bun.lock",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/go.sum",
];

export function defaultConfig(): Config {
  return { version: 1, mainBranch: undefined, ignore: [], severity: [], source: undefined };
}

/** Reads the `intact:` section of an already validated (and extends-resolved) document. */
export function configFromDoc(doc: ConfigDoc, source: string = BRAND.configFile): Config {
  const fail = (msg: string): never => {
    throw new MainfastConfigError(`${source}: ${BRAND.configSection}.${msg}`);
  };
  const raw = getSection(doc, "intact", { known: INTACT_KEYS, source });
  const cfg = defaultConfig();
  cfg.source = source;

  if (raw.main_branch !== undefined) {
    if (typeof raw.main_branch !== "string" || !raw.main_branch) fail("main_branch must be a string");
    cfg.mainBranch = raw.main_branch as string;
  }
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((x) => typeof x !== "string")) fail("ignore must be a list of path globs");
    cfg.ignore = raw.ignore as string[];
  }
  if (raw.use_default_ignores === true) cfg.ignore = [...DEFAULT_IGNORE, ...cfg.ignore];
  else if (raw.use_default_ignores !== undefined && raw.use_default_ignores !== false) fail("use_default_ignores must be true or false");

  if (raw.severity !== undefined) {
    if (typeof raw.severity !== "object" || raw.severity === null || Array.isArray(raw.severity)) {
      fail("severity must be a mapping of path glob to level");
    }
    for (const [pattern, level] of Object.entries(raw.severity as Record<string, unknown>)) {
      if (typeof level !== "string" || !LEVELS.includes(level as Level)) {
        fail(`severity for "${pattern}" must be one of ${LEVELS.join(", ")}`);
      }
      cfg.severity.push({ pattern, level: level as Level });
    }
  }
  return cfg;
}

/** Synchronous parse. A file with `extends:` needs {@link resolveIntactConfig}. */
export function parseConfig(text: string, source: string = BRAND.configFile): Config {
  const doc = parseConfigDoc(text, source);
  if (doc.extends !== undefined) {
    throw new MainfastConfigError(`${source}: extends needs repository access; resolve the config with resolveIntactConfig() first`);
  }
  return configFromDoc(doc, source);
}

/** Parse and apply `extends:` (Pro: org-wide shared config from another repository or path). */
export async function resolveIntactConfig(text: string | undefined, fetcher: ExtendsFetcher | undefined, source: string = BRAND.configFile): Promise<Config> {
  if (text === undefined) return defaultConfig();
  const { doc, extendedFrom } = await resolveConfig(text, fetcher, source);
  const cfg = configFromDoc(doc, source);
  if (extendedFrom) cfg.extendedFrom = extendedFrom;
  return cfg;
}

export function configPath(repoRoot: string, explicitPath?: string): string | undefined {
  if (explicitPath) {
    if (!existsSync(explicitPath)) throw new MainfastConfigError(`config file not found: ${explicitPath}`);
    return explicitPath;
  }
  const path = join(repoRoot, BRAND.configFile);
  return existsSync(path) ? path : undefined;
}

export function loadConfig(repoRoot: string, explicitPath?: string): Config {
  const path = configPath(repoRoot, explicitPath);
  return path ? parseConfig(readFileSync(path, "utf8"), path) : defaultConfig();
}

// --- matching ------------------------------------------------------------

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((g) => globToRegExp(g).test(path));
}

export function isIgnored(cfg: Config, ...paths: Array<string | null | undefined>): boolean {
  return paths.some((p) => p != null && matchesAny(p, cfg.ignore));
}

export function levelFor(cfg: Config, path: string, fallback: Level): Level {
  for (const s of cfg.severity) if (globToRegExp(s.pattern).test(path)) return s.level;
  return fallback;
}
