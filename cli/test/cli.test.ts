// Runs the real bundle against real temporary git repositories; nothing here touches the network.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI_DIR = join(import.meta.dirname, "..");
const BIN = join(CLI_DIR, "dist/mainfast.cjs");
const made: string[] = [];
const CLEAN_ENV = { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "" };

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mainfast-cli-"));
  made.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repo(): string {
  const d = tmp();
  git(d, "init", "-q", "-b", "main");
  writeFileSync(join(d, "app.txt"), "one\ntwo\nthree\n");
  git(d, "add", ".");
  git(d, "commit", "-qm", "base");
  return d;
}

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = CLEAN_ENV) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

/** A branch whose merge commit dropped main's change, resolved by taking ours. */
function droppedMerge(): string {
  const d = repo();
  git(d, "checkout", "-qb", "feature");
  writeFileSync(join(d, "other.txt"), "x\n");
  git(d, "add", ".");
  git(d, "commit", "-qm", "feature");
  git(d, "checkout", "-q", "main");
  writeFileSync(join(d, "app.txt"), "one\nTWO ON MAIN\nthree\n");
  git(d, "commit", "-qam", "main change");
  git(d, "checkout", "-q", "feature");
  git(d, "merge", "-q", "-s", "ours", "--no-edit", "main");
  return d;
}

