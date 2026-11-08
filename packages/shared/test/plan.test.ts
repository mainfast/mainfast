import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/github.ts";
import { mockFetch, type MockReply } from "../src/mockfetch.ts";
import { SUITE } from "../src/brand.ts";
import { checkPlan, isBot, planForBenefit, planGate, polarValidator, resetPlanCache, type LicenseValidator, type PolarFetch } from "../src/plan.ts";

const NOW = new Date("2026-10-28T12:00:00Z");
const recent = "2026-10-20T10:00:00Z";
const old = "2026-08-01T10:00:00Z";
const R = "/repos/acme/app";

const pr = (login: string, created_at = recent, type = "User") => ({ created_at, user: { login, type } });
const push = (login: string, timestamp = recent, type = "User") => ({ timestamp, actor: { login, type } });

function routes(opts: { private?: boolean; pulls?: unknown[]; activity?: unknown[] | MockReply; commits?: unknown[] } = {}) {
  const r: Record<string, MockReply> = {
    [`GET ${R}`]: { body: { private: opts.private ?? true } },
    [`GET ${R}/pulls`]: { body: opts.pulls ?? [] },
  };
  if (opts.activity !== undefined) r[`GET ${R}/activity`] = Array.isArray(opts.activity) ? { body: opts.activity } : opts.activity;
  if (opts.commits !== undefined) r[`GET ${R}/commits`] = { body: opts.commits };
  return r;
}

function client(r: Record<string, MockReply>) {
  const fetch = mockFetch(r);
  return { fetch, gh: new GitHub({ token: "t", userAgent: "test", fetch }) };
}

const six = ["ana", "bo", "cy", "dee", "eli", "fay"];
const acceptAll: LicenseValidator = async () => ({ valid: true, offline: true });
const base = { owner: "acme", repo: "app", productName: "Mainfast Intact", now: NOW };

beforeEach(() => resetPlanCache());
afterEach(() => vi.restoreAllMocks());

