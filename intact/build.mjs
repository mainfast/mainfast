// Bundles dist/index.cjs (Action), dist/cli.cjs and dist/lib.cjs; see ../scripts/bundle.mjs.
import { bundle } from "../scripts/bundle.mjs";

await bundle({ cli: "src/bin.ts", actionDefine: { __ACTION_ENTRY__: "true" } });
