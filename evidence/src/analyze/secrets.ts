// Secret-shaped strings in added lines. Not a replacement for push protection: a cheap last look,
// because agents paste tokens from their environment into fixtures and configs.
import type { EvidencePolicy } from "../config.ts";
import { matchesAny } from "@mainfast/shared/glob";
import { addedLines } from "../diff/patch.ts";
import type { FileChange } from "../types.ts";
import type { Finding } from "./finding.ts";

interface SecretRule {
  id: string;
  name: string;
  re: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  { id: "aws-access-key", name: "AWS access key id", re: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/ },
  { id: "github-token", name: "GitHub token", re: /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/ },
  { id: "anthropic-key", name: "Anthropic API key", re: /\b(sk-ant-[A-Za-z0-9_-]{20,})/ },
  { id: "openai-key", name: "OpenAI API key", re: /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})/ },
  { id: "slack-token", name: "Slack token", re: /\b(xox[abposr]-[A-Za-z0-9-]{10,})/ },
  { id: "slack-webhook", name: "Slack webhook", re: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,})/ },
  { id: "stripe-key", name: "Stripe live key", re: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})/ },
  { id: "google-api-key", name: "Google API key", re: /\b(AIza[0-9A-Za-z_-]{35})\b/ },
  { id: "npm-token", name: "npm token", re: /\b(npm_[A-Za-z0-9]{36})\b/ },
  { id: "private-key", name: "Private key block", re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/ },
  { id: "jwt", name: "JSON Web Token", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/ },
  {
    id: "generic-assignment",
    name: "Hard-coded credential",
    re: /(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{20,})["']/i,
  },
];

const PLACEHOLDER = /^(?:x+|\*+|0+|your[_-]|example|placeholder|changeme|dummy|fake|test|<|\$\{|\{\{)/i;

function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

export function redact(s: string): string {
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`;
}

export interface SecretHit {
  path: string;
  line: number;
  rule: string;
  redacted: string;
}

export function scanSecrets(files: FileChange[], policy: EvidencePolicy): { hits: SecretHit[]; findings: Finding[] } {
  const allow = policy.secrets.allow.flatMap((a) => {
    try {
      return [new RegExp(a)];
    } catch {
      return []; // reported by parsePolicy
    }
  });
  const hits: SecretHit[] = [];
  for (const f of files) {
    if (f.status === "removed" || matchesAny(f.path, policy.paths.lockfiles)) continue;
    for (const l of addedLines(f)) {
      for (const rule of SECRET_RULES) {
        const m = rule.re.exec(l.text);
        if (!m) continue;
        const value = m[1] ?? m[0];
        // Allow patterns are tested against the extracted value only, never the whole line: otherwise
        // an allowlisted marker anywhere on the line (a `// example` comment) would hide a real key.
        if (allow.some((a) => a.test(value))) continue;
        if (rule.id === "generic-assignment" && (PLACEHOLDER.test(value) || entropy(value) < 3.5)) continue;
        hits.push({ path: f.path, line: l.line, rule: rule.name, redacted: rule.id === "private-key" ? value : redact(value) });
        break; // one hit per line is enough
      }
    }
  }
  const findings: Finding[] = hits.length
    ? [
        {
          id: "secret_like_string",
          title: "Secret-like strings added",
          detail: hits.map((h) => `\`${h.path}:${h.line}\` ${h.rule} ${h.redacted}`).join("\n"),
          locations: hits.map((h) => ({ path: h.path, line: h.line, message: `${h.rule} (${h.redacted}). Rotate it if real.` })),
        },
      ]
    : [];
  return { hits, findings };
}