describe("plan gate", () => {
  it("public repository (from the event payload): free, no API call", async () => {
    const { gh, fetch } = client(routes());
    const res = await checkPlan({ ...base, gh, event: { repository: { private: false } } });
    expect(res).toEqual({ status: "public" });
    expect(fetch.calls).toEqual([]);
  });

  it("visibility not in the payload: asks the API", async () => {
    const { gh, fetch } = client(routes({ private: false }));
    expect((await checkPlan({ ...base, gh })).status).toBe("public");
    expect(fetch.calls.map((c) => c.path)).toEqual([R]);
  });

  it("private with up to 5 active contributors: free, no notice", async () => {
    const { gh } = client(routes({ pulls: [pr("ana"), pr("bo")], activity: [push("cy"), push("ana")] }));
    const res = await checkPlan({ ...base, gh, event: { repository: { private: true } } });
    expect(res).toEqual({ status: "free", activeContributors: 3 });
  });

  it("private over the limit without a key: polite notice, counts PR openers and pushers", async () => {
    const { gh } = client(routes({ pulls: six.slice(0, 3).map((l) => pr(l)), activity: six.slice(3).map((l) => push(l)) }));
    const res = await checkPlan({ ...base, gh, event: { repository: { private: true } } });
    expect(res.status).toBe("over-limit");
    expect(res.activeContributors).toBe(6);
    expect(res.notice).toContain("free for public repositories and for private repositories with up to 5 active contributors");
    expect(res.notice).toContain("had 6 active contributors in the last 30 days");
    expect(res.notice).toContain("$4 per active contributor per month");
    expect(res.notice).toContain("never changes its result");
  });

  it("private over the limit with a key and the placeholder Polar org: licensed, unverified, nothing sent", async () => {
    const { gh } = client(routes({ pulls: six.map((l) => pr(l)) }));
    const res = await checkPlan({ ...base, gh, event: { repository: { private: true } }, license: "mf_live_123" });
    expect(res).toEqual({ status: "licensed", activeContributors: 6, key: "unverified" });
  });

  it("the validation hook decides; a throwing validator never costs the customer", async () => {
    const { gh } = client(routes({ pulls: six.map((l) => pr(l)) }));
    const reject: LicenseValidator = async () => ({ valid: false, offline: false });
    expect((await checkPlan({ ...base, gh, event: { repository: { private: true } }, license: "bad", validate: reject })).status).toBe("over-limit");
    resetPlanCache();
    const boom: LicenseValidator = async () => {
      throw new Error("billing down");
    };
    expect((await checkPlan({ ...base, gh, event: { repository: { private: true } }, license: "k", validate: boom })).status).toBe("licensed");
  });

  it("bots and activity outside the 30-day window are not counted", async () => {
    const pulls = [pr("ana"), pr("dependabot[bot]", recent, "Bot"), pr("renovate"), pr("old-timer", old)];
    const activity = [push("bo"), push("github-actions[bot]", recent, "Bot"), push("gone", old)];
    const { gh } = client(routes({ pulls, activity }));
    expect((await checkPlan({ ...base, gh, event: { repository: { private: true } } })).activeContributors).toBe(2);
    expect(isBot({ login: "release-bot", type: "User" })).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot({ login: "ana", type: "User" })).toBe(false);
  });

  it("activity API unavailable: falls back to default-branch commit authors", async () => {
    const { gh, fetch } = client(routes({ pulls: [pr("ana")], activity: { status: 404, body: { message: "Not Found" } }, commits: [{ author: { login: "bo", type: "User" } }, { author: null }] }));
    expect((await checkPlan({ ...base, gh, event: { repository: { private: true } } })).activeContributors).toBe(2);
    expect(fetch.calls.some((c) => c.path.startsWith(`${R}/commits?since=2026-09-28`))).toBe(true);
  });

  it("API refuses everything: unknown, no notice, no throw", async () => {
    const { gh } = client({ [`GET ${R}`]: { body: { private: true } } });
    const res = await checkPlan({ ...base, gh, event: { repository: { private: true } } });
    expect(res.status).toBe("unknown");
    expect(res.notice).toBeUndefined();
  });

  it("caches the count per run: memory first, then the RUNNER_TEMP file for the same run id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-plan-"));
    const { gh, fetch } = client(routes({ pulls: six.map((l) => pr(l)) }));
    const opts = { ...base, gh, event: { repository: { private: true } }, cacheDir: dir, runId: "77" };
    await checkPlan(opts);
    const n = fetch.calls.length;
    await checkPlan(opts);
    expect(fetch.calls.length).toBe(n); // memory
    resetPlanCache(); // a second Mainfast step in the same job
    expect((await checkPlan(opts)).activeContributors).toBe(6);
    expect(fetch.calls.length).toBe(n); // file
    resetPlanCache();
    await checkPlan({ ...opts, runId: "78" }); // another run: count again
    expect(fetch.calls.length).toBeGreaterThan(n);
  });

  it("planGate: notice goes to the job summary, the key comes from input or env, never fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-gate-"));
    const summary = join(dir, "summary.md");
    writeFileSync(summary, "");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { gh } = client(routes({ pulls: six.map((l) => pr(l)) }));
    const env = { GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: dir, GITHUB_RUN_ID: "1" };
    const res = await planGate({ ...base, gh, event: { repository: { private: true } }, env });
    expect(res.status).toBe("over-limit");
    expect(readFileSync(summary, "utf8")).toContain("Mainfast Pro is $4 per active contributor per month");
    expect(process.exitCode).toBeUndefined();
    expect((await planGate({ ...base, gh, event: { repository: { private: true } }, env: { ...env, INPUT_LICENSE: "k" }, validate: acceptAll })).status).toBe("licensed");
    expect((await planGate({ ...base, gh, event: { repository: { private: true } }, env: { ...env, MAINFAST_LICENSE: "k2" }, validate: acceptAll })).status).toBe("licensed");
  });

  it("planGate without a token: no API call, no notice", async () => {
    const fetch = mockFetch(routes());
    const res = await planGate({ ...base, gh: new GitHub({ userAgent: "t", fetch }), event: {}, env: {} });
    expect(res.status).toBe("unknown");
    expect(fetch.calls).toEqual([]);
  });
});

