// Who wrote this PR? Signals from PR author, commit authors, trailers, branch prefix, labels,
// PR body footers and git-ai authorship notes (Git AI Standard v3.0.0, refs/notes/ai).
import type { AgentMatchers } from "../config.ts";
import type { PrSnapshot } from "../types.ts";

export interface AgentDef {
  id: string;
  name: string;
  logins: string[];
  branchPrefixes: string[];
  trailers: RegExp[];
  emails: RegExp[];
  bodyMarkers: RegExp[];
}

/**
 * Built-in catalog. Logins are compared case-insensitively. Checked against public docs and public
 * GitHub PRs on 28 Oct 2026; signals marked UNVERIFIED are best guesses that no public source
 * confirmed (the README's agent table lists the source of each verified one). A wrong guess costs
 * nothing but a missed detection: no signal here ever loosens the gate.
 */
export const AGENT_CATALOG: AgentDef[] = [
  {
    // Verified: claude[bot] and the claude/ prefix are the defaults of anthropics/claude-code-action
    // (action.yml `bot_name`, `branch_prefix`); the trailer, email and body footer are Claude Code's
    // default commit / PR attribution.
    id: "claude-code",
    name: "Claude Code",
    logins: ["claude[bot]"],
    branchPrefixes: ["claude/"],
    trailers: [/^co-authored-by:\s*claude\b/im],
    emails: [/^noreply@anthropic\.com$/i],
    bodyMarkers: [/generated with \[claude code\]/i],
  },
  {
    // Verified: the coding agent authors its commits as Copilot (human = co-author) with an
    // Agent-Logs-Url trailer (GitHub changelog 2026-03-20) and works on copilot/ branches; the
    // assignable actor is copilot-swe-agent (Microsoft Learn). UNVERIFIED: the `[bot]` login form.
    id: "copilot",
    name: "GitHub Copilot coding agent",
    logins: ["copilot", "copilot-swe-agent[bot]", "copilot-swe-agent"],
    branchPrefixes: ["copilot/"],
    trailers: [/^co-authored-by:\s*copilot\s*<\d+\+copilot@users\.noreply\.github\.com>/im, /^agent-logs-url:\s*https:\/\//im],
    emails: [/^\d+\+copilot@users\.noreply\.github\.com$/i],
    bodyMarkers: [],
  },
  {
    // Verified: VS Code's Git extension adds this trailer when Copilot chat/agent contributed
    // (`git.addAICoAuthor`, heise 2026). Users report it on commits Copilot did not touch.
    id: "copilot-vscode",
    name: "GitHub Copilot in VS Code",
    logins: [],
    branchPrefixes: [],
    trailers: [/^co-authored-by:\s*copilot\s*<copilot@github\.com>/im],
    emails: [],
    bodyMarkers: [],
  },
  {
    // Verified: chatgpt-codex-connector[bot] is the Codex GitHub app's identity (it posts Codex
    // reviews). UNVERIFIED: that it ever authors a PR or commit, the codex/ branch prefix, the
    // trailer and the task link in the PR body.
    id: "codex",
    name: "OpenAI Codex",
    logins: ["chatgpt-codex-connector[bot]"],
    branchPrefixes: ["codex/"],
    trailers: [/^co-authored-by:\s*(openai\s+)?codex\b/im],
    emails: [],
    bodyMarkers: [/chatgpt\.com\/codex\/tasks\//i],
  },
  {
    // Verified: `Co-authored-by: Cursor <cursoragent@cursor.com>` on agent commits (Cursor forum,
    // staff reply), the "Made with Cursor" attribution on Agent commits and PRs (cursor.com docs),
    // cursor/ branches for background agents (Cursor forum). UNVERIFIED: cursor[bot] as a PR author
    // (it is the Bugbot reviewer's login).
    id: "cursor",
    name: "Cursor agent",
    logins: ["cursor[bot]"],
    branchPrefixes: ["cursor/"],
    trailers: [/^co-authored-by:\s*cursor(\s+agent)?\b/im, /^made[- ]with:?\s+cursor\b/im],
    emails: [/^cursoragent@cursor\.com$/i],
    bodyMarkers: [/\bmade with \[?cursor\b/i],
  },
  {
    // Verified: devin/<timestamp>-<slug> branches and "Link to Devin run: https://…devin.ai/sessions/…"
    // in the PR body (public Devin PRs, e.g. colinhacks/zod#3893); the GitHub app is "Devin.ai
    // Integration" (docs.devin.ai) and its account devin-ai-integration opens PRs (public
    // contributor listings). UNVERIFIED: the noreply email and the co-author trailer's exact form
    // (docs.devin.ai only says a "Co-authored (Devin + you)" mode exists).
    id: "devin",
    name: "Devin",
    logins: ["devin-ai-integration[bot]"],
    branchPrefixes: ["devin/"],
    trailers: [/^co-authored-by:\s*devin\b/im],
    emails: [/devin-ai-integration\[bot\]@users\.noreply\.github\.com$/i],
    bodyMarkers: [/\b(?:app|preview)\.devin\.ai\/sessions\//i, /\blink to devin run\b/i],
  },
  {
    id: "dawnpatch",
    name: "Dawnpatch",
    logins: ["dawnpatch[bot]"],
    branchPrefixes: ["dawnpatch/"],
    trailers: [/^co-authored-by:\s*dawnpatch\b/im],
    emails: [],
    bodyMarkers: [],
  },
  {
    // UNVERIFIED (from memory, not re-checked in this pass).
    id: "aider",
    name: "Aider",
    logins: [],
    branchPrefixes: ["aider/"],
    trailers: [/^co-authored-by:\s*aider\b/im, /^aider:\s/im],
    emails: [],
    bodyMarkers: [],
  },
];

export const DEFAULT_AGENT_LABELS = ["ai-generated", "agent-pr", "coding-agent"];

export interface ProvenanceSignal {
  agent: string; // catalog id, "custom", or the git-ai tool name
  source: "pr_author" | "commit_author" | "trailer" | "email" | "branch" | "label" | "pr_body" | "git_ai";
  detail: string;
}

export interface GitAiSummary {
  commit: string;
  tools: Array<{ tool: string; model?: string }>;
  /** Lines attributed to AI sessions/prompts in this commit, per file. */
  aiLines: number;
  files: string[];
  schemaVersion?: string;
}

export interface Provenance {
  isAgent: boolean;
  agents: string[]; // distinct agent names
  signals: ProvenanceSignal[];
  gitAi: GitAiSummary[];
  /** Commits that carry no agent signal of their own (human commits mixed into an agent PR). */
  humanCommits: string[];
}

function lc(s: string | undefined): string {
  return (s ?? "").toLowerCase();
}

function displayName(id: string): string {
  return AGENT_CATALOG.find((a) => a.id === id)?.name ?? id;
}

/** Count lines in a git-ai range list like `1-4,9-10,12`. */
function countRanges(spec: string): number {
  let n = 0;
  for (const part of spec.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    n += m[2] ? Number(m[2]) - Number(m[1]) + 1 : 1;
  }
  return n;
}

/**
 * Parse a git-ai Authorship Log: attestation section, a line that is exactly `---`, then JSON
 * metadata (`schema_version`, `base_commit_sha`, `prompts`, optional `sessions`, `humans`).
 * Attestation lines: a file path (quoted when it contains whitespace), then indented
 * `<key> <ranges>` lines. Keys: `s_<14hex>::t_<14hex>` (session), `h_...` (human), bare 16-hex
 * (legacy prompt). Human keys do not count as AI lines.
 */
export function parseGitAiNote(commit: string, note: string): GitAiSummary | undefined {
  const lines = note.replace(/\r\n/g, "\n").split("\n");
  const div = lines.findIndex((l) => l === "---");
  if (div < 0) return undefined;
  const files = new Set<string>();
  let aiLines = 0;
  let current: string | undefined;
  for (const l of lines.slice(0, div)) {
    if (!l.trim()) continue;
    if (/^\s/.test(l)) {
      const m = /^\s+(\S+)\s+(\S+)\s*$/.exec(l);
      if (!m || !current) continue;
      if (m[1]!.startsWith("h_")) continue;
      aiLines += countRanges(m[2]!);
      files.add(current);
    } else {
      current = l.startsWith('"') && l.endsWith('"') ? l.slice(1, -1) : l.trim();
    }
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(lines.slice(div + 1).join("\n")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const tools: Array<{ tool: string; model?: string }> = [];
  const seen = new Set<string>();
  for (const group of [meta.prompts, meta.sessions]) {
    if (!group || typeof group !== "object") continue;
    for (const rec of Object.values(group as Record<string, unknown>)) {
      const agentId = (rec as { agent_id?: { tool?: unknown; model?: unknown } })?.agent_id;
      if (!agentId || typeof agentId.tool !== "string") continue;
      const model = typeof agentId.model === "string" ? agentId.model : undefined;
      const key = `${agentId.tool}|${model ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push({ tool: agentId.tool, model });
    }
  }
  if (tools.length === 0 && aiLines === 0) return undefined;
  return {
    commit,
    tools,
    aiLines,
    files: [...files],
    schemaVersion: typeof meta.schema_version === "string" ? meta.schema_version : undefined,
  };
}

const GIT_AI_TOOL_TO_AGENT: Record<string, string> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  claude_code: "claude-code",
  cursor: "cursor",
  codex: "codex",
  copilot: "copilot",
  "github-copilot": "copilot",
  devin: "devin",
  aider: "aider",
};

export function detectProvenance(snap: PrSnapshot, m: AgentMatchers): Provenance {
  const catalog = m.useDefaults ? AGENT_CATALOG : [];
  const labels = [...(m.useDefaults ? DEFAULT_AGENT_LABELS : []), ...m.labels].map(lc);
  const signals: ProvenanceSignal[] = [];
  const add = (s: ProvenanceSignal) => {
    if (!signals.some((x) => x.agent === s.agent && x.source === s.source && x.detail === s.detail)) signals.push(s);
  };
  const customAuthors = m.authors.map(lc);
  const loginAgent = (login: string | undefined): string | undefined => {
    const l = lc(login);
    if (!l) return undefined;
    const hit = catalog.find((a) => a.logins.includes(l));
    if (hit) return hit.id;
    if (customAuthors.includes(l)) return "custom";
    return undefined;
  };

  const { pr } = snap;
  const prAgent = loginAgent(pr.authorLogin);
  if (prAgent) add({ agent: prAgent, source: "pr_author", detail: `PR opened by @${pr.authorLogin}` });

  for (const a of catalog)
    for (const pre of a.branchPrefixes)
      if (pr.headRef.toLowerCase().startsWith(pre)) add({ agent: a.id, source: "branch", detail: `branch ${pr.headRef}` });
  for (const pre of m.branchPrefixes)
    if (pr.headRef.startsWith(pre)) add({ agent: "custom", source: "branch", detail: `branch ${pr.headRef}` });

  for (const l of pr.labels) if (labels.includes(lc(l))) add({ agent: "custom", source: "label", detail: `label "${l}"` });

  for (const a of catalog)
    for (const re of a.bodyMarkers) {
      const hit = re.exec(pr.body);
      if (hit) add({ agent: a.id, source: "pr_body", detail: `PR body contains "${hit[0]}"` });
    }

  const customTrailers = m.trailers.map((t) => new RegExp(t, "im"));
  const customEmails = m.emails.map(lc);
  const humanCommits: string[] = [];
  for (const c of snap.commits) {
    const before = signals.length;
    const short = c.sha.slice(0, 7);
    const ca = loginAgent(c.authorLogin);
    if (ca) add({ agent: ca, source: "commit_author", detail: `${short} authored by @${c.authorLogin}` });
    for (const a of catalog) {
      for (const re of a.trailers) {
        const hit = re.exec(c.message);
        if (hit) add({ agent: a.id, source: "trailer", detail: `${short}: ${c.message.split("\n").find((l) => re.test(l))?.trim() ?? hit[0]}` });
      }
      for (const re of a.emails)
        for (const e of [c.authorEmail, c.committerEmail])
          if (e && re.test(e)) add({ agent: a.id, source: "email", detail: `${short} ${e}` });
    }
    for (const re of customTrailers) {
      const line = c.message.split("\n").find((l) => re.test(l));
      if (line !== undefined || re.test(c.message)) add({ agent: "custom", source: "trailer", detail: `${short}: ${(line ?? "").trim()}` });
    }
    for (const e of [c.authorEmail, c.committerEmail])
      if (e && customEmails.includes(lc(e))) add({ agent: "custom", source: "email", detail: `${short} ${e}` });
    const note = snap.gitAiNotes?.[c.sha];
    if (note) {
      const s = parseGitAiNote(c.sha, note);
      if (s) {
        for (const t of s.tools.length ? s.tools : [{ tool: "unknown" }]) {
          add({
            agent: GIT_AI_TOOL_TO_AGENT[lc(t.tool)] ?? t.tool,
            source: "git_ai",
            detail: `${short}: git-ai note, ${s.aiLines} AI line(s)${"model" in t && t.model ? `, ${t.model}` : ""}`,
          });
        }
      }
    }
    if (signals.length === before && !signals.some((s) => s.detail.startsWith(short))) humanCommits.push(c.sha);
  }

  const gitAi = snap.commits
    .map((c) => (snap.gitAiNotes?.[c.sha] ? parseGitAiNote(c.sha, snap.gitAiNotes[c.sha]!) : undefined))
    .filter((x): x is GitAiSummary => !!x);
  const agents = [...new Set(signals.map((s) => (s.agent === "custom" ? "custom agent (policy)" : displayName(s.agent))))];
  return { isAgent: signals.length > 0, agents, signals, gitAi, humanCommits: signals.length ? humanCommits : [] };
}
