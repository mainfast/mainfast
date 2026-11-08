// License / plan gate. Soft and honest: it never fails a check and never blocks a feature.
//
// Every Mainfast check is free and MIT-licensed for public repositories and for private
// repositories with at most 5 active contributors (opened a pull request or pushed in the
// last 30 days; bots excluded). Above that, Mainfast Pro is $4 per active contributor per
// month. When a private repository is over the limit and no Pro key is set, the action
// adds one polite notice to the job summary (and Intact to its check run). That is all.
//
// License keys (optional, input `license` or env MAINFAST_LICENSE) are Polar license keys.
// There are two: a Pro key, and a free key (a $0 Polar checkout) that only registers you:
// no feature needs it. A key is checked once per run with Polar's public customer-portal
// endpoint, POST {api}/v1/customer-portal/license-keys/validate {key, organization_id}, the
// same call Hourcairn makes (hourcairn_shared/license.py): no merchant secret, nothing but the
// key and the organization id is sent. The check is non-fatal: offline, a timeout, a 5xx or
// an unreadable answer counts as a valid key ("unverified"); only a key Polar itself refuses
// (unknown, revoked, disabled, expired, another organization, not a Mainfast benefit) is
// treated as no key, with one log line. The key is never logged or written to the summary.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendSummary, getInput, type Env } from "./actions-io.ts";
import { SUITE } from "./brand.ts";
import { GitHub, GitHubError, parseNextLink, type GitHubResponse } from "./github.ts";

export type PlanStatus =
  | "public" // public repository: free
  | "free" // private, within the free contributor limit
  | "licensed" // private, Pro key (or an unverified key when over the limit)
  | "over-limit" // private, over the limit, no Pro key: notice
  | "unknown"; // could not tell (API refused); no notice

/** What the license key turned out to be. Absent: no key given (or the gate could not decide). */
export type KeyState =
  | "pro" // Polar confirmed a Mainfast Pro key
  | "free" // Polar confirmed the free key: registered, not Pro
  | "unverified" // Polar could not be asked (offline, timeout, 5xx, placeholder org): accepted
  | "refused"; // Polar refused the key: treated as no key

export interface PlanResult {
  status: PlanStatus;
  activeContributors?: number;
  /** Markdown notice; set only for "over-limit". */
  notice?: string;
  /** Why the gate could not decide, for the log. */
  reason?: string;
  /** Set when a license key was given. */
  key?: KeyState;
  /** Why a key was refused (never contains the key), for the one log line. */
  keyReason?: string;
}

export type KeyPlan = "free" | "pro";

export interface LicenseCheck {
  valid: boolean;
  /** True when the key was not verified against Polar (offline, timeout, 5xx, placeholder org). */
  offline: boolean;
  /** The plan of a key Polar confirmed. */
  plan?: KeyPlan;
  /** Why the key was refused; never contains the key. */
  reason?: string;
}

/** Checks a license key. Must never throw for a network problem (checkPlan also guards it). */
export type LicenseValidator = (key: string, ctx: { owner: string; repo: string; activeContributors?: number }) => Promise<LicenseCheck>;

/** Accepts any non-empty key without a network call (tests; and the placeholder-org build). */
export const acceptAnyKey: LicenseValidator = async (key) => ({ valid: key.trim().length > 0, offline: true });

/** The part of fetch the validator needs; a real fetch satisfies it. */
export type PolarFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface PolarValidatorOptions {
  fetch?: PolarFetch;
  /** API base; default env MAINFAST_POLAR_API, else brand.json suite.polar.api (production Polar). */
  api?: string;
  /** Polar organization id; default env MAINFAST_POLAR_ORG, else brand.json suite.polar.organizationId. */
  organizationId?: string;
  benefitIds?: { free: string; pro: string };
  timeoutMs?: number;
  env?: Env;
  now?: () => Date;
}

const PLACEHOLDER_ORG = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/** Plan for a Polar benefit id, from brand.json suite.plan.benefitIds. */
export function planForBenefit(benefitId: unknown, ids: { free: string; pro: string } = SUITE.plan.benefitIds): KeyPlan | undefined {
  if (typeof benefitId !== "string" || !benefitId) return undefined;
  if (benefitId === ids.pro) return "pro";
  if (benefitId === ids.free) return "free";
  return undefined;
}

/**
 * The real validator: Polar's customer-portal validate endpoint (mirrors Hourcairn's
 * `_validate` / `_from_key_payload`). 200 + status "granted" (or none) + our organization +
 * a known benefit + not expired -> valid with its plan. 404 or any of those failing ->
 * refused. Everything else (no network, timeout, 5xx, other HTTP status, bad JSON) ->
 * valid, offline. A placeholder organization id sends nothing.
 */