// --- Polar license-key validation (fake Polar; no real network) ----------------------------

const ORG = "11111111-2222-3333-4444-555555555555";
const IDS = { free: "ben-free", pro: "ben-pro" };
const KEY = "MAINFAST-SECRET-KEY-0001";
const API = "https://sandbox-api.polar.sh";

type Answer = { status: number; body?: unknown; raw?: string } | "network" | "hang";

/** Records each request; answers from a script (one entry per call, the last one repeats). */
function fakePolar(...answers: Answer[]) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const f: PolarFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a === "network") throw new TypeError("fetch failed");
    if (a === "hang") {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    return { status: a.status, text: async () => a.raw ?? JSON.stringify(a.body ?? {}) };
  };
  return { f, calls };
}

const lk = (over: Record<string, unknown> = {}) => ({
  id: "lk-1",
  organization_id: ORG,
  benefit_id: IDS.pro,
  key: KEY,
  display_key: "****-0001",
  status: "granted",
  limit_activations: null,
  expires_at: null,
  usage: 0,
  validations: 3,
  ...over,
});

const validator = (f: PolarFetch, timeoutMs = 50) => polarValidator({ fetch: f, api: API, organizationId: ORG, benefitIds: IDS, timeoutMs, now: () => NOW });

describe("Polar license validation", () => {
  const ctx = { owner: "acme", repo: "app" };

  it("sends only the key and the organization id to the customer-portal validate endpoint", async () => {
    const { f, calls } = fakePolar({ status: 200, body: lk() });
    expect(await validator(f)(`  ${KEY} `, ctx)).toEqual({ valid: true, offline: false, plan: "pro" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${API}/v1/customer-portal/license-keys/validate`);
    expect(calls[0]!.body).toEqual({ key: KEY, organization_id: ORG });
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
    expect(Object.keys(calls[0]!.headers).some((h) => h.toLowerCase() === "authorization")).toBe(false);
  });

  it("api and organization come from MAINFAST_POLAR_API / MAINFAST_POLAR_ORG, else brand.json", async () => {
    const { f, calls } = fakePolar({ status: 200, body: lk() });
    await polarValidator({ fetch: f, benefitIds: IDS, env: { MAINFAST_POLAR_API: `${API}/`, MAINFAST_POLAR_ORG: ORG } })(KEY, ctx);
    expect(calls[0]!.url).toBe(`${API}/v1/customer-portal/license-keys/validate`);
    expect(calls[0]!.body.organization_id).toBe(ORG);
    expect(SUITE.polar.api).toBe("https://api.polar.sh");
    expect([SUITE.polar.apiEnv, SUITE.polar.orgEnv]).toEqual(["MAINFAST_POLAR_API", "MAINFAST_POLAR_ORG"]);
  });

  it("the all-zeros placeholder organization: nothing is sent, the key is accepted offline", async () => {
    const { f, calls } = fakePolar({ status: 404 });
    expect(await polarValidator({ fetch: f, env: { MAINFAST_POLAR_ORG: "00000000-0000-0000-0000-000000000000" } })(KEY, ctx)).toEqual({ valid: true, offline: true });
    expect(calls).toEqual([]);
  });

  it("without an env override the brand.json organization and api are used", async () => {
    const { f, calls } = fakePolar({ status: 200, body: lk({ organization_id: SUITE.polar.organizationId, benefit_id: SUITE.plan.benefitIds.pro }) });
    expect(await polarValidator({ fetch: f, env: {} })(KEY, ctx)).toMatchObject({ valid: true, offline: false, plan: "pro" });
    expect(calls[0]!.url).toBe(`${SUITE.polar.api}/v1/customer-portal/license-keys/validate`);
    expect(calls[0]!.body.organization_id).toBe(SUITE.polar.organizationId);
  });

  it("maps benefit ids to plans", () => {
    expect(planForBenefit("ben-pro", IDS)).toBe("pro");
    expect(planForBenefit("ben-free", IDS)).toBe("free");
    expect(planForBenefit("other", IDS)).toBeUndefined();
    expect(planForBenefit(undefined, IDS)).toBeUndefined();
    expect(planForBenefit(SUITE.plan.benefitIds.free)).toBe("free");
  });

  it("valid free key", async () => {
    const { f } = fakePolar({ status: 200, body: lk({ benefit_id: IDS.free }) });
    expect(await validator(f)(KEY, ctx)).toEqual({ valid: true, offline: false, plan: "free" });
  });

  it("refused: 404, revoked, disabled, expired, wrong organization, unknown benefit", async () => {
    const refused = async (a: Answer) => validator(fakePolar(a).f)(KEY, ctx);
    expect(await refused({ status: 404, body: { detail: "Not found" } })).toMatchObject({ valid: false, offline: false });
    expect((await refused({ status: 200, body: lk({ status: "revoked" }) })).reason).toContain('"revoked"');
    expect((await refused({ status: 200, body: lk({ status: "disabled" }) })).reason).toContain('"disabled"');
    expect((await refused({ status: 200, body: lk({ expires_at: "2026-10-01T00:00:00Z" }) })).reason).toContain("expired on 2026-10-01");
    expect((await refused({ status: 200, body: lk({ organization_id: "99999999-0000-0000-0000-000000000000" }) })).reason).toContain("another Polar organization");
    expect((await refused({ status: 200, body: lk({ benefit_id: "someone-elses-benefit" }) })).reason).toContain("unknown benefit");
    // a future expiry is fine
    expect(await refused({ status: 200, body: lk({ expires_at: "2027-01-01T00:00:00Z" }) })).toMatchObject({ valid: true, plan: "pro" });
  });

  it("never the customer's problem: network error, 5xx, 429, 422, bad JSON, timeout -> valid offline", async () => {
    const offline = { valid: true, offline: true };
    expect(await validator(fakePolar("network").f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 500 }).f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 503 }).f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 429 }).f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 422, body: { detail: [] } }).f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 200, raw: "<html>gateway</html>" }).f)(KEY, ctx)).toEqual(offline);
    expect(await validator(fakePolar({ status: 200, raw: "[]" }).f)(KEY, ctx)).toEqual(offline);
    const t0 = Date.now();
    expect(await validator(fakePolar("hang").f, 30)(KEY, ctx)).toEqual(offline);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(SUITE.polar.timeoutMs).toBeLessThanOrEqual(5000);
  });
});

describe("plan gate with license keys", () => {
  const priv = { repository: { private: true } };
  const run = (answer: Answer, pulls: unknown[], extra: Partial<Parameters<typeof checkPlan>[0]> = {}) => {
    const polar = fakePolar(answer);
    const { gh } = client(routes({ pulls }));
    return { polar, res: checkPlan({ ...base, gh, event: priv, license: KEY, validate: validator(polar.f), ...extra }) };
  };

  it("valid Pro key: licensed, under or over the limit", async () => {
    expect(await run({ status: 200, body: lk() }, six.map((l) => pr(l))).res).toEqual({ status: "licensed", activeContributors: 6, key: "pro" });
    resetPlanCache();
    expect(await run({ status: 200, body: lk() }, [pr("ana")]).res).toEqual({ status: "licensed", activeContributors: 1, key: "pro" });
  });

  it("valid free key under the limit: free and registered, no notice", async () => {
    expect(await run({ status: 200, body: lk({ benefit_id: IDS.free }) }, [pr("ana"), pr("bo")]).res).toEqual({ status: "free", activeContributors: 2, key: "free" });
  });

  it("valid free key over the limit: still the Pro notice (a free key is not Pro), noting the free key", async () => {
    const res = await run({ status: 200, body: lk({ benefit_id: IDS.free }) }, six.map((l) => pr(l))).res;
    expect(res.status).toBe("over-limit");
    expect(res.key).toBe("free");
    expect(res.notice).toContain("$4 per active contributor per month");
    expect(res.notice).toContain("free Mainfast key");
    expect(res.notice).not.toContain(KEY);
  });

  it("free key on a public repository: public, registered", async () => {
    const polar = fakePolar({ status: 200, body: lk({ benefit_id: IDS.free }) });
    const { gh } = client(routes());
    expect(await checkPlan({ ...base, gh, event: { repository: { private: false } }, license: KEY, validate: validator(polar.f) })).toEqual({ status: "public", key: "free" });
  });

  it("invalid or revoked key: treated as no key (the notice), with a reason", async () => {
    const inv = await run({ status: 404 }, six.map((l) => pr(l))).res;
    expect(inv).toMatchObject({ status: "over-limit", key: "refused" });
    expect(inv.notice).toBeDefined();
    resetPlanCache();
    const rev = await run({ status: 200, body: lk({ status: "revoked" }) }, six.map((l) => pr(l))).res;
    expect(rev).toMatchObject({ status: "over-limit", key: "refused" });
    expect(rev.keyReason).toContain("revoked");
    resetPlanCache();
    expect(await run({ status: 404 }, [pr("ana")]).res).toMatchObject({ status: "free", key: "refused" });
  });

  it("Polar down (network, 5xx, timeout, bad JSON) over the limit: licensed, unverified", async () => {
    for (const a of ["network", { status: 502 }, "hang", { status: 200, raw: "{" }] as Answer[]) {
      resetPlanCache();
      expect(await run(a, six.map((l) => pr(l))).res).toEqual({ status: "licensed", activeContributors: 6, key: "unverified" });
    }
  });

  it("validates the key once per run (memory, then the RUNNER_TEMP file, which holds no key)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-key-"));
    const polar = fakePolar({ status: 200, body: lk() });
    const { gh } = client(routes({ pulls: six.map((l) => pr(l)) }));
    const opts = { ...base, gh, event: priv, license: KEY, validate: validator(polar.f), cacheDir: dir, runId: "5" };
    await checkPlan(opts);
    await checkPlan(opts);
    resetPlanCache();
    expect((await checkPlan(opts)).key).toBe("pro");
    expect(polar.calls).toHaveLength(1);
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toContain(KEY);
    resetPlanCache();
    await checkPlan({ ...opts, runId: "6" });
    expect(polar.calls).toHaveLength(2);
  });

  it("planGate: free key adds one quiet summary line; a refused key logs one line; the key appears in neither", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mf-gate-key-"));
    const summary = join(dir, "summary.md");
    writeFileSync(summary, "");
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    const env = { GITHUB_STEP_SUMMARY: summary, INPUT_LICENSE: KEY };

    const free = fakePolar({ status: 200, body: lk({ benefit_id: IDS.free }) });
    const r1 = await planGate({ ...base, gh: client(routes({ pulls: [pr("ana")] })).gh, event: priv, env, validate: validator(free.f) });
    expect(r1).toMatchObject({ status: "free", key: "free" });
    expect(readFileSync(summary, "utf8")).toContain("Registered (free key)");
    expect(out.join("")).toBe("");

    resetPlanCache();
    writeFileSync(summary, "");
    const pro = fakePolar({ status: 200, body: lk() });
    await planGate({ ...base, gh: client(routes({ pulls: six.map((l) => pr(l)) })).gh, event: priv, env, validate: validator(pro.f) });
    expect(readFileSync(summary, "utf8")).toBe(""); // Pro: nothing at all

    resetPlanCache();
    const revoked = fakePolar({ status: 200, body: lk({ status: "revoked" }) });
    const r3 = await planGate({ ...base, gh: client(routes({ pulls: six.map((l) => pr(l)) })).gh, event: priv, env, validate: validator(revoked.f) });
    expect(r3).toMatchObject({ status: "over-limit", key: "refused" });
    const logs = out.join("");
    expect(logs.match(/license key was not accepted/g)).toHaveLength(1);
    expect(logs).toContain("revoked");
    expect(readFileSync(summary, "utf8")).toContain("Mainfast Pro is $4");

    expect(logs).not.toContain(KEY);
    expect(readFileSync(summary, "utf8")).not.toContain(KEY);
    expect(JSON.stringify([r1, r3])).not.toContain(KEY);
  });
});
