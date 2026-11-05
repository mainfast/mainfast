// One fixture PR per flag, served through the real REST client against recorded payloads.
import { describe, expect, it } from "vitest";
import { renderCard } from "../src/render.ts";
import { checkRun, file, HEAD, ids, PREV, runVariant } from "./helpers.ts";

describe("baseline fixture PR", () => {
  it("is an agent PR with full evidence and passes clean", async () => {
    const { report } = await runVariant();
    expect(report.applies).toBe(true);
    expect(report.provenance.agents).toContain("Claude Code");
    expect(report.checks.testsState).toBe("passed");
    expect(report.checks.required.map((r) => `${r.context}:${r.state}`)).toEqual(["test:success", "lint:success"]);
    expect(report.checks.requiredSources).toEqual(["rulesets"]);
    expect(report.claims.map((c) => `${c.kind}:${c.verdict}`)).toEqual(["tests_added:backed", "tests_pass:backed"]);
    expect(ids(report)).toEqual([]);
    expect(report.conclusion).toBe("success");
  });

  it("never asks GitHub about any sha but head (and earlier commits only when head lacks tests)", async () => {
    const { calls } = await runVariant();
    const shas = calls.filter((c) => c.path.includes("/commits/")).map((c) => c.path.split("/commits/")[1]!.split("/")[0]);
    expect(new Set(shas)).toEqual(new Set([HEAD]));
  });
});

