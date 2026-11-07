// `.mainfast.yml` -> `evidence:` section -> EvidencePolicy. Unknown keys are reported, not fatal,
// so a typo shows up in the evidence card instead of silently loosening the gate.
import { topLevelProblems } from "@mainfast/shared/config";
import { parse as parseYaml } from "yaml";
import { CONFIG_FILE, CONFIG_SECTION } from "./constants.ts";
import { FLAG_IDS, type FlagId, type Severity } from "./types.ts";

export interface AgentMatchers {
  /** Include the built-in catalog (Claude Code, Copilot, Codex, Cursor, Devin, Dawnpatch, Aider). */
  useDefaults: boolean;
  /** GitHub logins (PR author or commit author) that count as agents. Exact, case-insensitive. */
  authors: string[];
  branchPrefixes: string[];
  labels: string[];
  /** Regexes matched against each commit message (trailers live there). */
  trailers: string[];
  /** Commit author / committer emails that count as agents. */
  emails: string[];
}

export interface EvidencePolicy {
  applyTo: "agents" | "all";
  agents: AgentMatchers;
  flags: Record<FlagId, Severity>;
  /** Check-run / status names that count as tests. Plain text = case-insensitive substring; /re/ = regex. */
  testChecks: string[];
  /** Required checks in addition to those GitHub reports for the base branch. */
  requiredChecks: string[];
  /** Checks to ignore entirely (e.g. other bots). This tool's own check is always ignored. */
  ignoreChecks: string[];
  coverage: { files: string[]; minChangedLinesPct: number };
  diff: { maxLines: number; maxFiles: number; exclude: string[] };
  paths: {
    workflows: string[];
    codeowners: string[];
    lockfiles: string[];
    tests: string[];
    testConfig: string[];
    policy: string[];
  };
  /** `allow`: regexes tested against the extracted secret value only, never the surrounding line. */
  secrets: { allow: string[] };
  /** Conclusion to use when only warnings fired. */
  warnConclusion: "success" | "neutral";
}

export const DEFAULT_FLAGS: Record<FlagId, Severity> = {
  tests_not_run_on_head: "fail",
  tests_failed: "fail",
  tests_skipped: "warn",
  tests_empty: "fail",
  required_check_missing: "fail",
  required_check_skipped: "fail",
  required_check_failed: "warn",
  coverage_below_threshold: "warn",
  coverage_missing: "off",
  touched_workflows: "fail",
  touched_codeowners: "fail",
  touched_lockfiles: "warn",
  touched_tests: "warn",
  touched_test_config: "warn",
  touched_policy: "fail",
  tests_deleted: "fail",
  tests_removed: "fail",
  assertions_dropped: "fail",
  assertions_commented_out: "fail",
  skip_added: "fail",
  focus_added: "fail",
  trivial_assertion_added: "warn",
  claim_tests_added_unbacked: "fail",
  claim_tests_pass_unbacked: "fail",
  diff_too_large: "warn",
  secret_like_string: "fail",
  diff_unanalyzed: "warn",
};

export const DEFAULT_PATHS: EvidencePolicy["paths"] = {
  workflows: [
    ".github/workflows/**",
    ".github/actions/**",
    ".gitlab-ci.yml",
    ".circleci/**",
    ".buildkite/**",
    "azure-pipelines.yml",
    "/Jenkinsfile",
    ".pre-commit-config.yaml",
  ],
  codeowners: ["/CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"],
  lockfiles: [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "pdm.lock",
    "go.sum",
    "Cargo.lock",
    "Gemfile.lock",
    "composer.lock",
    "packages.lock.json",
  ],
  tests: [
    "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/test_*.py",
    "**/*_test.py",
    "**/conftest.py",
    "**/*_test.go",
    "**/testdata/**",
  ],
  testConfig: [
    "jest.config.*",
    "vitest.config.*",
    "vitest.workspace.*",
    "playwright.config.*",
    "karma.conf.*",
    ".mocharc*",
    "pytest.ini",
    "tox.ini",
    ".coveragerc",
    "codecov.yml",
    ".codecov.yml",
  ],
  policy: [`/${CONFIG_FILE}`, "/.mainfast.yaml"],
};

