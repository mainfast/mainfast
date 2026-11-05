// The GitHub questions Owners asks, each cached per run. Endpoint shapes per docs.github.com REST
// (API version 2022-11-28).
//
// Two clients: `gh` (the workflow's GITHUB_TOKEN is enough) for the repository, public user
// lookups, collaborator permission, CODEOWNERS errors and search; `org` (the optional
// `org-token`) for org membership and teams, which GITHUB_TOKEN cannot read. Without `org`, the
// org checks are skipped and reported once (OrgChecks 'needs-token'), never guessed.
import { encPath, GitHub, GitHubError } from '@mainfast/shared/github';
import { MAX_CODEOWNERS_BYTES } from './codeowners.js';
import type { DormancyInfo, OrgChecks } from './types.js';

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' | 'unknown';

export interface CodeownersError {
  line: number;
  column: number;
  kind: string;
  source: string;
  suggestion?: string | null;
  message: string;
  path: string;
}

export interface PrFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export interface CodeownersFile {
  path: string;
  text: string;
  /** Bytes, from the contents API. */
  size?: number;
}

export interface PullInfo {
  number: number;
  title?: string;
  author_association?: string;
  base: { ref: string; sha: string; repo?: { full_name?: string } | null };
  head: { sha: string; repo?: { full_name?: string } | null };
}

export interface OwnersApiOptions {
  /** Client for org membership and team endpoints (the `org-token`); omit when there is none. */
  org?: GitHub;
  /** `repository.owner.type` from the event payload, saves `GET /repos/{o}/{r}`. */
  ownerType?: string;
  /** Search requests allowed this run (dormancy). Default 100. */
  maxSearches?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

/** Longest single wait for the search rate limit to reset; longer and the rest are skipped. */
const MAX_WAIT_MS = 65_000;
const ROLES = ['admin', 'maintain', 'write', 'triage', 'read'];
const enc = encodeURIComponent;
const isRateLimit = (e: GitHubError) => (e.status === 403 || e.status === 429) && /rate limit|abuse/i.test(e.body);

export class OwnersApi {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly org?: GitHub;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly maxSearches: number;
  private readonly search = { made: 0, skipped: 0, capped: false, stopped: false, resumeAt: 0 };
  /** Why the org checks or the search stopped, for the report notes. */
  orgRefusal?: string;
  searchStop?: string;

  constructor(
    readonly gh: GitHub,
    readonly owner: string,
    readonly repo: string,
    opts: OwnersApiOptions = {},
  ) {
    this.org = opts.org;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = opts.clock ?? Date.now;
    this.maxSearches = opts.maxSearches ?? 100;
    if (opts.ownerType) this.cache.set('ownerType', Promise.resolve(opts.ownerType === 'Organization'));
  }