describe("check evidence", () => {
  it("tests_not_run_on_head: tests ran on an earlier push only", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => runs.splice(0, runs.length, checkRun("lint", "success"), checkRun("build", "success")),
      statuses: (s) => s.splice(0),
      prevCheckRuns: [checkRun("test", "success", { head_sha: PREV })],
    });
    expect(ids(report)).toContain("tests_not_run_on_head");
    expect(report.checks.staleTestsOn?.sha).toBe(PREV);
    expect(report.flags.find((f) => f.id === "tests_not_run_on_head")!.detail).toMatch(/earlier commit a1e2d3c/);
    expect(report.conclusion).toBe("failure");
  });

  it("ignores check runs whose head_sha is not the PR head", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => {
        runs.splice(0, runs.length, checkRun("test", "success", { head_sha: PREV }), checkRun("lint", "success"));
      },
      statuses: (s) => s.splice(0),
    });
    expect(report.checks.testsState).toBe("none");
    expect(ids(report)).toContain("tests_not_run_on_head");
  });

  it("tests_failed", async () => {
    const { report } = await runVariant({ statuses: (s) => (s[0].state = "failure") });
    expect(ids(report)).toContain("tests_failed");
    expect(ids(report)).toContain("claim_tests_pass_unbacked");
  });

  it("uses the latest re-run of a check, not the first", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => {
        runs[0].conclusion = "failure";
        runs[0].started_at = "2026-10-27T07:00:00Z";
        runs.push(checkRun("test", "success", { started_at: "2026-10-27T09:00:00Z" }));
      },
    });
    expect(report.checks.testsState).toBe("passed");
  });

  it("tests_empty: a green test check that ran zero tests", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => {
        runs[0].output = { title: "Vitest", summary: "No test files found, exiting with code 0" };
      },
      statuses: (s) => s.splice(0),
    });
    expect(ids(report)).toContain("tests_empty");
  });

  it("pending: test checks still running -> in_progress, no failure", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[0] = checkRun("test", null)) });
    expect(report.checks.testsState).toBe("pending");
    expect(report.conclusion).toBe("pending");
    expect(report.claims.find((c) => c.kind === "tests_pass")!.verdict).toBe("pending");
  });

  it("required_check_skipped: required job skipped or neutral", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[1].conclusion = "skipped") });
    expect(ids(report)).toEqual(["required_check_skipped"]);
    expect(report.flags[0]!.detail).toMatch(/lint: skipped/);
  });

  it("required_check_skipped: neutral counts too", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[1].conclusion = "neutral") });
    expect(ids(report)).toEqual(["required_check_skipped"]);
  });

  it("required_check_missing: required check renamed or path-filtered away", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => runs.splice(1, 1) });
    expect(ids(report)).toEqual(["required_check_missing"]);
  });

  it("required_check_failed is a warning by default", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => (runs[1].conclusion = "failure") });
    expect(report.flags.map((f) => `${f.id}:${f.severity}`)).toEqual(["required_check_failed:warn"]);
    expect(report.conclusion).toBe("success");
  });

  it("reads classic branch protection from Get a branch (contents: read), merged with rulesets", async () => {
    const { report, calls } = await runVariant({
      branch: (b) => {
        b.protected = true;
        b.protection = { enabled: true, required_status_checks: { enforcement_level: "non_admins", contexts: ["ci/circleci: integration"], checks: [{ context: "ci/circleci: integration", app_id: null }] } };
      },
    });
    expect(report.checks.required.map((r) => r.context).sort()).toEqual(["ci/circleci: integration", "lint", "test"]);
    expect(report.checks.requiredSources).toEqual(["rulesets", "branch protection"]);
    // the admin-only endpoint is not needed when Get a branch already lists the checks
    expect(calls.some((c) => c.path.includes("/protection/required_status_checks"))).toBe(false);
  });

  it("falls back to the admin endpoint; a 403 there becomes a note, not an error", async () => {
    const protectedNoList = (b: any) => {
      b.protected = true;
      b.protection = { enabled: true, required_status_checks: { enforcement_level: "off", contexts: [], checks: [] } };
    };
    const denied = await runVariant({ branch: protectedNoList });
    expect(denied.report.checks.requiredSources).toEqual(["rulesets"]);
    expect(denied.report.checks.notes.join(" ")).toMatch(/administration: read/);
    expect(renderCard(denied.report)).toMatch(/classic required checks unknown/);
    const allowed = await runVariant({
      branch: protectedNoList,
      protection: { status: 200, body: { url: "x", strict: true, contexts: ["ci/circleci: integration"], checks: [] } },
    });
    expect(allowed.report.checks.requiredSources).toEqual(["rulesets", "branch protection"]);
  });

  it("a required check pinned to an app is not satisfied by a run from another app", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => {
        const lint = runs.find((r) => r.name === "lint");
        lint.app = { id: 999, slug: "someone-elses-app" };
      },
    });
    expect(ids(report)).toContain("required_check_missing");
    expect(report.flags.find((f) => f.id === "required_check_missing")!.detail).toMatch(/lint.*different app/);
  });

  it("excludes its own check run from judgement", async () => {
    const { report } = await runVariant({ checkRuns: (runs) => runs.push(checkRun("Mainfast Evidence", "failure")) });
    expect(report.checks.all.map((c) => c.name)).not.toContain("Mainfast Evidence");
  });
});