export const DEFAULT_TEST_CHECKS = [
  "/(^|[^a-z])(tests?|specs?|jest|vitest|pytest|mocha|unit|integration|e2e|rspec|go-test|gotest)([^a-z]|$)/i",
];

export function defaultPolicy(): EvidencePolicy {
  return {
    applyTo: "agents",
    agents: { useDefaults: true, authors: [], branchPrefixes: [], labels: [], trailers: [], emails: [] },
    flags: { ...DEFAULT_FLAGS },
    testChecks: [...DEFAULT_TEST_CHECKS],
    requiredChecks: [],
    ignoreChecks: [],
    coverage: { files: [], minChangedLinesPct: 80 },
    diff: { maxLines: 1500, maxFiles: 60, exclude: [] },
    paths: structuredClone(DEFAULT_PATHS),
    secrets: { allow: [] },
    warnConclusion: "success",
  };
}

export interface LoadedPolicy {
  policy: EvidencePolicy;
  warnings: string[];
}

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strList(v: unknown, key: string, warnings: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.map(String);
  warnings.push(`${key}: expected a list of strings`);
  return undefined;
}

function num(v: unknown, key: string, warnings: string[]): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  warnings.push(`${key}: expected a non-negative number`);
  return undefined;
}

function unknownKeys(obj: Raw, allowed: string[], prefix: string, warnings: string[]): void {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) warnings.push(`${prefix}${k}: unknown key, ignored`);
}

