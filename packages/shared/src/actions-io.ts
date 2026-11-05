// Just enough of the GitHub Actions runtime protocol (inputs, outputs, job summary,
// annotations) to avoid a dependency on @actions/core. Every function takes an optional
// env so callers that inject one (Evidence's tests) do not have to touch process.env.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

export type Env = Record<string, string | undefined>;

export function getInput(name: string, fallback = "", env: Env = process.env): string {
  const v = env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

export function getBooleanInput(name: string, fallback: boolean, env: Env = process.env): boolean {
  const v = getInput(name, "", env).toLowerCase();
  if (v === "") return fallback;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  if (["false", "no", "0", "off"].includes(v)) return false;
  throw new Error(`input ${name}: expected a boolean, got "${v}"`);
}

export function setOutput(name: string, value: string, env: Env = process.env): void {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `ghadelim_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

/** Parses the `name<<delim ... delim` blocks of a GITHUB_OUTPUT file (tests). */
export function parseOutputs(text: string): Record<string, string> {
  const res: Record<string, string> = {};
  const re = /^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2$/gm;
  for (const m of text.matchAll(re)) res[m[1]!] = m[3]!;
  return res;
}

export function appendSummary(markdown: string, env: Env = process.env): void {
  const file = env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}

export function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
export function escapeProp(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export interface AnnotationProps {
  file?: string;
  line?: number;
  endLine?: number;
  title?: string;
}

/** `annotate(level, message, file?, title?)` or `annotate(level, message, { file, line, endLine, title })`. */
export function annotate(level: "error" | "warning" | "notice", message: string, file?: string | AnnotationProps, title?: string): void {
  const p: AnnotationProps = typeof file === "object" ? file : { file, title };
  const props: string[] = [];
  if (p.file) props.push(`file=${escapeProp(p.file)}`);
  if (p.line !== undefined) props.push(`line=${p.line}`);
  if (p.endLine !== undefined) props.push(`endLine=${p.endLine}`);
  if (p.title) props.push(`title=${escapeProp(p.title)}`);
  process.stdout.write(`::${level}${props.length ? " " + props.join(",") : ""}::${escapeData(message)}\n`);
}

export function setFailed(message: string): void {
  annotate("error", message);
  process.exitCode = 1;
}

export interface ActionContext {
  eventName: string;
  repository: string;
  event: Record<string, any>;
  serverUrl: string;
  runUrl?: string;
}

export function readContext(env: Env = process.env): ActionContext {
  const path = env.GITHUB_EVENT_PATH;
  const event = path ? JSON.parse(readFileSync(path, "utf8")) : {};
  const serverUrl = env.GITHUB_SERVER_URL ?? "https://github.com";
  const repository = env.GITHUB_REPOSITORY ?? "";
  const runId = env.GITHUB_RUN_ID;
  return {
    eventName: env.GITHUB_EVENT_NAME ?? "",
    repository,
    event,
    serverUrl,
    runUrl: runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : undefined,
  };
}
