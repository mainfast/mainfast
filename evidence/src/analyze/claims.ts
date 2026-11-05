// What the PR description says vs what the diff and checks show.
import type { ChecksEval } from "./checks.ts";
import type { Finding } from "./finding.ts";
import type { TamperEval } from "./tamper.ts";

export interface Claim {
  kind: "tests_added" | "tests_pass";
  quote: string;
  verdict: "backed" | "unbacked" | "pending" | "unverifiable";
  why: string;
}

const NEGATION = /\b(no|not|n't|without|never|skip(?:ped)?|none)\b[^.\n]{0,25}$/i;

const PATTERNS: Record<Claim["kind"], RegExp[]> = {
  tests_added: [
    /\b(?:add(?:s|ed|ing)?|wr(?:o|i)te|written|writes|includ(?:e|es|ed|ing)|new|extend(?:s|ed)?|cover(?:s|ed)? (?:it |this )?with)\b[^.\n]{0,40}?\b(?:unit |integration |e2e |regression )?tests?\b/gi,
    /\btests? (?:added|included|written|for (?:this|the (?:new|fix)))\b/gi,
    /\bwith (?:unit |integration |regression )?tests\b/gi,
  ],
  tests_pass: [
    /\b(?:all )?(?:the )?(?:unit |integration )?tests? (?:pass(?:es|ed|ing)?|(?:are|is) (?:green|passing)|succeed(?:ed)?)\b/gi,
    /\b(?:ci|the build|pipeline|checks) (?:is |are )?(?:green|passing|passes|passed)\b/gi,
    /\bverified (?:that )?(?:all )?tests? pass\b/gi,
  ],
};

function strip(body: string): string {
  // Ignore HTML comments (PR templates) and fenced code blocks.
  return body.replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ");
}

export function extractClaims(text: string): Array<{ kind: Claim["kind"]; quote: string }> {
  const out: Array<{ kind: Claim["kind"]; quote: string }> = [];
  const body = strip(text);
  for (const [kind, res] of Object.entries(PATTERNS) as Array<[Claim["kind"], RegExp[]]>) {
    for (const re of res) {
      re.lastIndex = 0;
      for (const m of body.matchAll(re)) {
        const before = body.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
        const lineStart = before.lastIndexOf("\n");
        if (NEGATION.test(before.slice(lineStart + 1))) continue;
        // Unchecked task-list item ("- [ ] tests pass") is a to-do, not a claim.
        const lineBegin = body.lastIndexOf("\n", m.index ?? 0) + 1;
        if (/^\s*[-*]\s*\[ \]/.test(body.slice(lineBegin, m.index))) continue;
        if (!out.some((c) => c.kind === kind)) out.push({ kind, quote: m[0].trim() });
      }
    }
  }
  return out;
}

export function evaluateClaims(title: string, body: string, tamper: TamperEval, checks: ChecksEval): { claims: Claim[]; findings: Finding[] } {
  const claims: Claim[] = [];
  const findings: Finding[] = [];
  for (const c of extractClaims(`${title}\n${body}`)) {
    if (c.kind === "tests_added") {
      const n = tamper.addedTestCases;
      if (n > 0) claims.push({ ...c, verdict: "backed", why: `${n} test case(s) added` });
      else {
        const why =
          tamper.testStats.length === 0
            ? "the diff changes no test files"
            : `test files changed but no new test case was added (net assertions ${tamper.net.assertions >= 0 ? "+" : ""}${tamper.net.assertions})`;
        claims.push({ ...c, verdict: "unbacked", why });
        findings.push({ id: "claim_tests_added_unbacked", title: "Description says tests were added; the diff disagrees", detail: `"${c.quote}" — but ${why}.` });
      }
    } else {
      if (!checks.evaluated) {
        claims.push({ ...c, verdict: "unverifiable", why: "check results not available offline" });
        continue;
      }
      const s = checks.testsState;
      if (s === "passed") claims.push({ ...c, verdict: "backed", why: `test checks passed on ${checks.headSha.slice(0, 7)}` });
      else if (s === "pending") claims.push({ ...c, verdict: "pending", why: "test checks still running" });
      else {
        const why =
          s === "none"
            ? `no test check ran on head ${checks.headSha.slice(0, 7)}`
            : s === "empty"
              ? "test checks report zero tests run"
              : s === "skipped"
                ? `test checks were skipped on ${checks.headSha.slice(0, 7)}`
              : `test checks failed on ${checks.headSha.slice(0, 7)}`;
        claims.push({ ...c, verdict: "unbacked", why });
        findings.push({ id: "claim_tests_pass_unbacked", title: "Description says tests pass; checks on this commit disagree", detail: `"${c.quote}" — but ${why}.` });
      }
    }
  }
  return { claims, findings };
}
