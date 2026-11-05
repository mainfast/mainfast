// `.mainfast.yml`, section `rollcall:`.
import { getSection, loadSection, type ConfigDoc } from '@mainfast/shared/config';
import { CONFIG_SECTION } from './brand.js';

export type Level = 'error' | 'warning' | 'never';

export interface RollcallConfig {
  branch?: string;
  /** Recently merged PRs to sample. */
  pulls: number;
  /** Open PRs to sample as well (0 = none). */
  openPulls: number;
  ignore: string[];
  stoppedAfter: number;
  failOn: Level;
  /** Lowest finding level that opens (or keeps open) the tracking issue, or never. */
  issueOn: Level;
}

export const KNOWN_KEYS = ['branch', 'pulls', 'openPulls', 'ignore', 'stoppedAfter', 'failOn', 'issueOn'] as const;

export const DEFAULT_CONFIG: RollcallConfig = { pulls: 20, openPulls: 10, ignore: [], stoppedAfter: 2, failOn: 'error', issueOn: 'error' };

export function level(key: string, v: unknown): Level {
  const s = String(v);
  if (!['error', 'warning', 'never'].includes(s)) throw new Error(`${CONFIG_SECTION}.${key}: expected error, warning or never`);
  return s as Level;
}

function int(key: string, v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${CONFIG_SECTION}.${key}: expected ${min}..${max}`);
  return n;
}

function fromSection(raw: Record<string, unknown>): RollcallConfig {
  const cfg = { ...DEFAULT_CONFIG };
  if (raw.branch !== undefined) cfg.branch = String(raw.branch);
  if (raw.pulls !== undefined) cfg.pulls = int('pulls', raw.pulls, 1, 100);
  if (raw.openPulls !== undefined) cfg.openPulls = int('openPulls', raw.openPulls, 0, 100);
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore)) throw new Error(`${CONFIG_SECTION}.ignore: expected a list of check names`);
    cfg.ignore = raw.ignore.map(String);
  }
  if (raw.stoppedAfter !== undefined) cfg.stoppedAfter = int('stoppedAfter', raw.stoppedAfter, 0, 100);
  if (raw.failOn !== undefined) cfg.failOn = level('failOn', raw.failOn);
  if (raw.issueOn !== undefined) cfg.issueOn = level('issueOn', raw.issueOn);
  return cfg;
}

export function parseConfig(text: string | undefined): RollcallConfig {
  if (!text) return { ...DEFAULT_CONFIG };
  // Validates the top level (unknown keys rejected) and ignores the other products' sections.
  return fromSection(loadSection(text, CONFIG_SECTION, { known: KNOWN_KEYS }));
}

/** From an already parsed (and `extends`-resolved) document. */
export function configFromDoc(doc: ConfigDoc): RollcallConfig {
  return fromSection(getSection(doc, CONFIG_SECTION, { known: KNOWN_KEYS }));
}

/** Whether the findings reach `level`. */
export function reaches(findings: Array<{ severity: 'error' | 'warning' }>, lvl: Level): boolean {
  if (lvl === 'never') return false;
  return lvl === 'warning' ? findings.length > 0 : findings.some((f) => f.severity === 'error');
}
