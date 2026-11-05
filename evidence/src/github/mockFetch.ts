// Fixture fetch for the tests and `mainfast-evidence pr --fixture <file>`: the shared mockFetch
// (@mainfast/shared/mockfetch) with Evidence's defaults. A route value that is not a
// { status, body, link } reply is the response body, and unmatched POST/PATCH echo the request
// with an id, like GitHub does. Returns a fetch function that also has `.fetch` and `.calls`.
import { mockFetch as sharedMockFetch, type MockFetch, type MockFetchOptions, type MockReply, type RecordedCall } from "@mainfast/shared/mockfetch";

export type FixtureRoute = MockReply;
/** Route keys: "GET /repos/o/r/pulls/1" (query string ignored unless the key includes one). */
export type FixtureRoutes = Record<string, FixtureRoute | unknown>;
export type { RecordedCall };

export function mockFetch(routes: FixtureRoutes, opts: Omit<MockFetchOptions, "rawBodies" | "echoWrites"> = {}): MockFetch {
  return sharedMockFetch(routes, { rawBodies: true, echoWrites: true, baseUrl: opts.baseUrl ?? "https://api.github.com" });
}
