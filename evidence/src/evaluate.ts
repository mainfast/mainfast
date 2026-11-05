// One PR snapshot + policy -> one evidence report. Pure: no I/O.
import type { EvidencePolicy } from "./config.ts";
import { evaluateChecks, type ChecksEval } from "./analyze/checks.ts";
import { evaluateClaims, type Claim } from "./analyze/claims.ts";
import { evaluateCoverage, type CoverageEval } from "./analyze/coverage.ts";
import type { Finding } from "./analyze/finding.ts";
import { detectProvenance, type Provenance } from "./analyze/provenance.ts";
import { scanSecrets, type SecretHit } from "./analyze/secrets.ts";
import { evaluateSize, type SizeEval } from "./analyze/size.ts";
import { evaluateTamper, type TamperEval } from "./analyze/tamper.ts";
import type { Flag, PrSnapshot } from "./types.ts";

export type Conclusion = "success" | "failure" | "neutral" | "pending";

export interface EvidenceReport {
  repo: string;
  pr: PrSnapshot["pr"];
  applies: boolean;
  appliesReason: string;
  provenance: Provenance;
  checks: ChecksEval;
  tamper: TamperEval;
  coverage: CoverageEval;
  claims: Claim[];
  size: SizeEval;
  secrets: SecretHit[];
  /** Findings that policy kept, with their severity. Ordered: fail first. */
  flags: Flag[];
  conclusion: Conclusion;
  policyWarnings: string[];
}

export function evaluate(snap: PrSnapshot, policy: EvidencePolicy, policyWarnings: string[] = []): EvidenceReport {
  const provenance = detectProvenance(snap, policy.agents);
  const applies = policy.applyTo === "all" || provenance.isAgent;
  const appliesReason =
    policy.applyTo === "all" ? "policy applies to every PR" : provenance.isAgent ? `agent PR (${provenance.agents.join(", ")})` : "no agent signal found";

  const checks = evaluateChecks(snap, policy);
  const tamper = evaluateTamper(snap.files, policy);
  const coverage = evaluateCoverage(snap.files, snap.coverage, policy, snap.coverageUnavailable);
  const { claims, findings: claimFindings } = evaluateClaims(snap.pr.title, snap.pr.body, tamper, checks);
  const size = evaluateSize(snap.files, policy);
  const secrets = scanSecrets(snap.files, policy);

  const findings: Finding[] = [...checks.findings, ...tamper.findings, ...coverage.findings, ...claimFindings, ...size.findings, ...secrets.findings];
  const flags: Flag[] = [];
  if (applies)
    for (const f of findings) {
      const sev = policy.flags[f.id];
      if (sev === "off") continue;
      flags.push({ ...f, severity: sev });
    }
  flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1));

  let conclusion: Conclusion = "success";
  if (applies) {
    if (flags.some((f) => f.severity === "fail")) conclusion = "failure";
    else if (checks.pending) conclusion = "pending";
    else if (flags.length) conclusion = policy.warnConclusion;
  }
  return {
    repo: snap.repo,
    pr: snap.pr,
    applies,
    appliesReason,
    provenance,
    checks,
    tamper,
    coverage,
    claims,
    size,
    secrets: secrets.hits,
    flags,
    conclusion,
    policyWarnings,
  };
}
