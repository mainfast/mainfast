// Evidence's typed endpoints over the shared GitHub client (@mainfast/shared/github), shaped per
// the REST docs (API version 2022-11-28). `fetch` is injectable so tests run against recorded
// fixture payloads.
import { GitHub, GitHubError, parseNextLink, type FetchLike } from "@mainfast/shared/github";
import { DEFAULT_API_URL, USER_AGENT } from "../constants.ts";

export { GitHubError, type FetchLike };

// --- Raw payload shapes (subset of fields we read) ---------------------------------------------

export interface RawUser {
  login: string;
  type: string;
}

export interface RawPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: RawUser;
  state?: string;
  updated_at?: string;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string; sha: string; repo: { full_name: string } };
  labels: Array<{ name: string }>;
}

export interface RawCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date?: string } | null;
    committer: { name: string; email: string; date?: string } | null;
  };
  author: RawUser | null;
  committer: RawUser | null;
}

export interface RawFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface RawCheckRun {
  id: number;
  name: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  details_url: string | null;
  html_url?: string | null;
  output: { title: string | null; summary: string | null } | null;
  app: { id?: number; slug: string } | null;
}

export interface RawStatus {
  context: string;
  state: string;
  description: string | null;
  target_url: string | null;
  updated_at: string;
}

export interface RawComment {
  id: number;
  body: string;
  html_url: string;
  user: RawUser | null;
}

export interface GitHubApi {
  /** The shared transport: required checks are read by @mainfast/shared/required-checks over it. */
  readonly gh: GitHub;
  getPull(owner: string, repo: string, n: number): Promise<RawPull>;
  listPullCommits(owner: string, repo: string, n: number): Promise<RawCommit[]>;
  listPullFiles(owner: string, repo: string, n: number): Promise<RawFile[]>;
  listCheckRunsForRef(owner: string, repo: string, ref: string, checkName?: string): Promise<RawCheckRun[]>;
  listStatusesForRef(owner: string, repo: string, ref: string): Promise<RawStatus[]>;
  /** `GET /repos/{o}/{r}/commits/{sha}/pulls`: merged and open PRs whose head contains the commit. */
  listPullsForCommit(owner: string, repo: string, sha: string): Promise<RawPull[]>;
  /** `GET /repos/{o}/{r}/pulls?state=open[&head=user:branch]`, newest first, capped at `max`. */
  listOpenPulls(owner: string, repo: string, opts?: { head?: string; max?: number }): Promise<RawPull[]>;
  getFileContent(owner: string, repo: string, path: string, ref: string): Promise<string | undefined>;
  listIssueComments(owner: string, repo: string, n: number): Promise<RawComment[]>;
  createIssueComment(owner: string, repo: string, n: number, body: string): Promise<RawComment>;
  updateIssueComment(owner: string, repo: string, id: number, body: string): Promise<RawComment>;
  createCheckRun(owner: string, repo: string, body: unknown): Promise<RawCheckRun>;
  updateCheckRun(owner: string, repo: string, id: number, body: unknown): Promise<RawCheckRun>;
  /** Login of the token's own identity (`GET /user`), or undefined when the token cannot read it (GITHUB_TOKEN and app installation tokens). */
  getAuthenticatedLogin?(): Promise<string | undefined>;
}

const enc = encodeURIComponent;

export class RestClient implements GitHubApi {
  /** The shared transport, for callers that need plain REST (the plan gate). */
  readonly gh: GitHub;
  constructor(token: string | undefined, opts: { baseUrl?: string; fetch?: FetchLike } = {}) {
    this.gh = new GitHub({ token, apiUrl: opts.baseUrl ?? DEFAULT_API_URL, userAgent: USER_AGENT, fetch: opts.fetch });
  }

  async raw(method: string, pathOrUrl: string, body?: unknown): Promise<{ data: unknown; next?: string }> {
    const res = await this.gh.request(method, pathOrUrl, body);
    return { data: res.data, next: parseNextLink(res.headers.get("link")) };
  }