describe("tamper and test weakening (API patches)", () => {
  const base = () => [file("src/price.ts", ["  return 1;"], ["  return 2;"])];

  it("touched_workflows", async () => {
    const { report } = await runVariant({ files: [...base(), file(".github/workflows/ci.yml", ["      - run: npm test"], ["      - run: npm test || true"])] });
    expect(ids(report)).toContain("touched_workflows");
    expect(report.conclusion).toBe("failure");
  });

  it("touched_codeowners", async () => {
    const { report } = await runVariant({ files: [...base(), file(".github/CODEOWNERS", ["* @octo-org/core"], [])] });
    expect(ids(report)).toContain("touched_codeowners");
  });

  it("touched_lockfiles (nested) is a warning", async () => {
    const { report } = await runVariant({ files: [...base(), file("apps/web/pnpm-lock.yaml", [], ["  left-pad: 1.3.0"])] });
    expect(report.flags.find((f) => f.id === "touched_lockfiles")!.severity).toBe("warn");
  });

  it("touched_policy: the PR edits .mainfast.yml", async () => {
    const { report } = await runVariant({ files: [...base(), file(".mainfast.yml", [], ["evidence:", "  apply_to: agents", "  flags: { touched_workflows: off }"])] });
    expect(ids(report)).toContain("touched_policy");
  });

  it("touched_test_config", async () => {
    const { report } = await runVariant({ files: [...base(), file("vitest.config.ts", [], ["  exclude: ['src/**/*.test.ts'],"])] });
    expect(ids(report)).toContain("touched_test_config");
  });

  it("tests_deleted", async () => {
    const { report } = await runVariant({
      files: [...base(), file("src/price.test.ts", ['it("formats", () => {', '  expect(formatPrice(1)).toBe("$0.01");', "});"], [], "removed")],
    });
    expect(ids(report)).toEqual(expect.arrayContaining(["tests_deleted", "tests_removed", "assertions_dropped", "touched_tests"]));
  });

  it("assertions_dropped within a kept test", async () => {
    const { report } = await runVariant({
      files: [...base(), file("src/price.test.ts", ['  expect(a).toBe(1);', '  expect(b).toBe(2);'], ['  expect(a).toBe(1);'])],
    });
    expect(ids(report)).toContain("assertions_dropped");
    expect(report.tamper.net.assertions).toBe(-1);
  });

  it("skip_added with an annotation location", async () => {
    const { report } = await runVariant({ files: [...base(), file("src/price.test.ts", ['  it("rounds", () => {'], ['  it.skip("rounds", () => {'])] });
    const f = report.flags.find((x) => x.id === "skip_added")!;
    expect(f.locations![0]).toMatchObject({ path: "src/price.test.ts", line: 1 });
  });

  it("focus_added (.only)", async () => {
    const { report } = await runVariant({ files: [...base(), file("src/price.test.ts", ['describe("price", () => {'], ['describe.only("price", () => {'])] });
    expect(ids(report)).toContain("focus_added");
  });

  it("assertions_commented_out", async () => {
    const { report } = await runVariant({ files: [...base(), file("src/price.test.ts", ['  expect(total).toBe(3);'], ['  // expect(total).toBe(3);'])] });
    expect(ids(report)).toEqual(expect.arrayContaining(["assertions_commented_out", "assertions_dropped"]));
  });

  it("trivial_assertion_added", async () => {
    const { report } = await runVariant({ files: [...base(), file("src/price.test.ts", [], ['it("works", () => {', "  expect(true).toBe(true);", "});"])] });
    expect(ids(report)).toContain("trivial_assertion_added");
  });

  it("diff_unanalyzed when GitHub omits the patch", async () => {
    const big = { filename: "src/huge.ts", status: "modified", additions: 4000, deletions: 10, changes: 4010 };
    const { report } = await runVariant({ files: [...base(), big] });
    expect(ids(report)).toEqual(expect.arrayContaining(["diff_unanalyzed", "diff_too_large"]));
  });
});

describe("claims", () => {
  it("claim_tests_added_unbacked: description says tests were added, diff has none", async () => {
    const { report } = await runVariant({ files: [file("src/price.ts", ["  return 1;"], ["  return 2;"])] });
    expect(ids(report)).toEqual(["claim_tests_added_unbacked"]);
  });

  it("claim_tests_pass_unbacked: says all tests pass, none ran on head", async () => {
    const { report } = await runVariant({
      checkRuns: (runs) => runs.splice(0, 1),
      statuses: (s) => s.splice(0),
      rules: [],
    });
    expect(ids(report)).toEqual(expect.arrayContaining(["claim_tests_pass_unbacked", "tests_not_run_on_head"]));
  });

  it("ignores negated claims and unchecked task-list items", async () => {
    const { report } = await runVariant({
      pull: (p) => (p.body = "No tests added; this is a docs change.\n- [ ] All tests pass\n<!-- tests pass -->\nCo-Authored-By: Claude"),
      files: [file("README.md", ["old"], ["new"])],
    });
    expect(report.claims).toEqual([]);
  });
});