/** Parse the whole `.mainfast.yml` text. A file without an `evidence:` section yields defaults. */
export function parsePolicy(yamlText: string | undefined | null): LoadedPolicy {
  const warnings: string[] = [];
  const policy = defaultPolicy();
  if (!yamlText || !yamlText.trim()) return { policy, warnings };
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    warnings.push(`${CONFIG_FILE}: YAML parse error, using defaults (${(err as Error).message.split("\n")[0]})`);
    return { policy, warnings };
  }
  // Other products' sections are ignored; unknown top-level keys are reported like any other typo.
  warnings.push(...topLevelProblems(doc, CONFIG_FILE));
  if (!isObj(doc)) return { policy, warnings };
  const raw = doc[CONFIG_SECTION];
  if (raw === undefined || raw === null) return { policy, warnings };
  if (!isObj(raw)) {
    warnings.push(`${CONFIG_SECTION}: expected a mapping`);
    return { policy, warnings };
  }
  const p = `${CONFIG_SECTION}.`;
  unknownKeys(
    raw,
    ["enabled", "apply_to", "agents", "flags", "test_checks", "required_checks", "ignore_checks", "coverage", "diff", "paths", "secrets", "warn_conclusion"],
    p,
    warnings,
  );

  if (raw.apply_to !== undefined) {
    if (raw.apply_to === "agents" || raw.apply_to === "all") policy.applyTo = raw.apply_to;
    else warnings.push(`${p}apply_to: expected "agents" or "all"`);
  }
  if (raw.warn_conclusion !== undefined) {
    if (raw.warn_conclusion === "success" || raw.warn_conclusion === "neutral") policy.warnConclusion = raw.warn_conclusion;
    else warnings.push(`${p}warn_conclusion: expected "success" or "neutral"`);
  }

  if (raw.agents !== undefined) {
    if (!isObj(raw.agents)) warnings.push(`${p}agents: expected a mapping`);
    else {
      const a = raw.agents;
      unknownKeys(a, ["use_defaults", "authors", "branch_prefixes", "labels", "trailers", "emails"], `${p}agents.`, warnings);
      if (a.use_defaults !== undefined) policy.agents.useDefaults = a.use_defaults !== false;
      policy.agents.authors = strList(a.authors, `${p}agents.authors`, warnings) ?? [];
      policy.agents.branchPrefixes = strList(a.branch_prefixes, `${p}agents.branch_prefixes`, warnings) ?? [];
      policy.agents.labels = strList(a.labels, `${p}agents.labels`, warnings) ?? [];
      policy.agents.emails = strList(a.emails, `${p}agents.emails`, warnings) ?? [];
      const trailers = strList(a.trailers, `${p}agents.trailers`, warnings) ?? [];
      policy.agents.trailers = trailers.filter((t) => {
        try {
          new RegExp(t, "im");
          return true;
        } catch {
          warnings.push(`${p}agents.trailers: invalid regex ${JSON.stringify(t)}`);
          return false;
        }
      });
    }
  }

  if (raw.flags !== undefined) {
    if (!isObj(raw.flags)) warnings.push(`${p}flags: expected a mapping of flag -> fail|warn|off`);
    else
      for (const [k, v] of Object.entries(raw.flags)) {
        if (!(FLAG_IDS as readonly string[]).includes(k)) {
          warnings.push(`${p}flags.${k}: unknown flag, ignored`);
          continue;
        }
        const sev = v === false ? "off" : v;
        if (sev === "fail" || sev === "warn" || sev === "off") policy.flags[k as FlagId] = sev;
        else warnings.push(`${p}flags.${k}: expected fail, warn or off`);
      }
  }

  const tc = strList(raw.test_checks, `${p}test_checks`, warnings);
  if (tc) policy.testChecks = tc;
  policy.requiredChecks = strList(raw.required_checks, `${p}required_checks`, warnings) ?? [];
  policy.ignoreChecks = strList(raw.ignore_checks, `${p}ignore_checks`, warnings) ?? [];

  if (raw.coverage !== undefined) {
    if (!isObj(raw.coverage)) warnings.push(`${p}coverage: expected a mapping`);
    else {
      unknownKeys(raw.coverage, ["files", "min_changed_lines"], `${p}coverage.`, warnings);
      policy.coverage.files = strList(raw.coverage.files, `${p}coverage.files`, warnings) ?? [];
      const m = num(raw.coverage.min_changed_lines, `${p}coverage.min_changed_lines`, warnings);
      if (m !== undefined) policy.coverage.minChangedLinesPct = Math.min(100, m);
    }
  }

  if (raw.diff !== undefined) {
    if (!isObj(raw.diff)) warnings.push(`${p}diff: expected a mapping`);
    else {
      unknownKeys(raw.diff, ["max_lines", "max_files", "exclude"], `${p}diff.`, warnings);
      policy.diff.maxLines = num(raw.diff.max_lines, `${p}diff.max_lines`, warnings) ?? policy.diff.maxLines;
      policy.diff.maxFiles = num(raw.diff.max_files, `${p}diff.max_files`, warnings) ?? policy.diff.maxFiles;
      policy.diff.exclude = strList(raw.diff.exclude, `${p}diff.exclude`, warnings) ?? [];
    }
  }

  if (raw.paths !== undefined) {
    if (!isObj(raw.paths)) warnings.push(`${p}paths: expected a mapping`);
    else {
      const map: Record<string, keyof EvidencePolicy["paths"]> = {
        workflows: "workflows",
        codeowners: "codeowners",
        lockfiles: "lockfiles",
        tests: "tests",
        test_config: "testConfig",
      };
      unknownKeys(raw.paths, Object.keys(map), `${p}paths.`, warnings);
      for (const [yamlKey, key] of Object.entries(map)) {
        const v = strList(raw.paths[yamlKey], `${p}paths.${yamlKey}`, warnings);
        if (v) policy.paths[key] = v; // a list replaces the defaults for that category
      }
    }
  }

  if (raw.secrets !== undefined) {
    if (!isObj(raw.secrets)) warnings.push(`${p}secrets: expected a mapping`);
    else {
      unknownKeys(raw.secrets, ["allow"], `${p}secrets.`, warnings);
      // Each pattern is matched against the secret value the rule extracted, not the line around it.
      policy.secrets.allow = (strList(raw.secrets.allow, `${p}secrets.allow`, warnings) ?? []).filter((a) => {
        try {
          new RegExp(a);
          return true;
        } catch {
          warnings.push(`${p}secrets.allow: invalid regex ${JSON.stringify(a)}`);
          return false;
        }
      });
    }
  }

  return { policy, warnings };
}

/** `name`, or `/regex/flags`. Plain names match case-insensitively as substrings. */
export function nameMatcher(pattern: string): (name: string) => boolean {
  const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (m) {
    try {
      const re = new RegExp(m[1]!, m[2]);
      return (name) => re.test(name);
    } catch {
      /* fall through to substring */
    }
  }
  const needle = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}
