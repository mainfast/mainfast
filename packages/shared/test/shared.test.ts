import { describe, expect, it } from "vitest";
import { PRODUCTS, product, SUITE } from "../src/brand.ts";
import { getSection, loadSection, mergeConfigDocs, parseConfigDoc, parseExtends, resolveConfig } from "../src/config.ts";
import { GitHub, GitHubError, parseNextLink } from "../src/github.ts";
import { globToRegExp, matchesAny } from "../src/glob.ts";
import { mockFetch } from "../src/mockfetch.ts";

describe("brand", () => {
  it("has five products with derived docs links", () => {
    expect(PRODUCTS.map((p) => p.slug)).toEqual(["intact", "migrations", "rollcall", "owners", "evidence"]);
    expect(product("migrations").docsUrl).toBe(`${SUITE.homepageUrl}/tree/main/migrations#readme`);
  });
});

describe("glob (gitignore-flavored, shared by every section)", () => {
  it.each([
    ["*.md", "a/b/c.md", true],
    ["/top.txt", "sub/top.txt", false],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/**/*.ts", "src/b.ts", true],
    ["*.{yml,yaml}", "ci.yaml", true],
    ["dist/", "dist/a/b.js", true],
    ["docs", "docs/x.md", true],
    ["legacy/**", "legacy/v1/001.sql", true],
    ["yarn.lock", "packages/a/yarn.lock", true],
    ["/CODEOWNERS", "docs/CODEOWNERS", false],
  ])("%s ~ %s = %s", (g, p, want) => expect(globToRegExp(g).test(p)).toBe(want));
  it("matchesAny", () => expect(matchesAny("a/b.go", ["*.py", "*.go"])).toBe(true));
});

describe("config document", () => {
  it("validates the top level and returns one section", () => {
    const doc = parseConfigDoc("version: 1\nintact:\n  ignore: [a]\nmigrations:\n  label: x\n");
    expect(getSection(doc, "intact")).toEqual({ ignore: ["a"] });
    expect(getSection(doc, "owners")).toEqual({});
    expect(() => parseConfigDoc("typo: 1\n")).toThrow(/unknown top-level key "typo"/);
    expect(() => parseConfigDoc("[1, 2]\n")).toThrow(/top level must be a mapping/);
    expect(() => parseConfigDoc("a: [\n")).toThrow(/invalid YAML/);
    expect(() => loadSection("intact:\n  nope: 1\n", "intact", { known: ["ignore"] })).toThrow(/unknown key "nope"/);
    expect(loadSection("", "intact")).toEqual({});
  });

  it("parses extends refs", () => {
    expect(parseExtends("acme/.github")).toMatchObject({ kind: "repo", owner: "acme", repo: ".github", path: ".mainfast.yml", ref: undefined });
    expect(parseExtends("acme/p:cfg/base.yml@v2")).toMatchObject({ kind: "repo", path: "cfg/base.yml", ref: "v2" });
    expect(parseExtends("./shared/a.yml")).toMatchObject({ kind: "local", path: "shared/a.yml" });
    expect(() => parseExtends("acme")).toThrow();
    expect(() => parseExtends("./../etc/passwd")).toThrow(/bad local path/);
  });

  it("merges child over parent: lists add, child keys first, scalars from the child", () => {
    const merged = mergeConfigDocs(
      { version: 1, intact: { main_branch: "main", ignore: ["a"], severity: { "docs/**": "notice" } }, migrations: { label: "p" } },
      { extends: "x/y", intact: { ignore: ["a", "b"], severity: { "docs/api/**": "error" }, main_branch: "trunk" } },
    );
    expect(merged).toEqual({
      version: 1,
      intact: { ignore: ["a", "b"], severity: { "docs/api/**": "error", "docs/**": "notice" }, main_branch: "trunk" },
      migrations: { label: "p" },
    });
    expect(Object.keys((merged.intact as { severity: object }).severity)).toEqual(["docs/api/**", "docs/**"]);
  });

  it("resolveConfig applies one level of extends", async () => {
    const fetcher = {
      repoFile: async (o: string, r: string, p: string) => (o === "acme" && r === "base" && p === ".mainfast.yml" ? "migrations:\n  label: shared\n" : undefined),
      localFile: async () => undefined,
    };
    const res = await resolveConfig("extends: acme/base\nmigrations:\n  outOfOrder: warning\n", fetcher);
    expect(res).toEqual({ doc: { migrations: { label: "shared", outOfOrder: "warning" } }, extendedFrom: "acme/base" });
    await expect(resolveConfig("extends: acme/base\n", undefined)).rejects.toThrow(/needs repository access/);
  });
});

describe("GitHub client + mockFetch", () => {
  it("paginates, reads files and reports errors with GitHub's message", async () => {
    const next = "https://api.github.com/repos/o/r/pulls?page=2";
    const fetch = mockFetch({
      "GET /repos/o/r/pulls": { body: [1], link: `<${next}>; rel="next"` },
      "GET /repos/o/r/pulls?page=2": { body: [2] },
      "GET /repos/o/r/contents/a/b.yml": { body: { type: "file", encoding: "base64", content: Buffer.from("x: 1").toString("base64") } },
      "GET /repos/o/r/forbidden": { status: 403, body: { message: "Resource not accessible by integration" } },
    });
    const gh = new GitHub({ token: "t", userAgent: "test", fetch });
    expect(await gh.paginate("/repos/o/r/pulls?per_page=100")).toEqual([1, 2]);
    expect(await gh.getFileText("o", "r", "a/b.yml", "main")).toBe("x: 1");
    expect(await gh.getFileText("o", "r", "missing.yml")).toBeUndefined();
    await expect(gh.get("/repos/o/r/forbidden")).rejects.toThrow(new GitHubError("GET", "/repos/o/r/forbidden", 403, '{"message":"Resource not accessible by integration"}'));
    expect(fetch.calls.filter((c) => !c.matched).map((c) => c.path)).toEqual(["/repos/o/r/contents/missing.yml"]);
    expect(parseNextLink(null)).toBeUndefined();
  });

  it("raw bodies and echoed writes (Evidence's fixture mode)", async () => {
    const fetch = mockFetch({ "GET /x": [1, 2] }, { rawBodies: true, echoWrites: true });
    const gh = new GitHub({ userAgent: "t", fetch: fetch.fetch });
    expect(await gh.get("/x?per_page=100")).toEqual([1, 2]);
    expect((await gh.request("POST", "/repos/o/r/check-runs", { name: "n" })).data).toMatchObject({ id: 900000, name: "n" });
  });
});
