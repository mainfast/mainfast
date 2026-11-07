// `.mainfast.yml`, section `owners:`.
import { getSection, loadSection, type ConfigDoc } from '@mainfast/shared/config';
import { CONFIG_SECTION } from './brand.js';

export type Level = 'error' | 'warning' | 'never';

export interface OwnersConfig {
  /**
   * Scheduled audit: an owner with no PR review in this many days is dormant. 0 turns the check
   * off. Never run on pull requests (one search per owner per push would exhaust the search API).
   */
  dormantDays: number;
  /** Search API requests one audit may make for the dormancy check (30 a minute allowed). */
  maxSearches: number;
  /** Paths that do not need an owner (globs). */
  ignore: string[];
  /** Owners (as written, e.g. "@org/bots") that are not validated. */
  skipOwners: string[];
  /** Fail a PR that touches unowned files. */
  requireOwners: boolean;
  /** Check team members for dormancy too (one search per member; needs org-token). */
  expandTeams: boolean;
  failOn: Level;
}

export const KNOWN_KEYS = ['enabled', 'dormantDays', 'maxSearches', 'ignore', 'skipOwners', 'requireOwners', 'expandTeams', 'failOn'] as const;

export const DEFAULT_CONFIG: OwnersConfig = {
  dormantDays: 180,
  maxSearches: 100,
  ignore: [],
  skipOwners: [],
  requireOwners: true,
  expandTeams: false,
  failOn: 'error',
};

export function level(key: string, v: unknown): Level {
  const s = String(v);
  if (!['error', 'warning', 'never'].includes(s)) throw new Error(`${key}: expected error, warning or never`);
  return s as Level;
}

export function wholeNumber(key: string, v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (v === '' || v === null || typeof v === 'boolean' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${key}: expected a whole number ${min}..${max}`);
  return n;
}

function fromSection(raw: Record<string, unknown>): OwnersConfig {
  const cfg = { ...DEFAULT_CONFIG };
  const strs = (k: string) => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) throw new Error(`${CONFIG_SECTION}.${k}: expected a list`);
    return v.map(String);
  };
  const bool = (k: string) => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') throw new Error(`${CONFIG_SECTION}.${k}: expected true or false`);
    return v;
  };
  if (raw.dormantDays !== undefined) cfg.dormantDays = wholeNumber(`${CONFIG_SECTION}.dormantDays`, raw.dormantDays, 0, 3650);
  if (raw.maxSearches !== undefined) cfg.maxSearches = wholeNumber(`${CONFIG_SECTION}.maxSearches`, raw.maxSearches, 1, 1000);
  cfg.ignore = strs('ignore') ?? cfg.ignore;
  cfg.skipOwners = strs('skipOwners') ?? cfg.skipOwners;
  cfg.requireOwners = bool('requireOwners') ?? cfg.requireOwners;
  cfg.expandTeams = bool('expandTeams') ?? cfg.expandTeams;
  if (raw.failOn !== undefined) cfg.failOn = level(`${CONFIG_SECTION}.failOn`, raw.failOn);
  return cfg;
}

export function parseConfig(text: string | undefined): OwnersConfig {
  if (!text) return { ...DEFAULT_CONFIG };
  // Validates the top level (unknown keys rejected) and ignores the other products' sections.
  return fromSection(loadSection(text, CONFIG_SECTION, { known: KNOWN_KEYS }));
}

/** From an already parsed (and `extends`-resolved) document. */
export function configFromDoc(doc: ConfigDoc): OwnersConfig {
  return fromSection(getSection(doc, CONFIG_SECTION, { known: KNOWN_KEYS }));
}

/** Whether the findings reach `lvl` (proposed-file findings already on the base never count as errors). */
export function reaches(findings: Array<{ severity: 'error' | 'warning' }>, lvl: Level): boolean {
  if (lvl === 'never') return false;
  return lvl === 'warning' ? findings.length > 0 : findings.some((f) => f.severity === 'error');
}