  private get base(): string {
    return `/repos/${enc(this.owner)}/${enc(this.repo)}`;
  }

  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      this.cache.set(key, p);
    }
    return p;
  }

  /** GET /repos/{o}/{r} -> owner.type ("Organization" | "User"). */
  ownerIsOrg(): Promise<boolean> {
    return this.memo('ownerType', async () => (await this.gh.get<{ owner: { type: string } }>(this.base)).owner.type === 'Organization');
  }

  /** GET /repos/{o}/{r} -> default_branch. */
  defaultBranch(): Promise<string> {
    return this.memo('defaultBranch', async () => (await this.gh.get<{ default_branch: string }>(this.base)).default_branch);
  }

  /**
   * Whether org membership and team checks can run: one probe, `GET /orgs/{org}/teams?per_page=1`
   * with the org client (needs Organization > Members: read). Never with GITHUB_TOKEN.
   */
  orgChecks(): Promise<OrgChecks> {
    return this.memo('orgChecks', async () => {
      if (!(await this.ownerIsOrg())) return 'not-org';
      if (!this.org) return 'needs-token';
      try {
        await this.org.request('GET', `/orgs/${enc(this.owner)}/teams?per_page=1`);
        return 'enabled';
      } catch (e) {
        if (!(e instanceof GitHubError)) throw e;
        this.orgRefusal = `${e.status}: ${e.message.replace(/^GitHub GET \S+ -> \d+: /, '')}`;
        return 'refused';
      }
    });
  }

  /** GET /users/{username}: 404 means the account does not exist (deleted or renamed). */
  userExists(login: string): Promise<boolean> {
    return this.memo(`user:${login.toLowerCase()}`, () => this.gh.exists(`/users/${enc(login)}`));
  }

  /** GET /orgs/{org}/members/{username} with the org client: 204 member, 404 not a member. */
  isOrgMember(login: string): Promise<boolean> {
    return this.memo(`member:${login.toLowerCase()}`, () => this.orgClient().exists(`/orgs/${enc(this.owner)}/members/${enc(login)}`));
  }

  /**
   * GET /repos/{o}/{r}/collaborators/{username}/permission -> { permission, role_name } (Metadata:
   * read, so GITHUB_TOKEN works). 404 = no access; 403 = 'unknown'.
   */
  userPermission(login: string): Promise<RepoPermission> {
    return this.memo(`perm:${login.toLowerCase()}`, async () => {
      try {
        const r = await this.gh.get<{ permission: string; role_name?: string }>(`${this.base}/collaborators/${enc(login)}/permission`);
        // role_name carries maintain/triage; permission folds them into write/read
        const role = r.role_name;
        return (role && ROLES.includes(role) ? role : r.permission) as RepoPermission;
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return 'none';
        if (e instanceof GitHubError && e.status === 403) return 'unknown';
        throw e;
      }
    });
  }

  /** GET /orgs/{org}/teams/{team_slug} with the org client: 404 means no such team. */
  teamExists(slug: string): Promise<boolean> {
    return this.memo(`team:${slug}`, () => this.orgClient().exists(`/orgs/${enc(this.owner)}/teams/${enc(slug)}`));
  }

  /**
   * GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo} with
   * Accept: application/vnd.github.v3.repository+json returns the repo with the team's
   * `permissions`; 404 means the team has no access.
   */
  teamPermission(slug: string): Promise<RepoPermission> {
    return this.memo(`teamperm:${slug}`, async () => {
      try {
        const r = await this.orgClient().request<{ role_name?: string; permissions?: Record<string, boolean> }>(
          'GET',
          `/orgs/${enc(this.owner)}/teams/${enc(slug)}/repos/${enc(this.owner)}/${enc(this.repo)}`,
          undefined,
          { accept: 'application/vnd.github.v3.repository+json' },
        );
        const p = r.data?.permissions ?? {};
        if (r.data?.role_name && ROLES.includes(r.data.role_name)) return r.data.role_name as RepoPermission;
        return p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'write' : p.triage ? 'triage' : p.pull ? 'read' : 'none';
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) return 'none';
        throw e;
      }
    });
  }

  /** GET /orgs/{org}/teams/{team_slug}/members with the org client. */
  teamMembers(slug: string): Promise<string[]> {
    return this.memo(`members:${slug}`, async () =>
      (await this.orgClient().paginate<{ login: string }>(`/orgs/${enc(this.owner)}/teams/${enc(slug)}/members?per_page=100`)).map((m) => m.login),
    );
  }

  private orgClient(): GitHub {
    if (!this.org) throw new Error('org checks need an org token');
    return this.org;
  }

  /**
   * PRs in this repo the user reviewed that were updated since `since`, via
   * GET /search/issues?q=repo:o/r type:pr reviewed-by:<login> updated:>=<date> (only total_count).
   * The search API allows 30 requests a minute: when a response says the quota is spent the next
   * request waits for the reset (at most 65 s), a rate-limit 403/429 is retried twice with
   * backoff, and at most `maxSearches` requests are made per run. undefined = not checked.
   */
  reviewsSince(login: string, since: string): Promise<number | undefined> {
    return this.memo(`reviews:${login.toLowerCase()}:${since}`, async () => {
      const s = this.search;
      for (let attempt = 0; ; attempt++) {
        if (s.stopped || s.made >= this.maxSearches) {
          if (!s.stopped) s.capped = true;
          s.skipped++;
          return undefined;
        }
        const wait = s.resumeAt - this.clock();
        if (wait > MAX_WAIT_MS) {
          this.stopSearch('the search rate limit resets too late for this run');
          continue;
        }
        if (wait > 0) await this.sleep(wait);
        s.made++;
        try {
          const q = `repo:${this.owner}/${this.repo} type:pr reviewed-by:${login} updated:>=${since}`;
          const r = await this.gh.request<{ total_count: number }>('GET', `/search/issues?q=${enc(q)}&per_page=1`);
          const remaining = Number(r.headers.get('x-ratelimit-remaining') ?? NaN);
          const reset = Number(r.headers.get('x-ratelimit-reset') ?? NaN);
          if (remaining <= 0 && Number.isFinite(reset)) s.resumeAt = reset * 1000 + 1000;
          return r.data.total_count;
        } catch (e) {
          if (!(e instanceof GitHubError)) throw e;
          if (!isRateLimit(e)) {
            this.stopSearch(`GitHub search answered ${e.status}`);
            continue;
          }
          if (attempt >= 2) {
            this.stopSearch('the search rate limit was still exceeded after two retries');
            continue;
          }
          await this.sleep(15_000 * 2 ** attempt);
        }
      }
    });
  }

  private stopSearch(why: string): void {
    this.search.stopped = true;
    this.searchStop ??= why;
  }

  dormancyInfo(days: number): DormancyInfo {
    return { days, searches: this.search.made, skipped: this.search.skipped, capped: this.search.capped || this.search.stopped };
  }

  /** GET /repos/{o}/{r}/codeowners/errors?ref= -> what GitHub itself rejects; undefined when refused (403). */
  codeownersErrors(ref?: string): Promise<CodeownersError[] | undefined> {
    return this.memo(`coerr:${ref}`, async () => {
      const q = ref ? `?ref=${enc(ref)}` : '';
      try {
        const r = await this.gh.getOptional<{ errors: CodeownersError[] }>(`${this.base}/codeowners/errors${q}`);
        return r?.errors ?? [];
      } catch (e) {
        if (e instanceof GitHubError && e.status === 403) return undefined;
        throw e;
      }
    });
  }

  /** GET /repos/{o}/{r}/pulls/{n}. */
  pull(n: number): Promise<PullInfo> {
    return this.memo(`pull:${n}`, () => this.gh.get<PullInfo>(`${this.base}/pulls/${n}`));
  }

  /** GET /repos/{o}/{r}/pulls/{n}/files (paginated, capped by GitHub at 3000 files). */
  prFiles(n: number): Promise<PrFile[]> {
    return this.memo(`files:${n}`, () => this.gh.paginate<PrFile>(`${this.base}/pulls/${n}/files?per_page=100`));
  }

  /** GET /repos/{o}/{r}/git/trees/{ref}?recursive=1 -> blob paths. */
  treePaths(ref: string): Promise<{ paths: string[]; truncated: boolean }> {
    return this.memo(`tree:${ref}`, async () => {
      const r = await this.gh.get<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(`${this.base}/git/trees/${enc(ref)}?recursive=1`);
      return { paths: r.tree.filter((t) => t.type === 'blob').map((t) => t.path), truncated: Boolean(r.truncated) };
    });
  }

  /**
   * GET /repos/{o}/{r}/contents/{path}?ref= -> the file, or undefined when it does not exist.
   * Files over 1 MB come back without content (encoding "none"): read through the blob API.
   * Over 3 MB GitHub ignores CODEOWNERS, so the text is not fetched (`size` tells).
   */
  codeownersFile(path: string, ref?: string): Promise<CodeownersFile | undefined> {
    return this.memo(`file:${path}:${ref}`, async () => {
      const q = ref ? `?ref=${enc(ref)}` : '';
      const d = await this.gh.getOptional<{ type?: string; encoding?: string; content?: string; size?: number; sha?: string }>(
        `${this.base}/contents/${encPath(path)}${q}`,
      );
      if (!d || d.type !== 'file') return undefined;
      const size = d.size ?? 0;
      if (size > MAX_CODEOWNERS_BYTES) return { path, text: '', size };
      let b64 = d.encoding === 'base64' ? d.content : undefined;
      if (b64 === undefined && d.sha) b64 = (await this.gh.get<{ content: string }>(`${this.base}/git/blobs/${enc(d.sha)}`)).content;
      return { path, text: b64 === undefined ? (d.content ?? '') : Buffer.from(b64, 'base64').toString('utf8'), size };
    });
  }
}
