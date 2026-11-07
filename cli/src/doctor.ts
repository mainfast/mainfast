// `doctor`: what is installed in this repository and what is missing. Reads only; the token's value
// is never read out, only whether one is set.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigDoc } from "@mainfast/shared/config";
import { PRODUCT_SLUGS, SUITE } from "@mainfast/shared/brand";
import { githubRepo, githubToken, repoRoot, SCHEMA, type Result } from "./common.ts";
import { hostedAppUrl, installedIn } from "./init.ts";

export function runDoctor(dir: string): Result {
  const root = repoRoot(dir);
  const checks = Object.fromEntries(PRODUCT_SLUGS.map((s) => { const files = installedIn(root, s); return [s, { installed: files.length > 0, files }]; }));
  const installed = PRODUCT_SLUGS.filter((s) => checks[s]!.installed);
  const missing: string[] = [];

  const path = [SUITE.configFile, SUITE.configFileAlt].find((f) => existsSync(join(root, f)));
  let config: { path: string | null; ok: boolean; error?: string } = { path: path ?? null, ok: true };
  if (path) {
    try {
      parseConfigDoc(readFileSync(join(root, path), "utf8"), path);
    } catch (e) {
      config = { path, ok: false, error: e instanceof Error ? e.message : String(e) };
      missing.push(`${path} does not parse: ${config.error}`);
    }
  }
  const token = githubToken();
  const repo = githubRepo(root) ?? null;
  const codeowners = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].find((f) => existsSync(join(root, f))) ?? null;

  if (!installed.length) missing.push("No check is installed. Run: mainfast init");
  if (!repo) missing.push("No GitHub origin remote, so audit cannot read the repository through the API.");
  if (!token) missing.push("No GITHUB_TOKEN or GH_TOKEN: audit rollcall needs one for private repositories, audit owners falls back to offline lint.");
  if (installed.includes("owners") && !codeowners) missing.push("Owners is installed but there is no CODEOWNERS file.");

  const ok = config.ok && installed.length > 0;
  const json = { schema: SCHEMA, command: "doctor", ok, repo: root, github_repo: repo, checks, config, codeowners, token: { present: Boolean(token), source: token?.name ?? null }, missing, hosted_app: hostedAppUrl() };
  const lines = [
    ...PRODUCT_SLUGS.map((s) => `${checks[s]!.installed ? "installed" : "missing  "}  ${s}${checks[s]!.installed ? `  (${checks[s]!.files.join(", ")})` : ""}`),
    `config     ${path ? (config.ok ? `${path} parses` : `${path} does not parse`) : "none, defaults apply"}`,
    `token      ${token ? `set (${token.name})` : "not set"}`,
    ...(missing.length ? ["", "To do:", ...missing.map((m) => `- ${m}`)] : []),
  ];
  return { exitCode: ok ? 0 : 1, json, text: lines.join("\n") };
}