beforeAll(() => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: CLI_DIR, stdio: "pipe" });
});
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("init", () => {
  it("writes each check's workflow and a config in a fresh repo", () => {
    const d = repo();
    const r = run(d, ["init", "--json"]);
    expect(r.code, r.stderr).toBe(0);
    const j = r.json();
    expect(j.written).toHaveLength(6);
    for (const f of j.written) expect(existsSync(join(d, f)), f).toBe(true);
    expect(readFileSync(join(d, ".github/workflows/mainfast-intact.yml"), "utf8")).toBe(readFileSync(join(CLI_DIR, "../intact/examples/mainfast-intact.yml"), "utf8"));
    expect(readFileSync(join(d, ".github/workflows/mainfast-intact.yml"), "utf8")).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(j.next_steps.join(" ")).toMatch(/require/);
    expect(j.hosted_app).toMatch(/^https:\/\/github\.com\/apps\//);
  });

  it("changes nothing when run again", () => {
    const d = repo();
    run(d, ["init"]);
    const j = run(d, ["init", "--json"]).json();
    expect(j.written).toEqual([]);
    expect(j.overwritten).toEqual([]);
    expect(j.unchanged).toHaveLength(6);
  });

  it("does not overwrite without --force, and does with it", () => {
    const d = repo();
    run(d, ["init", "--checks", "intact"]);
    const f = join(d, ".github/workflows/mainfast-intact.yml");
    writeFileSync(f, "mine\n");
    const kept = run(d, ["init", "--checks", "intact", "--json"]).json();
    expect(kept.skipped[0].path).toBe(".github/workflows/mainfast-intact.yml");
    expect(readFileSync(f, "utf8")).toBe("mine\n");
    expect(run(d, ["init", "--checks", "intact", "--force", "--json"]).json().overwritten).toContain(".github/workflows/mainfast-intact.yml");
    expect(readFileSync(f, "utf8")).not.toBe("mine\n");
  });

  it("writes nothing on a dry run", () => {
    const d = repo();
    const j = run(d, ["init", "--dry-run", "--json"]).json();
    expect(j.dry_run).toBe(true);
    expect(j.written).toHaveLength(6);
    expect(existsSync(join(d, ".github"))).toBe(false);
    expect(existsSync(join(d, ".mainfast.yml"))).toBe(false);
  });

  it("does not install a check that another workflow already runs", () => {
    const d = repo();
    mkdirSync(join(d, ".github/workflows"), { recursive: true });
    writeFileSync(join(d, ".github/workflows/own.yml"), "jobs:\n  a:\n    steps:\n      - uses: mainfast/owners@v0\n");
    const j = run(d, ["init", "--checks", "owners", "--json"]).json();
    expect(j.written).toEqual([".mainfast.yml"]);
    expect(j.skipped[0].reason).toMatch(/already installed/);
  });

  it("refuses to write through a symlink out of the repository", () => {
    const d = repo();
    const outside = tmp();
    symlinkSync(outside, join(d, ".github"));
    const r = run(d, ["init", "--checks", "intact", "--json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/symlink/);
    expect(existsSync(join(outside, "workflows"))).toBe(false);
  });

  it("refuses an unknown check, and a directory outside git", () => {
    expect(run(repo(), ["init", "--checks", "nope"]).code).toBe(2);
    expect(run(tmp(), ["init"]).code).toBe(2);
  });
});

describe("doctor", () => {
  it("reports what is missing, then what is installed", () => {
    const d = repo();
    const before = run(d, ["doctor", "--json"]);
    expect(before.code).toBe(1);
    expect(before.json().missing.join(" ")).toMatch(/No check is installed/);
    run(d, ["init", "--checks", "intact,rollcall"]);
    const after = run(d, ["doctor", "--json"]);
    expect(after.code).toBe(0);
    const j = after.json();
    expect(j.checks.intact.installed).toBe(true);
    expect(j.checks.owners.installed).toBe(false);
    expect(j.config.ok).toBe(true);
  });

  it("says a token is set and never prints it", () => {
    const d = repo();
    const secret = ["ghp", "notarealtokenvalue000000000000000000"].join("_");
    const r = run(d, ["doctor", "--json"], { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: secret });
    expect(r.json().token).toEqual({ present: true, source: "GH_TOKEN" });
    expect(r.stdout + r.stderr).not.toContain(secret);
  });

  it("reports a config that does not parse", () => {
    const d = repo();
    run(d, ["init", "--checks", "intact"]);
    writeFileSync(join(d, ".mainfast.yml"), "intakt: {}\n");
    const r = run(d, ["doctor", "--json"]);
    expect(r.code).toBe(1);
    expect(r.json().config.ok).toBe(false);
  });
});

describe("check", () => {
  it("finds a dropped merge: exit 1 with the finding", () => {
    const d = droppedMerge();
    const r = run(d, ["check", "--main", "main", "--json"]);
    expect(r.code, r.stderr).toBe(1);
    const j = r.json();
    expect(j.ok).toBe(false);
    expect(JSON.stringify(j.report)).toContain("app.txt");
    const text = run(d, ["check", "--main", "main"]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("app.txt");
  });

  it("exit 0 on a clean branch, 2 on a bad option or ref", () => {
    const d = repo();
    git(d, "checkout", "-qb", "feature");
    expect(run(d, ["check", "--main", "main", "--json"]).code).toBe(0);
    expect(run(d, ["check", "--nope"]).code).toBe(2);
    const injected = run(d, ["check", "--main=--upload-pack=x", "--json"]);
    expect(injected.code).toBe(2);
    expect(injected.json().ok).toBe(false);
    expect(injected.stderr).not.toBe("");
  });
});

describe("audit", () => {
  it("owners lints offline without a token", () => {
    const d = repo();
    writeFileSync(join(d, "CODEOWNERS"), "/nothing-here/ @someone\n");
    git(d, "add", ".");
    git(d, "commit", "-qm", "owners");
    const r = run(d, ["audit", "owners", "--json"]);
    expect([0, 1]).toContain(r.code);
    const j = r.json();
    expect(j.check).toBe("owners");
    expect(JSON.stringify(j.report)).toContain("nothing-here");
  });

  it("migrations and evidence report on a local branch", () => {
    const d = repo();
    git(d, "checkout", "-qb", "feature");
    expect(run(d, ["audit", "migrations", "--main", "main", "--json"]).json().check).toBe("migrations");
    expect(run(d, ["audit", "evidence", "--main", "main", "--json"]).json().check).toBe("evidence");
  });

  it("rollcall says what it needs when there is no GitHub remote", () => {
    const r = run(repo(), ["audit", "rollcall", "--json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/GitHub origin remote/);
  });

  it("refuses an unknown check", () => {
    expect(run(repo(), ["audit", "nope"]).code).toBe(2);
  });
});

describe("every command", () => {
  it("has --help and exits 0", () => {
    for (const c of ["init", "doctor", "check", "audit", "mcp"]) {
      const r = run(repo(), [c, "--help"]);
      expect(r.code, c).toBe(0);
      expect(r.stdout, c).toMatch(/usage: mainfast/);
    }
  });

  it("does not start a product CLI on its own", () => {
    const r = run(repo(), ["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("mcp", () => {
  it("round trip over stdio: initialize, tools/list, tools/call", async () => {
    const d = droppedMerge();
    const child = spawn(process.execPath, [BIN, "mcp"], { cwd: d, env: CLEAN_ENV, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    const replies = new Map<number, (m: Record<string, any>) => void>();
    const noise: string[] = [];
    child.stdout.on("data", (b: Buffer) => {
      buffer += b.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const m = JSON.parse(line);
          replies.get(m.id)?.(m);
        } catch {
          noise.push(line);
        }
      }
    });
    let id = 0;
    const send = (method: string, params: unknown = {}) =>
      new Promise<Record<string, any>>((resolve) => {
        const n = ++id;
        replies.set(n, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
      });
    try {
      const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(init.result.serverInfo.name).toBe("mainfast");
      expect(init.result.capabilities.tools).toBeDefined();
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

      const tools = (await send("tools/list")).result.tools;
      expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(["audit", "check", "doctor", "init"]);
      const init_ = tools.find((t: { name: string }) => t.name === "init");
      expect(init_.description).toMatch(/WRITES FILES/);
      expect(init_.inputSchema.properties.dry_run).toBeDefined();

      const dry = (await send("tools/call", { name: "init", arguments: { dry_run: true, checks: ["intact"] } })).result;
      expect(dry.isError).toBeFalsy();
      expect(dry.structuredContent.written).toContain(".github/workflows/mainfast-intact.yml");
      expect(existsSync(join(d, ".github"))).toBe(false);

      const check = (await send("tools/call", { name: "check", arguments: { main: "main" } })).result;
      expect(check.isError).toBeFalsy();
      expect(check.structuredContent.ok).toBe(false);
      expect(JSON.stringify(check.structuredContent.report)).toContain("app.txt");
      expect(JSON.parse(check.content[0].text).ok).toBe(false);

      const bad = (await send("tools/call", { name: "audit", arguments: { check: "rollcall" } })).result;
      expect(bad.isError).toBe(true);
      expect(noise).toEqual([]);
    } finally {
      child.kill();
    }
  });
});

describe("the npm package", () => {
  it("carries no local path", () => {
    const bundle = readFileSync(BIN, "utf8");
    expect(bundle).not.toContain(CLI_DIR);
    expect(bundle).not.toMatch(/\/Users\/|\/home\/[a-z]/);
  });

  it("packs to the bundle alone and runs from the tarball with npx", () => {
    const dest = tmp();
    const out = execFileSync("npm", ["pack", "--json", "--pack-destination", dest], { cwd: CLI_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const pack = JSON.parse(out)[0];
    expect(pack.files.map((f: { path: string }) => f.path).sort()).toEqual(["LICENSE", "README.md", "dist/mainfast.cjs", "package.json"]);
    const manifest = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.private).toBeUndefined();
    const d = repo();
    const run_ = spawnSync("npx", ["--yes", "--package", join(dest, pack.filename), "mainfast", "init", "--dry-run", "--json"], { cwd: d, env: { ...CLEAN_ENV, npm_config_cache: tmp() }, encoding: "utf8" });
    expect(run_.status, run_.stderr).toBe(0);
    expect(JSON.parse(run_.stdout).written).toHaveLength(6);
  });
});