export function polarValidator(opts: PolarValidatorOptions = {}): LicenseValidator {
  const env = opts.env ?? process.env;
  const api = (opts.api ?? (env[SUITE.polar.apiEnv] || SUITE.polar.api)).replace(/\/+$/, "");
  const org = opts.organizationId ?? (env[SUITE.polar.orgEnv] || SUITE.polar.organizationId);
  const ids = opts.benefitIds ?? SUITE.plan.benefitIds;
  const timeoutMs = opts.timeoutMs ?? SUITE.polar.timeoutMs;
  const doFetch: PolarFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const offline: LicenseCheck = { valid: true, offline: true };
  return async (rawKey) => {
    const key = rawKey.trim();
    if (!key) return { valid: false, offline: true, reason: "empty key" };
    if (PLACEHOLDER_ORG.test(org)) return offline; // no organization configured yet: nothing to ask
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await doFetch(`${api}/v1/customer-portal/license-keys/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": `${SUITE.name.toLowerCase()}-license` },
        body: JSON.stringify({ key, organization_id: org }),
        signal: ctrl.signal,
      });
      status = res.status;
      text = status === 200 ? await res.text() : "";
    } catch {
      return offline; // network error, DNS, abort on timeout
    } finally {
      clearTimeout(timer);
    }
    if (status === 404) return { valid: false, offline: false, reason: "Polar does not know this key, or reports it revoked, disabled or expired" };
    if (status !== 200) return offline; // 5xx, 429, 4xx that is not about the key: never the customer's problem
    let lk: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return offline;
      lk = parsed as Record<string, unknown>;
    } catch {
      return offline;
    }
    if (lk.status !== undefined && lk.status !== null && lk.status !== "granted") {
      return { valid: false, offline: false, reason: `Polar reports the key as ${JSON.stringify(String(lk.status))}` };
    }
    if (lk.organization_id && lk.organization_id !== org) {
      return { valid: false, offline: false, reason: `the key belongs to another Polar organization, not ${SUITE.name}` };
    }
    const plan = planForBenefit(lk.benefit_id, ids);
    if (!plan) return { valid: false, offline: false, reason: `the key is not a ${SUITE.name} key (unknown benefit)` };
    if (typeof lk.expires_at === "string" && lk.expires_at) {
      const exp = new Date(lk.expires_at);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() <= (opts.now?.() ?? new Date()).getTime()) {
        return { valid: false, offline: false, reason: `the key expired on ${exp.toISOString().slice(0, 10)}` };
      }
    }
    return { valid: true, offline: false, plan };
  };
}

export interface PlanOptions {
  gh: GitHub;
  owner: string;
  repo: string;
  /** Event payload; `repository.private` saves an API call. */
  event?: { repository?: { private?: boolean } };
  /** License key (input `license`, else env MAINFAST_LICENSE). */
  license?: string;
  productName: string;
  now?: Date;
  /** Default: polarValidator() (Polar's public validate endpoint, non-fatal). */
  validate?: LicenseValidator;
  /** Directory for the per-run cache file (RUNNER_TEMP); omit to cache in memory only. */
  cacheDir?: string;
  /** GITHUB_RUN_ID: the cache file is reused only within the same run. */
  runId?: string;
}

const BOT_LOGINS = new Set(["dependabot", "renovate", "github-actions", "copilot", "web-flow", "ghost"]);

export function isBot(user: { login?: string | null; type?: string | null } | null | undefined): boolean {
  if (!user?.login) return true; // no linked account: not countable as a person
  const login = user.login.toLowerCase();
  return user.type === "Bot" || login.endsWith("[bot]") || login.endsWith("-bot") || BOT_LOGINS.has(login);
}

const memo = new Map<string, number>();
const keyMemo = new Map<string, LicenseCheck>();

/** Clears the in-memory caches (tests). */
export function resetPlanCache(): void {
  memo.clear();
  keyMemo.clear();
}

/** A short hash of the key: what the caches store instead of the key. */
function keyHash(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex").slice(0, 24);
}

function cacheFile(dir: string, owner: string, repo: string): string {
  return join(dir, `mainfast-plan-${owner}-${repo}.json`.replace(/[^\w.-]/g, "_"));
}

/**
 * Distinct people who opened a PR or pushed in the window. PR authors come from the pulls
 * list (newest first, stops at the window); pushers from the repository activity API, falling
 * back to default-branch commit authors when that endpoint is not available. Stops early once
 * the count is over the free limit.
 */
export async function countActiveContributors(gh: GitHub, owner: string, repo: string, since: Date, stopAbove = Infinity): Promise<number> {
  const people = new Set<string>();
  const add = (u: { login?: string | null; type?: string | null } | null | undefined) => {
    if (!isBot(u)) people.add(u!.login!.toLowerCase());
  };
  const done = () => people.size > stopAbove;
  const sinceIso = since.toISOString();
  const r = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let anySource = false;
  let lastError: unknown;

  try {
    let next: string | undefined = `${r}/pulls?state=all&sort=created&direction=desc&per_page=100`;
    for (let page = 0; next && page < 5 && !done(); page++) {
      const res: GitHubResponse<Array<{ created_at: string; user: { login: string; type: string } | null }>> = await gh.request("GET", next);
      let older = false;
      for (const p of res.data) {
        if (p.created_at < sinceIso) {
          older = true;
          break;
        }
        add(p.user);
      }
      next = older ? undefined : parseNextLink(res.headers.get("link"));
    }
    anySource = true;
  } catch (e) {
    lastError = e;
  }

  if (!done()) {
    try {
      let next: string | undefined = `${r}/activity?time_period=month&activity_type=push&per_page=100`;
      for (let page = 0; next && page < 5 && !done(); page++) {
        const res: GitHubResponse<Array<{ timestamp: string; actor: { login: string; type: string } | null }>> = await gh.request("GET", next);
        for (const a of res.data) if (a.timestamp >= sinceIso) add(a.actor);
        next = parseNextLink(res.headers.get("link"));
      }
      anySource = true;
    } catch (e) {
      lastError = e;
      try {
        let next: string | undefined = `${r}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`;
        for (let page = 0; next && page < 5 && !done(); page++) {
          const res: GitHubResponse<Array<{ author: { login: string; type: string } | null }>> = await gh.request("GET", next);
          for (const c of res.data) add(c.author);
          next = parseNextLink(res.headers.get("link"));
        }
        anySource = true;
      } catch (e2) {
        lastError = e2;
      }
    }
  }
  if (!anySource) throw lastError instanceof Error ? lastError : new Error("no contributor source available");
  return people.size;
}

export function planNotice(productName: string, active: number, freeKey = false): string {
  const p = SUITE.plan;
  return [
    `> [!NOTE]`,
    `> **${SUITE.name} is free for public repositories and for private repositories with up to ${p.freeActiveContributors} active contributors.**`,
    `> This private repository had ${active} active contributors in the last ${p.windowDays} days (people who opened a pull request or pushed; bots excluded).`,
    `> ${SUITE.name} Pro is ${p.proPricePerContributorMonth} per active contributor per month: ${SUITE.pricingUrl}.`,
    ...(freeKey ? [`> The key passed to this step is the free ${SUITE.name} key (registered, thank you); it does not cover Pro.`] : []),
    `> If your organization has ${SUITE.name} Pro, you can remove this note: copy the ${SUITE.name} Pro key from your Polar account (or Polar's email), save it as the \`${SUITE.licenseEnv}\` secret and add \`license: \${{ secrets.${SUITE.licenseEnv} }}\` to this step.`,
    `> Prefer no keys? Install the hosted ${SUITE.name} GitHub App (${SUITE.appUrl}) and buy Pro from its dashboard (${SUITE.dashboardUrl}). The App runs these checks for you with no key, and you can then delete this workflow.`,
    `> ${productName} ran in full and this notice never changes its result.`,
  ].join("\n");
}

export async function checkPlan(opts: PlanOptions): Promise<PlanResult> {
  const { gh, owner, repo } = opts;
  let isPrivate = opts.event?.repository?.private;
  if (typeof isPrivate !== "boolean") {
    try {
      isPrivate = (await gh.get<{ private?: boolean }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)).private;
    } catch (e) {
      return { status: "unknown", reason: describe(e) };
    }
  }
  const license = opts.license?.trim() ?? "";
  if (isPrivate !== true) return withKey({ status: "public" }, license ? await checkKey(opts, license) : undefined);

  const limit = SUITE.plan.freeActiveContributors;
  const key = `${owner}/${repo}`.toLowerCase();
  let active = memo.get(key);
  const file = opts.cacheDir ? cacheFile(opts.cacheDir, owner, repo) : undefined;
  if (active === undefined && file && existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, "utf8")) as { runId?: string; active?: number };
      if (c.runId === (opts.runId ?? "") && typeof c.active === "number") active = c.active;
    } catch {
      /* ignore a broken cache */
    }
  }
  if (active === undefined) {
    const since = new Date((opts.now ?? new Date()).getTime() - SUITE.plan.windowDays * 86_400_000);
    try {
      active = await countActiveContributors(gh, owner, repo, since, limit);
    } catch (e) {
      return { status: "unknown", reason: describe(e) };
    }
    memo.set(key, active);
    if (file) {
      try {
        mkdirSync(opts.cacheDir!, { recursive: true });
        writeFileSync(file, JSON.stringify({ runId: opts.runId ?? "", active }));
      } catch {
        /* cache is best effort */
      }
    }
  }
  const check = license ? await checkKey(opts, license, active) : undefined;
  const state = keyState(check);
  // A confirmed Pro key is Pro at any size; an unverified key gets the benefit of the doubt.
  if (state === "pro" || (state === "unverified" && active > limit)) return withKey({ status: "licensed", activeContributors: active }, check);
  if (active <= limit) return withKey({ status: "free", activeContributors: active }, check);
  return withKey({ status: "over-limit", activeContributors: active, notice: planNotice(opts.productName, active, state === "free") }, check);
}

