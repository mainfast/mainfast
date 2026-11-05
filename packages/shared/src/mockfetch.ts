// Fixture-driven fetch for tests and dry runs. Route keys are "METHOD /path?query"; a key
// without a query matches any query, and `per_page` is ignored when matching. Unmatched
// requests return 404 (or, with `echoWrites`, POST/PATCH echo the body with an id) and are
// recorded, so tests can assert nothing unexpected was called.
// (Merged from the migrations/rollcall/owners copy and Evidence's fixture fetch.)
import type { FetchInit, FetchLike } from "./github.ts";

export interface MockReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw `Link` header, to exercise pagination. */
  link?: string;
}
export type MockRoute = MockReply | ((req: { method: string; path: string; body?: any }) => MockReply);

export interface RecordedCall {
  method: string;
  path: string;
  body?: any;
  matched: boolean;
}

export interface MockFetchOptions {
  /** Route values that are not a MockReply ({status, body, headers, link}) are the response body. */
  rawBodies?: boolean;
  /** Unmatched POST/PATCH answer 201/200 with the request body plus an id and html_url, like GitHub. */
  echoWrites?: boolean;
  /** API base with a path prefix (GHES `/api/v3`): stripped before matching. */
  baseUrl?: string;
}

export type MockFetch = FetchLike & { calls: RecordedCall[]; fetch: FetchLike };

const REPLY_KEYS = new Set(["status", "body", "headers", "link"]);

function isReply(v: unknown): v is MockReply {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => REPLY_KEYS.has(k));
}

export function mockFetch(routes: Record<string, unknown>, opts: MockFetchOptions = {}): MockFetch {
  const calls: RecordedCall[] = [];
  const base = opts.baseUrl?.replace(/\/+$/, "");
  let nextId = 900_000;
  const fn = (async (url: string, init?: FetchInit) => {
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const pathOnly = base && url.startsWith(base) ? url.slice(base.length).split("?")[0]! : u.pathname;
    const path = pathOnly + u.search;
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const noPage = [...u.searchParams.entries()].filter(([k]) => k !== "per_page");
    const keys = [
      `${method} ${path}`,
      `${method} ${pathOnly}${noPage.length ? `?${new URLSearchParams(noPage).toString()}` : ""}`,
      `${method} ${pathOnly}`,
    ];
    const key = keys.find((k) => k in routes);
    calls.push({ method, path, body, matched: key !== undefined });
    let reply: MockReply;
    if (key !== undefined) {
      const route = routes[key];
      if (typeof route === "function") reply = (route as (r: { method: string; path: string; body?: any }) => MockReply)({ method, path, body });
      else if (opts.rawBodies && !isReply(route)) reply = { body: route };
      else reply = route as MockReply;
    } else if (opts.echoWrites && (method === "POST" || method === "PATCH")) {
      const id = nextId++;
      reply = { status: method === "POST" ? 201 : 200, body: { id, html_url: `https://github.com${pathOnly}/${id}`, ...(body as object) } };
    } else {
      reply = { status: 404, body: { message: "Not Found" } };
    }
    const status = reply.status ?? 200;
    const headers: Record<string, string> = { ...reply.headers };
    if (reply.link) headers.link = reply.link;
    const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
    return new Response(status === 204 || status === 304 ? null : text, { status, headers });
  }) as unknown as MockFetch;
  fn.calls = calls;
  fn.fetch = fn;
  return fn;
}
