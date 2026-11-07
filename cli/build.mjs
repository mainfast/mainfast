// Bundles the one file npm ships: dist/mainfast.cjs, CLI and MCP server, no runtime dependencies.
// Workflow templates come from each check's examples/ through `?raw` imports.
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const raw = {
  name: "raw",
  setup(b) {
    // A relative path: esbuild writes it into the bundle as a comment, and local paths must not ship.
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: relative(process.cwd(), resolve(dirname(a.importer), a.path.slice(0, -4))), namespace: "raw" }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, (a) => ({ contents: readFileSync(resolve(a.path), "utf8"), loader: "text" }));
  },
};

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/mainfast.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  legalComments: "none",
  plugins: [raw],
  // Evidence runs itself when require.main is its module, which is true of any bundle.
  define: { "require.main": "undefined" },
  banner: { js: "#!/usr/bin/env node" },
});
chmodSync("dist/mainfast.cjs", 0o755);
