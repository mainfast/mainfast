// Library surface.
export * from "./constants.ts";
export * from "./types.ts";
export { parsePolicy, defaultPolicy, DEFAULT_FLAGS, DEFAULT_PATHS, nameMatcher, type EvidencePolicy, type AgentMatchers } from "./config.ts";
export { evaluate, type EvidenceReport, type Conclusion } from "./evaluate.ts";
export { renderCard, checkRunPayload } from "./render.ts";
export { detectProvenance, parseGitAiNote, AGENT_CATALOG } from "./analyze/provenance.ts";
export { evaluateChecks } from "./analyze/checks.ts";
export { evaluateTamper, analyzeTestFile, LANG_RULES } from "./analyze/tamper.ts";
export { parseLcov, parseCobertura, parseCoverage, evaluateCoverage } from "./analyze/coverage.ts";
export { extractClaims, evaluateClaims } from "./analyze/claims.ts";
export { scanSecrets, SECRET_RULES } from "./analyze/secrets.ts";
export { evaluateSize } from "./analyze/size.ts";
export { parseGitDiff, parseHunks } from "./diff/patch.ts";
export { RestClient, GitHubError, type GitHubApi } from "./github/api.ts";
export { collectSnapshot, fetchRequired, fetchPolicyText } from "./github/collect.ts";
export { publish } from "./github/publish.ts";
export { mockFetch } from "./github/mockFetch.ts";
export { localSnapshot, localPolicyText, enrichFromLocal, loadCoverage } from "./local.ts";
