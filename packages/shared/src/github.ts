// Minimal GitHub REST client on top of fetch, shared by every Mainfast package. The fetch
// function is injectable so tests run against fixtures and never touch the real API.
// (Merged from the migrations/rollcall/owners copy and Evidence's RestClient transport.)

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The part of a fetch Response the client reads. A real `Response` satisfies it. */
export interface FetchResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export const DEFAULT_API_URL = "https://api.github.com";
/** Pinned REST API version header, per GitHub's versioning docs. */
export const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubOptions {
  token?: string;
  apiUrl?: string;
  userAgent: string;
  fetch?: FetchLike;
  /** Hard cap on pages followed by paginate(), so a runaway listing stays bounded. */
  maxPages?: number;
}

export class GitHubError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;
  constructor(method: string, path: string, status: number, body: string) {
    super(`GitHub ${method} ${path} -> ${status}: ${errorText(body)}`);
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

/** GitHub's JSON `message` when there is one, else the first 300 characters of the body. */
function errorText(body: string): string {
  try {
    const m = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  headers: { get(name: string): string | null };
}

const enc = encodeURIComponent;
/** Encodes each segment of a repository path or branch name, keeping the slashes. */
export const encPath = (p: string): string => p.split("/").map(enc).join("/");

export class GitHub {
  readonly apiUrl: string;
  private readonly opts: GitHubOptions;
  private readonly fetchImpl: FetchLike;
  private readonly maxPages: number;

  constructor(opts: GitHubOptions) {
    this.opts = opts;
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.maxPages = opts.maxPages ?? 10;
  }

  /** True when requests carry a token. */
  get hasToken(): boolean {
    return Boolean(this.opts.token);
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<GitHubResponse<T>> {
    const url = path.startsWith("http") ? path : `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
      "user-agent": this.opts.userAgent,
    };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    Object.assign(headers, extraHeaders);
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const shortPath = url.startsWith(this.apiUrl) ? url.slice(this.apiUrl.length) : path;
    if (!res.ok) throw new GitHubError(method, shortPath, res.status, text);
    const data = (text ? JSON.parse(text) : undefined) as T;
    return { status: res.status, data, headers: res.headers };
  }

  async get<T = unknown>(path: string): Promise<T> {
    return (await this.request<T>("GET", path)).data;
  }

  /** GET that maps 404 to undefined instead of throwing. */
  async getOptional<T = unknown>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return undefined;
      throw e;
    }
  }

  /** True on 2xx (including 204), false on 404; anything else throws. */
  async exists(path: string): Promise<boolean> {
    try {
      await this.request("GET", path);
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    }
  }

  /**
   * Follows `Link: rel="next"` headers. `key` picks the array out of wrapped
   * responses such as `{ total_count, check_runs: [...] }`.
   */
  async paginate<T>(path: string, key?: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < this.maxPages; page++) {
      const res: GitHubResponse<unknown> = await this.request("GET", next);
      const items = key ? (res.data as Record<string, unknown>)[key] : res.data;
      if (Array.isArray(items)) out.push(...(items as T[]));
      next = parseNextLink(res.headers.get("link"));
    }
    return out;
  }

  /**
   * A text file from the contents API at `ref` (default branch when omitted), or undefined
   * when the file, the ref or the repository does not exist (404).
   */
  async getFileText(owner: string, repo: string, path: string, ref?: string): Promise<string | undefined> {
    const q = ref ? `?ref=${enc(ref)}` : "";
    const d = await this.getOptional<{ type?: string; encoding?: string; content?: string }>(
      `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}${q}`,
    );
    if (!d || d.type !== "file" || typeof d.content !== "string") return undefined;
    return d.encoding === "base64" ? Buffer.from(d.content, "base64").toString("utf8") : d.content;
  }
}

export function parseNextLink(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return undefined;
}

export function splitRepo(full: string): { owner: string; repo: string } {
  const [owner, repo] = full.split("/");
  if (!owner || !repo) throw new Error(`expected owner/repo, got "${full}"`);
  return { owner, repo };
}

/**
 * Creates or updates the single comment that carries `marker`, so re-runs edit
 * one comment instead of stacking new ones.
 */
export async function upsertComment(
  gh: GitHub,
  owner: string,
  repo: string,
  issue: number,
  marker: string,
  body: string,
): Promise<"created" | "updated" | "unchanged"> {
  const full = `${marker}\n${body}`;
  const mine = await findComment(gh, owner, repo, issue, marker);
  if (mine) {
    if (mine.body === full) return "unchanged";
    await gh.request("PATCH", `/repos/${owner}/${repo}/issues/comments/${mine.id}`, { body: full });
    return "updated";
  }
  await gh.request("POST", `/repos/${owner}/${repo}/issues/${issue}/comments`, { body: full });
  return "created";
}

export async function findComment(
  gh: GitHub,
  owner: string,
  repo: string,
  issue: number,
  marker: string,
): Promise<{ id: number; body?: string } | undefined> {
  const comments = await gh.paginate<{ id: number; body?: string }>(
    `/repos/${owner}/${repo}/issues/${issue}/comments?per_page=100`,
  );
  return comments.find((c) => c.body?.includes(marker));
}

// --- sticky comments owned by the token's identity ------------------------------------------

/** Who posts when the token cannot say (`GITHUB_TOKEN` in Actions cannot read `GET /user`). */
export const DEFAULT_COMMENT_AUTHOR = "github-actions[bot]";

export interface StickyComment {
  id: number;
  body?: string | null;
  user?: { login?: string | null } | null;
}

/**
 * The sticky comment is ours only if it starts with the marker AND was written by the identity we
 * post as. Anyone can paste a marker into their own comment; matching on the marker alone would
 * make a check overwrite (or try to overwrite) their comment, or follow it instead of its own.
 */
export function findSticky<C extends StickyComment>(comments: C[], marker: string, author: string): C | undefined {
  const me = author.toLowerCase();
  return comments.find((c) => c.user?.login?.toLowerCase() === me && typeof c.body === "string" && c.body.startsWith(marker));
}

/** The login comments are posted as: `override` (a `comment-author` input), else `GET /user`, else github-actions[bot]. */
export async function resolveCommentAuthor(gh: GitHub, override?: string): Promise<string> {
  if (override?.trim()) return override.trim();
  try {
    const login = (await gh.get<{ login?: unknown } | null>("/user"))?.login;
    if (typeof login === "string" && login) return login;
  } catch {
    /* 403 "Resource not accessible by integration" for GITHUB_TOKEN and installation tokens */
  }
  return DEFAULT_COMMENT_AUTHOR;
}

/** The sticky comment `author` wrote on an issue or PR, if any. */
export async function findOwnComment(
  gh: GitHub,
  owner: string,
  repo: string,
  issue: number,
  marker: string,
  author: string,
): Promise<StickyComment | undefined> {
  const comments = await gh.paginate<StickyComment>(`/repos/${enc(owner)}/${enc(repo)}/issues/${issue}/comments?per_page=100`);
  return findSticky(comments, marker, author);
}

/** Creates or updates the one comment that starts with `marker` and was written by `author`. */
export async function upsertSticky(
  gh: GitHub,
  owner: string,
  repo: string,
  issue: number,
  marker: string,
  body: string,
  author: string,
): Promise<"created" | "updated" | "unchanged"> {
  const full = `${marker}\n${body}`;
  const mine = await findOwnComment(gh, owner, repo, issue, marker, author);
  if (mine) {
    if (mine.body === full) return "unchanged";
    await gh.request("PATCH", `/repos/${enc(owner)}/${enc(repo)}/issues/comments/${mine.id}`, { body: full });
    return "updated";
  }
  await gh.request("POST", `/repos/${enc(owner)}/${enc(repo)}/issues/${issue}/comments`, { body: full });
  return "created";
}