describe("size and secrets", () => {
  it("diff_too_large respects policy limits", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`);
    const { report } = await runVariant({ files: [file("src/gen.ts", [], lines)], config: "evidence:\n  diff: { max_lines: 20 }\n  flags: { claim_tests_added_unbacked: off }\n" });
    expect(ids(report)).toEqual(["diff_too_large"]);
  });

  it("secret_like_string with redaction", async () => {
    const key = ["AKIA", "Z7Q3", "M2XK", "P9LT", "4WEB"].join("");
    const gh = `ghp_${"Ab3dEf6hIj9lMn2pQr5tUv8xYz1bCd4fGh7k"}`;
    const { report } = await runVariant({
      files: [file("src/price.ts", [], [`const AWS_KEY = "${key}";`, `const token = "${gh}";`, 'const apiKey = "your_api_key_here_placeholder";'])],
      config: "evidence:\n  flags: { claim_tests_added_unbacked: off }\n",
    });
    const f = report.flags.find((x) => x.id === "secret_like_string")!;
    expect(f.locations).toHaveLength(2);
    expect(f.detail).not.toContain(key);
    expect(f.detail).toContain("AKIA…EB");
  });
});

describe("secrets.allow matches the secret value only", () => {
  const key = ["AKIA", "Z7Q3", "M2XK", "P9LT", "4WEB"].join("");
  it("regression: an allowlisted marker elsewhere on the line does not hide a real key", async () => {
    const { report } = await runVariant({
      files: [file("src/price.ts", [], [`const AWS_KEY = "${key}"; // example`])],
      config: 'evidence:\n  secrets: { allow: ["example", "EXAMPLE$"] }\n  flags: { claim_tests_added_unbacked: off }\n',
    });
    expect(report.secrets).toHaveLength(1);
    expect(ids(report)).toContain("secret_like_string");
  });

  it("a pattern that matches the value still allows it; invalid patterns are reported, not thrown", async () => {
    const { report } = await runVariant({
      files: [file("src/price.ts", [], [`const AWS_KEY = "${key}";`])],
      config: `evidence:\n  secrets: { allow: ["^${key}$", "(unclosed"] }\n  flags: { claim_tests_added_unbacked: off }\n`,
    });
    expect(report.secrets).toHaveLength(0);
    expect(report.policyWarnings).toContain('evidence.secrets.allow: invalid regex "(unclosed"');
  });
});

describe("policy from base branch", () => {
  it("turns a fail into a warning and lists unknown keys", async () => {
    const { report } = await runVariant({
      files: (fs) => fs.push(file(".github/workflows/ci.yml", [], ["# note"])),
      config: "evidence:\n  flags:\n    touched_workflows: warn\n    made_up_flag: fail\n  colour: blue\n",
    });
    expect(report.flags.map((f) => `${f.id}:${f.severity}`)).toEqual(["touched_workflows:warn"]);
    expect(report.policyWarnings).toEqual(["evidence.colour: unknown key, ignored", "evidence.flags.made_up_flag: unknown flag, ignored"]);
  });

  it("non-agent PR: no flags, success", async () => {
    const { report } = await runVariant({
      pull: (p) => {
        p.head.ref = "fix/rounding";
        p.body = "Fix rounding.";
      },
      commits: (cs) => cs.forEach((c) => (c.commit.message = c.commit.message.replace(/\n\nCo-Authored-By:.*$/, ""))),
      files: (fs) => fs.push(file(".github/workflows/ci.yml", [], ["# note"])),
    });
    expect(report.applies).toBe(false);
    expect(report.flags).toEqual([]);
    expect(report.conclusion).toBe("success");
  });

  it("apply_to: all gates human PRs too", async () => {
    const { report } = await runVariant({
      pull: (p) => {
        p.head.ref = "fix/rounding";
        p.body = "Fix rounding.";
      },
      commits: (cs) => cs.forEach((c) => (c.commit.message = "plain")),
      files: (fs) => fs.push(file(".github/workflows/ci.yml", [], ["# note"])),
      config: "evidence:\n  apply_to: all\n",
    });
    expect(report.applies).toBe(true);
    expect(ids(report)).toEqual(["touched_workflows"]);
  });

  it("coverage_missing can be switched on", async () => {
    const { report } = await runVariant({ config: "evidence:\n  flags: { coverage_missing: warn }\n" });
    expect(ids(report)).toEqual(["coverage_missing"]);
  });
});