function keyState(check: LicenseCheck | undefined): KeyState | undefined {
  if (!check) return undefined;
  if (!check.valid) return "refused";
  if (check.offline || !check.plan) return "unverified";
  return check.plan;
}

function withKey(result: PlanResult, check: LicenseCheck | undefined): PlanResult {
  const state = keyState(check);
  if (!state) return result;
  return state === "refused" ? { ...result, key: state, keyReason: check?.reason ?? "refused" } : { ...result, key: state };
}

/** Validates the key once per run: memory, then the RUNNER_TEMP file (stores a hash, never the key). */
async function checkKey(opts: PlanOptions, license: string, activeContributors?: number): Promise<LicenseCheck> {
  const h = keyHash(license);
  const hit = keyMemo.get(h);
  if (hit) return hit;
  const file = opts.cacheDir ? join(opts.cacheDir, `mainfast-license-${h}.json`) : undefined;
  if (file && existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, "utf8")) as { runId?: string; check?: LicenseCheck };
      if (c.runId === (opts.runId ?? "") && c.check && typeof c.check.valid === "boolean") {
        keyMemo.set(h, c.check);
        return c.check;
      }
    } catch {
      /* ignore a broken cache */
    }
  }
  const check = await (opts.validate ?? polarValidator())(license, { owner: opts.owner, repo: opts.repo, activeContributors }).catch(
    (): LicenseCheck => ({ valid: true, offline: true }),
  );
  keyMemo.set(h, check);
  if (file) {
    try {
      mkdirSync(opts.cacheDir!, { recursive: true });
      writeFileSync(file, JSON.stringify({ runId: opts.runId ?? "", check }));
    } catch {
      /* cache is best effort */
    }
  }
  return check;
}

