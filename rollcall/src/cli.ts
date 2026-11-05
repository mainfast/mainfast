import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CLI_NAME, PRODUCT, USER_AGENT, VERSION } from './brand.js';
import { audit } from './audit.js';
import { collect } from './collect.js';
import { parseConfig } from './config.js';
import { readLocalWorkflows } from './local.js';
import { toMarkdown, toText } from './report.js';
import { GitHub, splitRepo } from '@mainfast/shared/github';
import type { Snapshot } from './types.js';

const USAGE = `${PRODUCT} ${VERSION}

Usage:
  ${CLI_NAME} audit --github-repo OWNER/NAME [--branch main] [--pulls 20] [--open-pulls 10]
        [--workflows-from DIR] [--config FILE] [--save-snapshot FILE] [--format text|json|md]
  ${CLI_NAME} audit --snapshot FILE [--format ...]     (offline, from a saved snapshot)

Audits required status checks (branch protection + active rulesets) against the
check runs recent merged and open PRs actually reported. Token from --token or
$GITHUB_TOKEN. Workflow files are read from the audited branch through the API
unless --workflows-from points at a checkout. Exit 1 when an error-level finding exists.`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === '--version') return console.log(VERSION), 0;
  if (cmd !== 'audit') {
    console.log(USAGE);
    return cmd === '-h' || cmd === '--help' ? 0 : 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      'github-repo': { type: 'string' },
      branch: { type: 'string' },
      pulls: { type: 'string' },
      'open-pulls': { type: 'string' },
      token: { type: 'string' },
      'workflows-from': { type: 'string' },
      config: { type: 'string' },
      snapshot: { type: 'string' },
      'save-snapshot': { type: 'string' },
      format: { type: 'string', default: 'text' },
    },
  });
  const cfg = parseConfig(values.config ? readFileSync(values.config, 'utf8') : undefined);
  let snap: Snapshot;
  if (values.snapshot) snap = JSON.parse(readFileSync(values.snapshot, 'utf8')) as Snapshot;
  else {
    if (!values['github-repo']) throw new Error('audit needs --github-repo OWNER/NAME or --snapshot FILE');
    const { owner, repo } = splitRepo(values['github-repo']);
    const gh = new GitHub({ token: values.token ?? process.env.GITHUB_TOKEN, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
    snap = await collect({
      gh,
      owner,
      repo,
      branch: values.branch ?? cfg.branch,
      pulls: values.pulls ? Number(values.pulls) : cfg.pulls,
      openPulls: values['open-pulls'] ? Number(values['open-pulls']) : cfg.openPulls,
      workflows: values['workflows-from'] ? readLocalWorkflows(values['workflows-from']) : undefined,
    });
    if (values['save-snapshot']) writeFileSync(values['save-snapshot'], JSON.stringify(snap, null, 2));
  }
  const report = audit(snap, { ignore: cfg.ignore, stoppedAfter: cfg.stoppedAfter });
  console.log(values.format === 'json' ? JSON.stringify(report, null, 2) : values.format === 'md' ? toMarkdown(report) : toText(report));
  return report.ok ? 0 : 1;
}

if (/cli\.(c?js|ts)$/.test(process.argv[1] ?? '')) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`${PRODUCT}: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    },
  );
}
