import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOutputs } from "@mainfast/shared/actions-io";
import { GitHub } from "@mainfast/shared/github";
import { mockFetch } from "@mainfast/shared/mockfetch";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../src/action.ts";
import { isIgnored, levelFor, resolveIntactConfig } from "../src/config.ts";
import { extendsFetcher, loadConfigAtRev } from "../src/extends.ts";
import { Git } from "../src/git.ts";
import { cleanupAll, cli, makeRepo, mergeInto, tenLines } from "./helpers.ts";

afterAll(cleanupAll);
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const b64 = (s: string) => Buffer.from(s).toString("base64");
const file = (text: string) => ({ body: { type: "file", encoding: "base64", content: b64(text) } });

const SHARED = [
  "version: 1",
  "intact:",
  "  main_branch: trunk",
  "  ignore: [dist/]",
  "  severity:",
  "    'docs/**': notice",
  "migrations:",
  "  outOfOrder: warning",
  "",
].join("\n");

describe("extends (Pro): org-wide shared config", () => {
  it("merges another repository's file: lists add up, the local file wins and is matched first", async () => {
    const fetch = mockFetch({ "GET /repos/acme/.github/contents/mainfast/base.yml": file(SHARED) });
    const gh = new GitHub({ token: "t", userAgent: "test", fetch });
    const repo = makeRepo();
    const local = "extends: acme/.github:mainfast/base.yml@main\nintact:\n  ignore: [gen/]\n  severity:\n    'docs/api/**': error\n";
    const cfg = await resolveIntactConfig(local, extendsFetcher(new Git(repo.dir), repo.dir, undefined, gh));
    expect(fetch.calls.map((c) => c.path)).toEqual(["/repos/acme/.github/contents/mainfast/base.yml?ref=main"]);
    expect(cfg.extendedFrom).toBe("acme/.github:mainfast/base.yml@main");
    expect(cfg.mainBranch).toBe("trunk");
    expect(cfg.ignore).toEqual(["dist/", "gen/"]);
    expect(levelFor(cfg, "docs/api/x.md", "warning")).toBe("error"); // local pattern first
    expect(levelFor(cfg, "docs/guide.md", "warning")).toBe("notice"); // shared pattern still applies
    expect(isIgnored(cfg, "web/package-lock.json")).toBe(false); // lockfiles stay checked
  });

  it("defaults to .mainfast.yml on the other repository's default branch", async () => {
    const fetch = mockFetch({ "GET /repos/acme/policies/contents/.mainfast.yml": file(SHARED) });
    const gh = new GitHub({ token: "t", userAgent: "test", fetch });
    const repo = makeRepo();
    const cfg = await resolveIntactConfig("extends: acme/policies\n", extendsFetcher(new Git(repo.dir), repo.dir, undefined, gh));
    expect(fetch.calls.map((c) => c.path)).toEqual(["/repos/acme/policies/contents/.mainfast.yml"]);
    expect(cfg.ignore).toEqual(["dist/"]);
  });

  it("fails clearly when the shared file is missing or extends again", async () => {
    const fetch = mockFetch({ "GET /repos/acme/chain/contents/.mainfast.yml": file("extends: acme/other\n") });
    const gh = new GitHub({ token: "t", userAgent: "test", fetch });
    const repo = makeRepo();
    const f = extendsFetcher(new Git(repo.dir), repo.dir, undefined, gh);
    await expect(resolveIntactConfig("extends: acme/missing\n", f)).rejects.toThrow(/not found.*config-token/);
    await expect(resolveIntactConfig("extends: acme/chain\n", f)).rejects.toThrow(/chains are not supported/);
    await expect(resolveIntactConfig("extends: not a ref\n", f)).rejects.toThrow(/owner\/repo/);
  });

  it("reads a ./path extends at the same commit as the config", async () => {
    const repo = makeRepo();
    repo.write("policy/shared.yml", SHARED);
    repo.write(".mainfast.yml", "extends: ./policy/shared.yml\n");
    const sha = repo.commit("policy");
    repo.write("policy/shared.yml", "intact:\n  ignore: [changed-later/]\n");
    const cfg = await loadConfigAtRev(new Git(repo.dir), repo.dir, sha, undefined);
    expect(cfg.ignore).toEqual(["dist/"]);
    expect(cfg.extendedFrom).toBe("./policy/shared.yml");
  });

  it("works from the CLI (working tree)", async () => {
    const repo = makeRepo();
    repo.write("a.txt", "a\n");
    repo.commit("base");
    repo.write("shared.yml", "intact:\n  main_branch: nope\n");
    repo.write(".mainfast.yml", "extends: ./shared.yml\n");
    const res = await cli(repo.dir, "check");
    expect(res.code).toBe(2);
    expect(res.err).toContain("cannot find the main branch");
  });
});

describe("action reads .mainfast.yml from the base of the change", () => {
  it("a pull request cannot ignore its own dropped change", async () => {
    const repo = makeRepo();
    repo.write("config.txt", tenLines({ 5: "timeout = 10" }));
    const base = repo.commit("base");
    repo.git("checkout", "-q", "-b", "feat");
    repo.write("config.txt", tenLines({ 5: "timeout = 10 # per tenant" }));
    repo.commit("annotate");
    repo.git("checkout", "-q", "main");
    repo.write("config.txt", tenLines({ 5: "timeout = 30" }));
    repo.commit("Raise timeout to 30");
    repo.git("checkout", "-q", "feat");
    mergeInto(repo, "main", () => repo.git("checkout", "--ours", "config.txt"));
    repo.write(".mainfast.yml", "intact:\n  ignore: [config.txt]\n"); // the PR tries to switch itself off
    repo.commit("ignore config.txt");

    const tmp = mkdtempSync(join(tmpdir(), "mainfast-base-"));
    const eventPath = join(tmp, "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base, ref: "main" }, head: { sha: repo.head() } }, repository: { private: false } }));
    const output = join(tmp, "out");
    writeFileSync(output, "");
    Object.assign(process.env, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_WORKSPACE: repo.dir,
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: tmp,
      INPUT_TOKEN: "",
      INPUT_CONFIG: "",
    });
    delete process.env.GITHUB_STEP_SUMMARY;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runAction()).toBe(1);
    expect(parseOutputs(readFileSync(output, "utf8")).status).toBe("fail");

    // The same file given explicitly with `config:` is read from the checkout.
    writeFileSync(output, "");
    process.env.INPUT_CONFIG = ".mainfast.yml";
    expect(await runAction()).toBe(0);
  });
});
