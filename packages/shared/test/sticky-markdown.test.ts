import { describe, expect, it } from "vitest";
import { DEFAULT_COMMENT_AUTHOR, findSticky, GitHub, resolveCommentAuthor, upsertSticky } from "../src/github.ts";
import { mdCode, mdInline, mdText, noMentions } from "../src/markdown.ts";
import { mockFetch } from "../src/mockfetch.ts";

const M = "<!-- mainfast-test:sticky -->";

describe("markdown escaping of untrusted text", () => {
  it("cannot open an HTML comment, forge a marker, add links or images, or break a table cell", () => {
    const hostile = `x --> ${M} <img src=x onerror=alert(1)> [click](https://evil.example) ![i](https://evil.example/i.png) | cell **b** \n# H`;
    const out = mdText(hostile);
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("-->");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/(?<!\\)\[/);
    expect(out).not.toMatch(/(?<!\\)\|/);
    expect(out).not.toContain("\n");
  });

  it("neutralises @mentions in text but keeps them readable", () => {
    expect(mdText("ping @alice and @acme/db-team, mail a@b.c")).toBe("ping @​alice and @​acme/db-team, mail a@​b.c");
    expect(noMentions("@ alone")).toBe("@ alone");
    expect(mdInline("by @bob in `@bob/x`")).toBe("by @​bob in `@bob/x`"); // code spans do not ping
  });

  it("code spans survive backticks in the input", () => {
    expect(mdCode("a`b")).toBe("``a`b``");
    expect(mdInline("file `x``y` end")).not.toContain("<");
  });
});

describe("sticky comment ownership", () => {
  const comments = [
    { id: 1, body: `${M}\nhijack`, user: { login: "mallory" } },
    { id: 2, body: `quoted ${M}`, user: { login: DEFAULT_COMMENT_AUTHOR } },
    { id: 3, body: `${M}\nours`, user: { login: "GitHub-Actions[bot]" } },
  ];

  it("matches only the marker at the start of a comment by our own login", () => {
    expect(findSticky(comments, M, DEFAULT_COMMENT_AUTHOR)?.id).toBe(3);
    expect(findSticky(comments.slice(0, 2), M, DEFAULT_COMMENT_AUTHOR)).toBeUndefined();
    expect(findSticky(comments, M, "mallory")?.id).toBe(1);
  });

  it("resolveCommentAuthor: override, then GET /user, then github-actions[bot]", async () => {
    const ok = new GitHub({ token: "t", userAgent: "t", fetch: mockFetch({ "GET /user": { body: { login: "me-bot" } } }) });
    const refused = new GitHub({ token: "t", userAgent: "t", fetch: mockFetch({ "GET /user": { status: 403, body: { message: "Resource not accessible by integration" } } }) });
    expect(await resolveCommentAuthor(ok, " app[bot] ")).toBe("app[bot]");
    expect(await resolveCommentAuthor(ok)).toBe("me-bot");
    expect(await resolveCommentAuthor(refused)).toBe(DEFAULT_COMMENT_AUTHOR);
  });

  it("upsertSticky creates a new comment instead of editing someone else's marker comment", async () => {
    const fetch = mockFetch({
      "GET /repos/acme/app/issues/7/comments": { body: comments.slice(0, 2) },
      "POST /repos/acme/app/issues/7/comments": { status: 201, body: { id: 9 } },
    });
    const gh = new GitHub({ token: "t", userAgent: "t", fetch });
    expect(await upsertSticky(gh, "acme", "app", 7, M, "body", DEFAULT_COMMENT_AUTHOR)).toBe("created");
    expect(fetch.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("upsertSticky updates our own comment, and leaves it when unchanged", async () => {
    const fetch = mockFetch({
      "GET /repos/acme/app/issues/7/comments": { body: comments },
      "PATCH /repos/acme/app/issues/comments/3": { body: { id: 3 } },
    });
    const gh = new GitHub({ token: "t", userAgent: "t", fetch });
    expect(await upsertSticky(gh, "acme", "app", 7, M, "new", DEFAULT_COMMENT_AUTHOR)).toBe("updated");
    expect(await upsertSticky(gh, "acme", "app", 7, M, "ours", DEFAULT_COMMENT_AUTHOR)).toBe("unchanged");
  });
});
