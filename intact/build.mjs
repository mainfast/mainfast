// Bundles dist/index.cjs (Action), dist/cli.cjs and dist/lib.cjs; see ../scripts/bundle.mjs.
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { bundle } from "../scripts/bundle.mjs";

await bundle({ cli: "src/bin.ts", actionDefine: { __ACTION_ENTRY__: "true" } });

// The Claude Code plugin ships its own copy so it works without a global install. It lives in
// plugin/scripts/, not plugin/bin/: claude.ai org sync rejects plugins with a top-level bin/.
mkdirSync("plugin/scripts", { recursive: true });
copyFileSync("dist/cli.cjs", "plugin/scripts/mainfast.cjs");
chmodSync("plugin/scripts/mainfast.cjs", 0o755);
