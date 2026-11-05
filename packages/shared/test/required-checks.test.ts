import { describe, expect, it } from "vitest";
import { GitHub } from "../src/github.ts";
import { mockFetch } from "../src/mockfetch.ts";
import {
  appSatisfies,
  checkRunState,
  classifyRequired,
  commitStatusState,
  fetchRequiredSources,
  outcomeOf,
  pinnedApps,
  requiredContexts,
  resolveRequiredChecks,
  satisfiesRequired,
  worstState,
} from "../src/required-checks.ts";

describe("resolveRequiredChecks", () => {
  const input = {
    classic: { strict: false, contexts: ["build", "legacy"], checks: [{ context: "build", app_id: 15368 }] },
    branchRules: [
      { type: "deletion", ruleset_id: 1 },
      {
        type: "required_status_checks",
        ruleset_id: 1,
        parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "typecheck" }, { context: "build", integration_id: 15368 }] },
      },
    ],
    rulesets: [
      { id: 1, name: "main", enforcement: "active" as const },
      { id: 2, name: "trial", enforcement: "evaluate" as const, rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "codeql" }] } }] },
      { id: 3, name: "off", enforcement: "disabled" as const, rules: [{ type: "deletion" }] },
    ],
  };

  it("merges classic protection and active rulesets, with app pins and ruleset names", () => {
    const set = resolveRequiredChecks(input);
    expect(requiredContexts(set)).toEqual(["typecheck", "build", "legacy"]);
    expect(set.required.find((r) => r.context === "build")!.sources).toEqual([
      { kind: "classic", appId: 15368 },
      { kind: "ruleset", rulesetId: 1, rulesetName: "main", enforcement: "active", appId: 15368 },
    ]);
    expect(set.strict).toEqual({ classic: false, ruleset: true });
  });

  it("lists evaluate/disabled rulesets with required checks apart: they block nothing", () => {
    const set = resolveRequiredChecks(input);
    expect(set.notEnforced).toEqual([{ rulesetId: 2, rulesetName: "trial", enforcement: "evaluate", contexts: ["codeql"] }]);
    expect(requiredContexts(set)).not.toContain("codeql");
  });

  it("app pins: every source must accept the app", () => {
    const build = resolveRequiredChecks(input).required.find((r) => r.context === "build")!;
    expect(pinnedApps(build.sources)).toEqual([15368]);
    expect(appSatisfies(build.sources, 15368)).toBe(true);
    expect(appSatisfies(build.sources, 99)).toBe(false);
    expect(appSatisfies([{ kind: "classic", appId: null }], 99)).toBe(true);
  });

  it("no inputs, no requirements", () => {
    expect(resolveRequiredChecks({})).toEqual({ required: [], notEnforced: [], strict: { classic: undefined, ruleset: undefined } });
  });
});

describe("classification of what a commit reported", () => {
  it("maps check runs and statuses to states, worst first", () => {
    expect(checkRunState("in_progress", null)).toBe("pending");
    expect(checkRunState("completed", "stale")).toBe("stale");
    expect(checkRunState("completed", null)).toBe("failure");
    expect(commitStatusState("error")).toBe("failure");
    expect(worstState(["success", "skipped"])).toBe("skipped");
    expect(worstState(["success", "pending"])).toBe("pending");
    expect(worstState([])).toBe("missing");
    expect(outcomeOf("timed_out")).toBe("failed");
    expect(outcomeOf("stale")).toBe("stale");
    expect(["success", "skipped", "neutral", "failure", "stale"].map((s) => satisfiesRequired(s as never))).toEqual([true, true, true, false, false]);
  });

  it("classifies one required context on one sha: latest run, other commits ignored, status joins in", () => {
    const at = {
      sha: "head",
      runs: [
        { id: 1, name: "ci", headSha: "head", status: "completed", conclusion: "failure", startedAt: "2026-01-01T00:00:00Z", appId: 15368 },
        { id: 2, name: "ci", headSha: "head", status: "completed", conclusion: "success", startedAt: "2026-01-02T00:00:00Z", appId: 15368 },
        { id: 3, name: "old", headSha: "earlier", status: "completed", conclusion: "success", appId: 15368 },
      ],
      statuses: [{ context: "ci", state: "success" }],
    };
    expect(classifyRequired("ci", at)).toMatchObject({ state: "success", outcome: "passed", appSatisfied: true });
    expect(classifyRequired("old", at)).toMatchObject({ state: "missing", outcome: "missing" });
    expect(classifyRequired("ci", { ...at, statuses: [{ context: "ci", state: "pending" }] }).outcome).toBe("pending");
    expect(classifyRequired("ci", at, [{ kind: "ruleset", appId: 4242 }]).appSatisfied).toBe(false);
  });
});

describe("fetchRequiredSources", () => {
  const gh = (routes: Record<string, unknown>) => new GitHub({ token: "t", userAgent: "test", fetch: mockFetch(routes) });

  it("reads classic checks from Get a branch (read access) and all rulesets", async () => {
    const s = await fetchRequiredSources(
      gh({
        "GET /repos/o/r/branches/main": { body: { commit: { sha: "abc" }, protected: true, protection: { required_status_checks: { strict: true, contexts: ["b"], checks: [] } } } },
        "GET /repos/o/r/rules/branches/main": { body: [{ type: "required_status_checks", ruleset_id: 1, parameters: { required_status_checks: [{ context: "a" }] } }] },
        "GET /repos/o/r/rulesets": { body: [{ id: 1, name: "x", target: "branch", enforcement: "active" }, { id: 2, name: "tags", target: "tag", enforcement: "active" }] },
        "GET /repos/o/r/rulesets/1": { body: { id: 1, name: "x", target: "branch", enforcement: "active", rules: [] } },
      }),
      "o",
      "r",
      "main",
    );
    expect(s).toMatchObject({ headSha: "abc", classic: { strict: true, contexts: ["b"] }, notes: [] });
    expect(s.rulesets.map((r) => r.id)).toEqual([1]);
    expect(requiredContexts(resolveRequiredChecks(s))).toEqual(["a", "b"]);
  });

  it("degrades to notes when the admin endpoint and rulesets are not readable", async () => {
    const denied = { status: 403, body: { message: "Resource not accessible by integration" } };
    const s = await fetchRequiredSources(
      gh({
        "GET /repos/o/r/branches/main": { body: { protected: true, protection: { enabled: true } } },
        "GET /repos/o/r/branches/main/protection/required_status_checks": denied,
        "GET /repos/o/r/rules/branches/main": denied,
        "GET /repos/o/r/rulesets": denied,
      }),
      "o",
      "r",
      "main",
    );
    expect(s.classic).toBeNull();
    expect(s.notes).toHaveLength(3);
    expect(s.notes[0]).toContain("administration: read");
  });
});
