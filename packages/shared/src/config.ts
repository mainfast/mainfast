// The one `.mainfast.yml` file every product reads. Top level: `version`, `extends` and one
// section per product. Each product reads only its own section and ignores the others
// without a warning; an unknown top-level key is rejected everywhere, so a typo such as
// `intakt:` never silently switches a check back to its defaults.
// Schema: schema/mainfast.schema.json; prose: docs/config.md.
import { parse as parseYaml } from "yaml";
import { PRODUCT_SLUGS, SUITE, type ProductSlug } from "./brand.ts";

export const TOP_LEVEL_KEYS: readonly string[] = ["version", "extends", ...PRODUCT_SLUGS];

export class MainfastConfigError extends Error {}

export type ConfigDoc = Record<string, unknown>;

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Problems with the top level of a parsed document (empty when it is fine). */
export function topLevelProblems(doc: unknown, source: string = SUITE.configFile): string[] {
  if (doc === null || doc === undefined) return [];
  if (!isMapping(doc)) return [`${source}: top level must be a mapping`];
  const out: string[] = [];
  for (const k of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.includes(k)) out.push(`${source}: unknown top-level key "${k}" (known: ${TOP_LEVEL_KEYS.join(", ")})`);
  }
  if (doc.version !== undefined && doc.version !== 1) out.push(`${source}: unsupported version ${String(doc.version)} (only 1)`);
  if (doc.extends !== undefined) {
    try {
      if (typeof doc.extends !== "string") throw new MainfastConfigError("extends must be a string");
      parseExtends(doc.extends);
    } catch (e) {
      out.push(`${source}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Parse YAML text and validate the top level. Empty text is an empty document. Throws MainfastConfigError. */
export function parseConfigDoc(text: string | undefined | null, source: string = SUITE.configFile): ConfigDoc {
  if (!text || !text.trim()) return {};
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new MainfastConfigError(`${source}: invalid YAML: ${(e as Error).message.split("\n")[0]}`);
  }
  if (doc === null || doc === undefined) return {};
  const problems = topLevelProblems(doc, source);
  if (problems.length) throw new MainfastConfigError(problems.join("; "));
  return doc as ConfigDoc;
}

export interface SectionOptions {
  /** Keys the product understands; others are rejected. Omit to skip the check. */
  known?: readonly string[];
  source?: string;
}

/** One product's section of a parsed document ({} when absent). Throws MainfastConfigError. */
export function getSection(doc: ConfigDoc, slug: ProductSlug, opts: SectionOptions = {}): Record<string, unknown> {
  const raw = doc[slug];
  if (raw === undefined || raw === null) return {};
  if (!isMapping(raw)) throw new MainfastConfigError(`${slug}: expected a mapping`);
  if (opts.known) {
    for (const k of Object.keys(raw)) {
      if (!opts.known.includes(k)) throw new MainfastConfigError(`${slug}: unknown key "${k}" (known: ${opts.known.join(", ")})`);
    }
  }
  return raw;
}

/** parseConfigDoc + getSection in one step. */
export function loadSection(text: string | undefined | null, slug: ProductSlug, opts: SectionOptions = {}): Record<string, unknown> {
  return getSection(parseConfigDoc(text, opts.source), slug, opts);
}

// --- extends (Pro) ------------------------------------------------------------------------

export type ExtendsRef =
  | { kind: "repo"; owner: string; repo: string; path: string; ref?: string; raw: string }
  | { kind: "local"; path: string; raw: string };

/**
 * `owner/repo`, `owner/repo:path`, `owner/repo@ref`, `owner/repo:path@ref` (another repository,
 * read through the API; ref defaults to its default branch), or `./path` (this repository, read
 * at the same commit as the file that names it). The path defaults to `.mainfast.yml`.
 */
export function parseExtends(raw: string): ExtendsRef {
  const s = raw.trim();
  if (s.startsWith("./") || s.startsWith("/")) {
    const path = s.replace(/^\.?\//, "");
    if (!path || path.includes("..")) throw new MainfastConfigError(`extends: bad local path "${raw}"`);
    return { kind: "local", path, raw: s };
  }
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?::([^@]+))?(?:@(.+))?$/.exec(s);
  if (!m) throw new MainfastConfigError(`extends: expected owner/repo[:path][@ref] or ./path, got "${raw}"`);
  const path = (m[3] ?? SUITE.configFile).replace(/^\/+/, "");
  if (path.includes("..")) throw new MainfastConfigError(`extends: bad path "${raw}"`);
  return { kind: "repo", owner: m[1]!, repo: m[2]!, path, ref: m[4], raw: s };
}

/**
 * Deep merge of two documents, `child` over `parent`: mappings merge key by key with the
 * child's keys first (so first-match maps such as `intact.severity` try the child's patterns
 * first), lists concatenate parent then child without duplicates, scalars take the child's
 * value. `extends` itself is dropped.
 */
export function mergeConfigDocs(parent: ConfigDoc, child: ConfigDoc): ConfigDoc {
  const merged = mergeValue(parent, child) as ConfigDoc;
  delete merged.extends;
  return merged;
}

function mergeValue(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (isMapping(a) && isMapping(b)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) out[k] = k in a ? mergeValue(a[k], v) : v;
    for (const [k, v] of Object.entries(a)) if (!(k in out)) out[k] = v;
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [...a];
    for (const x of b) if (!out.some((y) => JSON.stringify(y) === JSON.stringify(x))) out.push(x);
    return out;
  }
  return b;
}

export interface ExtendsFetcher {
  /** File from another repository; undefined when it does not exist. */
  repoFile(owner: string, repo: string, path: string, ref?: string): Promise<string | undefined>;
  /** File from this repository at the commit the config was read from. */
  localFile(path: string): Promise<string | undefined>;
}

export interface ResolvedConfig {
  doc: ConfigDoc;
  /** The `extends` value that was applied. */
  extendedFrom?: string;
}

/** Parse `text`, then apply its `extends` (one level; the shared file may not extend again). */
export async function resolveConfig(text: string | undefined | null, fetcher: ExtendsFetcher | undefined, source: string = SUITE.configFile): Promise<ResolvedConfig> {
  const doc = parseConfigDoc(text, source);
  if (typeof doc.extends !== "string") return { doc };
  const ref = parseExtends(doc.extends);
  if (!fetcher) throw new MainfastConfigError(`${source}: extends "${ref.raw}" needs repository access, which is not available here`);
  let parentText: string | undefined;
  try {
    parentText = ref.kind === "local" ? await fetcher.localFile(ref.path) : await fetcher.repoFile(ref.owner, ref.repo, ref.path, ref.ref);
  } catch (e) {
    throw new MainfastConfigError(`${source}: extends "${ref.raw}": could not read it (${(e as Error).message})`);
  }
  if (parentText === undefined) {
    const hint = ref.kind === "repo" ? " (for a private repository, give the action a `config-token` that can read it)" : "";
    throw new MainfastConfigError(`${source}: extends "${ref.raw}" not found${hint}`);
  }
  const parent = parseConfigDoc(parentText, ref.raw);
  if (parent.extends !== undefined) throw new MainfastConfigError(`${ref.raw}: extends chains are not supported (the shared config may not use extends)`);
  return { doc: mergeConfigDocs(parent, doc), extendedFrom: ref.raw };
}
