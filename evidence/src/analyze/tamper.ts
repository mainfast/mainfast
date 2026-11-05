// Tamper signals: the agent touched the things that decide whether its own work is judged
// (workflows, CODEOWNERS, test config, the policy file, lockfiles), or weakened the tests.
import type { EvidencePolicy } from "../config.ts";
import { matchesAny } from "@mainfast/shared/glob";
import type { FileChange } from "../types.ts";
import { parseHunks, type DiffLine } from "../diff/patch.ts";
import type { Finding } from "./finding.ts";

export type TestLang = "js" | "python" | "go";

interface LangRules {
  testCase: RegExp;
  assertion: RegExp; // global: every match on a line counts
  skip: RegExp;
  focus?: RegExp;
  trivial: RegExp;
  comment: RegExp;
}

export const LANG_RULES: Record<TestLang, LangRules> = {
  js: {
    testCase: /(?:^|[\s;(,])[xf]?(?:it|test)(?:\.[a-zA-Z]+)*\s*(?:\(|`)/,
    assertion:
      /\bexpect\s*\(|\bexpect\.(?:assertions|hasAssertions)\s*\(|\bassert(?:\.[a-zA-Z]+)?\s*\(|\.should\b|\bt\.(?:is|not|deepEqual|notDeepEqual|true|false|truthy|falsy|throws|throwsAsync|regex|snapshot|like)\s*\(/g,
    skip: /\b(?:it|test|describe|context|suite)\.(?:skip|todo|skipIf)\b|(?:^|[^\w.])x(?:it|test|describe|context)\s*\(|\bthis\.skip\s*\(/,
    focus: /\b(?:it|test|describe|context|suite)\.only\b|(?:^|[^\w.])f(?:it|describe)\s*\(/,
    trivial:
      /\bexpect\s*\(\s*(true|false|1|0|null|undefined|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)|\bexpect\s*\(\s*(?:true|1)\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)|\bassert(?:\.ok)?\s*\(\s*true\s*\)/,
    comment: /^\s*(?:\/\/|\/\*|\*)/,
  },
  python: {
    testCase: /^\s*(?:async\s+)?def\s+test\w*\s*\(/,
    assertion: /(?:^|\s)assert[\s(]|\bself\.assert[A-Z]\w*\s*\(|\bpytest\.raises\s*\(|\bself\.fail\s*\(/g,
    skip: /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b|\bpytest\.(?:skip|xfail)\s*\(|\bself\.skipTest\s*\(/,
    trivial: /^\s*assert\s+(?:True|1|not\s+False)\s*(?:$|#)|\bself\.assertTrue\(\s*True\s*\)|^\s*assert\s+(\w+)\s*==\s*\1\s*(?:$|#)/,
    comment: /^\s*#/,
  },
  go: {
    testCase: /^func\s+(?:Test|Fuzz)\w*\s*\(|\bt\.Run\s*\(/,
    assertion: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(|\b(?:assert|require)\.[A-Z]\w*\s*\(/g,
    skip: /\bt\.(?:Skip|Skipf|SkipNow)\s*\(/,
    trivial: /\b(?:assert|require)\.True\(\s*t\s*,\s*true\s*\)|\b(?:assert|require)\.Equal\(\s*t\s*,\s*(\w+|"[^"]*")\s*,\s*\1\s*\)/,
    comment: /^\s*(?:\/\/|\/\*|\*)/,
  },
};

export function langOf(path: string): TestLang | undefined {
  if (/\.(?:[cm]?[jt]sx?)$/.test(path)) return "js";
  if (/\.py$/.test(path)) return "python";
  if (/\.go$/.test(path)) return "go";
  return undefined;
}

function countMatches(re: RegExp, text: string): number {
  re.lastIndex = 0;
  return (text.match(re) ?? []).length;
}

function stripComment(text: string, lang: TestLang): string {
  return lang === "python" ? text.replace(/^\s*#\s?/, "") : text.replace(/^\s*(?:\/\/|\/\*+|\*)\s?/, "");
}

export interface TestFileStats {
  path: string;
  lang: TestLang;
  status: FileChange["status"];
  assertionsAdded: number;
  assertionsRemoved: number;
  casesAdded: number;
  casesRemoved: number;
  skips: DiffLine[];
  focus: DiffLine[];
  trivial: DiffLine[];
  commentedOut: DiffLine[];
}

export function analyzeTestFile(fc: FileChange): TestFileStats | undefined {
  const lang = langOf(fc.path);
  if (!lang) return undefined;
  const r = LANG_RULES[lang];
  const st: TestFileStats = {
    path: fc.path,
    lang,
    status: fc.status,
    assertionsAdded: 0,
    assertionsRemoved: 0,
    casesAdded: 0,
    casesRemoved: 0,
    skips: [],
    focus: [],
    trivial: [],
    commentedOut: [],
  };
  const lines = parseHunks(fc.patch);
  // A skip/focus marker that was already there (same text removed and re-added) is not new.
  const removedText = new Set(lines.filter((l) => l.kind === "del").map((l) => l.text.trim()));
  for (const l of lines) {
    const isComment = r.comment.test(l.text);
    if (isComment) {
      if (l.kind === "add" && countMatches(r.assertion, stripComment(l.text, lang)) > 0) st.commentedOut.push(l);
      continue;
    }
    const a = countMatches(r.assertion, l.text);
    const c = r.testCase.test(l.text) ? 1 : 0;
    if (l.kind === "add") {
      const trivial = r.trivial.test(l.text);
      // A tautology is not an assertion: swapping a real check for one still counts as a drop.
      st.assertionsAdded += trivial ? 0 : a;
      st.casesAdded += c;
      const fresh = !removedText.has(l.text.trim());
      if (fresh && r.skip.test(l.text)) st.skips.push(l);
      if (fresh && r.focus?.test(l.text)) st.focus.push(l);
      if (trivial) st.trivial.push(l);
    } else {
      st.assertionsRemoved += a;
      st.casesRemoved += c;
    }
  }
  return st;
}

export interface TamperEval {
  touched: Record<"workflows" | "codeowners" | "lockfiles" | "tests" | "testConfig" | "policy", string[]>;
  testStats: TestFileStats[];
  net: { assertions: number; cases: number };
  addedTestCases: number;
  unanalyzed: string[];
  findings: Finding[];
}

export function isTestPath(path: string, policy: EvidencePolicy): boolean {
  return matchesAny(path, policy.paths.tests);
}

export function evaluateTamper(files: FileChange[], policy: EvidencePolicy): TamperEval {
  const P = policy.paths;
  const paths = (f: FileChange) => [f.path, ...(f.previousPath ? [f.previousPath] : [])];
  const hit = (globs: string[]) => files.filter((f) => paths(f).some((p) => matchesAny(p, globs))).map((f) => f.path);
  const tests = files.filter((f) => paths(f).some((p) => matchesAny(p, P.tests)));
  const touched: TamperEval["touched"] = {
    workflows: hit(P.workflows),
    codeowners: hit(P.codeowners),
    lockfiles: hit(P.lockfiles),
    // New tests are welcome; removing lines from, renaming or deleting existing test files is what we flag.
    tests: tests.filter((f) => f.status !== "added" && (f.deletions > 0 || f.status === "removed" || f.status === "renamed")).map((f) => f.path),
    testConfig: hit(P.testConfig),
    policy: hit(P.policy),
  };
  const unanalyzed = files.filter((f) => f.patch === undefined && f.additions + f.deletions > 0).map((f) => f.path);
  const testStats = tests.map(analyzeTestFile).filter((s): s is TestFileStats => !!s);
  const net = {
    assertions: testStats.reduce((n, s) => n + s.assertionsAdded - s.assertionsRemoved, 0),
    cases: testStats.reduce((n, s) => n + s.casesAdded - s.casesRemoved, 0),
  };
  const addedTestCases = testStats.reduce((n, s) => n + s.casesAdded, 0);

  const findings: Finding[] = [];
  const list = (xs: string[]) => xs.map((x) => `\`${x}\``).join(", ");
  if (touched.workflows.length)
    findings.push({ id: "touched_workflows", title: "CI workflow files changed", detail: `${list(touched.workflows)} — a PR that edits its own CI can change what "passing" means.` });
  if (touched.codeowners.length)
    findings.push({ id: "touched_codeowners", title: "CODEOWNERS changed", detail: `${list(touched.codeowners)} — changes who must review.` });
  if (touched.policy.length)
    findings.push({ id: "touched_policy", title: "Evidence policy file changed", detail: `${list(touched.policy)} — this run used the base branch policy, not the PR's.` });
  if (touched.lockfiles.length) findings.push({ id: "touched_lockfiles", title: "Lockfiles changed", detail: list(touched.lockfiles) });
  if (touched.tests.length) findings.push({ id: "touched_tests", title: "Existing tests changed (lines removed, renamed or deleted)", detail: list(touched.tests) });
  if (touched.testConfig.length) findings.push({ id: "touched_test_config", title: "Test or coverage config changed", detail: list(touched.testConfig) });

  const deleted = tests.filter((f) => f.status === "removed").map((f) => f.path);
  if (deleted.length) findings.push({ id: "tests_deleted", title: "Test files deleted", detail: list(deleted) });

  const perFile = (pick: (s: TestFileStats) => number) =>
    testStats
      .filter((s) => pick(s) < 0)
      .map((s) => `\`${s.path}\` (${pick(s)})`)
      .join(", ");
  if (net.cases < 0)
    findings.push({
      id: "tests_removed",
      title: "Fewer test cases than before",
      detail: `Net ${net.cases} test case(s) across the diff. Per file: ${perFile((s) => s.casesAdded - s.casesRemoved)}.`,
    });
  if (net.assertions < 0)
    findings.push({
      id: "assertions_dropped",
      title: "Assertion count dropped",
      detail: `Net ${net.assertions} assertion(s) across test files. Per file: ${perFile((s) => s.assertionsAdded - s.assertionsRemoved)}.`,
    });

  const loc = (kind: string, pick: (s: TestFileStats) => DiffLine[]) =>
    testStats.flatMap((s) => pick(s).map((l) => ({ path: s.path, line: l.line, message: `${kind}: ${l.text.trim().slice(0, 160)}` })));
  const lineFinding = (id: Finding["id"], title: string, kind: string, pick: (s: TestFileStats) => DiffLine[]) => {
    const locations = loc(kind, pick);
    if (locations.length)
      findings.push({ id, title, detail: locations.map((l) => `\`${l.path}:${l.line}\` ${l.message.slice(kind.length + 2)}`).join("\n"), locations });
  };
  lineFinding("skip_added", "Tests skipped", "skip added", (s) => s.skips);
  lineFinding("focus_added", "Focused test added (.only / fit) — other tests in the file stop running", "focus added", (s) => s.focus);
  lineFinding("assertions_commented_out", "Assertions commented out", "commented-out assertion", (s) => s.commentedOut);
  lineFinding("trivial_assertion_added", "Assertion that cannot fail", "trivial assertion", (s) => s.trivial);

  if (unanalyzed.length)
    findings.push({
      id: "diff_unanalyzed",
      title: "Some files could not be analysed",
      detail: `GitHub returned no patch for ${list(unanalyzed)} (diff too large). Run with a full checkout to analyse them locally.`,
    });
  return { touched, testStats, net, addedTestCases, unanalyzed, findings };
}