function describe(e: unknown): string {
  return e instanceof GitHubError ? `GitHub ${e.status} on ${e.path}` : e instanceof Error ? e.message : String(e);
}

/**
 * What each Action calls: runs checkPlan, appends the notice to the job summary and logs one
 * line. A free key adds one quiet "Registered (free key)" line to the job summary; a key Polar
 * refused logs one line (without the key). Never throws, never sets a failure.
 */
export async function planGate(
  opts: Omit<PlanOptions, "license" | "cacheDir" | "runId"> & { env?: Env; license?: string },
): Promise<PlanResult> {
  const env = opts.env ?? process.env;
  if (!opts.gh.hasToken) return { status: "unknown", reason: "no token" };
  try {
    const result = await checkPlan({
      ...opts,
      license: opts.license ?? (getInput("license", "", env) || env[SUITE.licenseEnv] || ""),
      cacheDir: env.RUNNER_TEMP,
      runId: env.GITHUB_RUN_ID,
    });
    if (result.key === "refused") {
      process.stdout.write(`${SUITE.name}: the license key was not accepted (${result.keyReason}); continuing without a key. The check result is unaffected.\n`);
    } else if (result.key === "free" && !result.notice) {
      appendSummary(`\n<sub>${SUITE.name}: Registered (free key).</sub>\n`, env);
    }
    if (result.notice) {
      appendSummary(`\n${result.notice}\n`, env);
      process.stdout.write(
        `${SUITE.name}: free for up to ${SUITE.plan.freeActiveContributors} active contributors on private repositories; this one has ${result.activeContributors}. Pro: ${SUITE.plan.proPricePerContributorMonth}/contributor/month (${SUITE.pricingUrl}). The check result is unaffected.\n`,
      );
    }
    return result;
  } catch (e) {
    return { status: "unknown", reason: describe(e) };
  }
}