  private async paginate<T>(path: string, pick?: (d: unknown) => T[], max = 3000): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url && out.length < max) {
      const { data, next } = await this.raw("GET", url);
      out.push(...(pick ? pick(data) : (data as T[])));
      url = next;
    }
    return out;
  }

  getPull(o: string, r: string, n: number) {
    return this.raw("GET", `/repos/${enc(o)}/${enc(r)}/pulls/${n}`).then((x) => x.data as RawPull);
  }
  listPullCommits(o: string, r: string, n: number) {
    return this.paginate<RawCommit>(`/repos/${enc(o)}/${enc(r)}/pulls/${n}/commits`, undefined, 250);
  }
  listPullFiles(o: string, r: string, n: number) {
    return this.paginate<RawFile>(`/repos/${enc(o)}/${enc(r)}/pulls/${n}/files`);
  }
  listCheckRunsForRef(o: string, r: string, ref: string, checkName?: string) {
    const q = checkName ? `?check_name=${enc(checkName)}&filter=latest` : "?filter=latest";
    return this.paginate<RawCheckRun>(`/repos/${enc(o)}/${enc(r)}/commits/${enc(ref)}/check-runs${q}`, (d) => (d as { check_runs: RawCheckRun[] }).check_runs);
  }
  listStatusesForRef(o: string, r: string, ref: string) {
    // The combined-status endpoint already collapses to the latest status per context.
    return this.paginate<RawStatus>(`/repos/${enc(o)}/${enc(r)}/commits/${enc(ref)}/status`, (d) => (d as { statuses: RawStatus[] }).statuses);
  }
  listPullsForCommit(o: string, r: string, sha: string) {
    return this.paginate<RawPull>(`/repos/${enc(o)}/${enc(r)}/commits/${enc(sha)}/pulls`, undefined, 100);
  }
  listOpenPulls(o: string, r: string, opts: { head?: string; max?: number } = {}) {
    const head = opts.head ? `&head=${enc(opts.head)}` : "";
    return this.paginate<RawPull>(`/repos/${enc(o)}/${enc(r)}/pulls?state=open&sort=updated&direction=desc${head}`, undefined, opts.max ?? 300);
  }
  getFileContent(o: string, r: string, path: string, ref: string) {
    return this.gh.getFileText(o, r, path, ref);
  }
  async getAuthenticatedLogin(): Promise<string | undefined> {
    try {
      const { data } = await this.raw("GET", "/user");
      const login = (data as { login?: unknown } | null)?.login;
      return typeof login === "string" && login ? login : undefined;
    } catch {
      return undefined; // 403 "Resource not accessible by integration" for GITHUB_TOKEN / installation tokens
    }
  }
  listIssueComments(o: string, r: string, n: number) {
    return this.paginate<RawComment>(`/repos/${enc(o)}/${enc(r)}/issues/${n}/comments`);
  }
  createIssueComment(o: string, r: string, n: number, body: string) {
    return this.raw("POST", `/repos/${enc(o)}/${enc(r)}/issues/${n}/comments`, { body }).then((x) => x.data as RawComment);
  }
  updateIssueComment(o: string, r: string, id: number, body: string) {
    return this.raw("PATCH", `/repos/${enc(o)}/${enc(r)}/issues/comments/${id}`, { body }).then((x) => x.data as RawComment);
  }
  createCheckRun(o: string, r: string, body: unknown) {
    return this.raw("POST", `/repos/${enc(o)}/${enc(r)}/check-runs`, body).then((x) => x.data as RawCheckRun);
  }
  updateCheckRun(o: string, r: string, id: number, body: unknown) {
    return this.raw("PATCH", `/repos/${enc(o)}/${enc(r)}/check-runs/${id}`, body).then((x) => x.data as RawCheckRun);
  }
}
