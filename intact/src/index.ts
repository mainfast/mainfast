// Library entry point.
export { analyzeMerge, judgeHunk, markerRegions } from "./analyze.ts";
export { autoMergeDiff, pickStrategy, type Strategy } from "./automerge.ts";
export { BRAND } from "./brand.ts";
export { exitCodeFor, listMerges, resolveMainRef, runCheck, type CheckOptions } from "./check.ts";
export { loadConfig, parseConfig, globToRegExp, type Config, type Level } from "./config.ts";
export { parseDiff } from "./diff.ts";
export { Git } from "./git.ts";
export { formatHuman, formatMarkdown } from "./report.ts";
export type * from "./types.ts";
