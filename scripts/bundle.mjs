// One esbuild setup for every package. Bundle names are the same across the suite:
//   dist/index.cjs  the GitHub Action (action.yml runs.main)
//   dist/cli.cjs    the CLI (package.json bin)
//   dist/lib.cjs    the library (package.json main)
// Each is a self-contained CommonJS file (the Action runs with no npm install on the runner),
// with @mainfast/shared and brand.json inlined.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

const common = { bundle: true, platform: "node", target: "node20", format: "cjs", sourcemap: false, legalComments: "none", logLevel: "info" };

/**
 * @param {{ action?: string, cli?: string, lib?: string, actionDefine?: Record<string, string> }} [entries]
 */
export async function bundle(entries = {}) {
  const action = entries.action ?? "src/action.ts";
  const cli = entries.cli ?? "src/cli.ts";
  const lib = entries.lib ?? "src/index.ts";
  await build({ ...common, entryPoints: [action], outfile: "dist/index.cjs", define: entries.actionDefine });
  await build({ ...common, entryPoints: [cli], outfile: "dist/cli.cjs", banner: { js: "#!/usr/bin/env node" } });
  chmodSync("dist/cli.cjs", 0o755);
  await build({ ...common, entryPoints: [lib], outfile: "dist/lib.cjs" });
}
