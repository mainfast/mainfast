import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { OwnersApi } from './api.js';
import { auditOwners } from './audit.js';
import { CLI_NAME, PRODUCT, USER_AGENT, VERSION } from './brand.js';
import { parseConfig, wholeNumber } from './config.js';
import { isTrustedPr, loadAudit, loadConfigFromRepo, loadPr, localCodeowners, localFiles } from './load.js';
import { publishComment } from './publish.js';
import { toMarkdown, toText } from './report.js';
import { GitHub, resolveCommentAuthor, splitRepo } from '@mainfast/shared/github';

const USAGE = `${PRODUCT} ${VERSION}

Usage:
  ${CLI_NAME} lint  [--repo DIR]                                   offline: syntax, dead patterns, unowned files
  ${CLI_NAME} audit --github-repo OWNER/NAME [--ref REF] [--dormant-days N]
  ${CLI_NAME} pr    --github-repo OWNER/NAME --pr N [--comment] [--comment-author LOGIN]
Common: [--format text|json|md] [--config FILE] [--token TOKEN] [--org-token TOKEN]

lint needs no token. audit and pr read CODEOWNERS, .mainfast.yml and the tree through the API
(audit: the default branch or --ref; pr: the PR's base branch, plus the PR's own CODEOWNERS when
it edits one) and ask whether each owner exists and has write access. Org membership and teams
are checked with --org-token (default: the token itself; needs Organization > Members: read).
audit also checks dormancy (owners.dormantDays, default 180). Token: --token, else $GITHUB_TOKEN
or $GH_TOKEN. Exit 1 when an error-level finding exists.`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === '--version') return console.log(VERSION), 0;
  if (!cmd || !['lint', 'audit', 'pr'].includes(cmd)) {
    console.log(USAGE);
    return cmd === '-h' || cmd === '--help' ? 0 : 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      repo: { type: 'string' },
      'github-repo': { type: 'string' },
      ref: { type: 'string' },
      pr: { type: 'string' },
      config: { type: 'string' },
      token: { type: 'string' },
      'org-token': { type: 'string' },
      'dormant-days': { type: 'string' },
      comment: { type: 'boolean', default: false },
      'comment-author': { type: 'string' },
      format: { type: 'string', default: 'text' },
    },
  });
  if (!['text', 'json', 'md'].includes(values.format!)) throw new Error('--format: expected text, json or md');
  let config = values.config ? parseConfig(readFileSync(values.config, 'utf8')) : undefined;
  let report;
  if (cmd === 'lint') {
    const dir = values.repo ?? '.';
    report = await auditOwners({ repository: dir, files: localFiles(dir), codeowners: localCodeowners(dir), config: config ?? parseConfig(undefined) });
  } else {
    if (!values['github-repo']) throw new Error(`${cmd} needs --github-repo OWNER/NAME`);
    const { owner, repo } = splitRepo(values['github-repo']);
    const token = values.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const gh = new GitHub({ token, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
    const orgToken = values['org-token'] ?? token;
    const org = orgToken ? new GitHub({ token: orgToken, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL }) : undefined;
    const probe = new OwnersApi(gh, owner, repo);
    let loadedPr: Awaited<ReturnType<typeof probe.pull>> | undefined;
    if (cmd === 'pr') {
      const n = Number(values.pr);
      if (!Number.isInteger(n) || n <= 0) throw new Error('pr needs --pr N');
      loadedPr = await probe.pull(n);
    }
    const baseRef = loadedPr ? loadedPr.base.ref : (values.ref ?? (await probe.defaultBranch()));
    config ??= (await loadConfigFromRepo(gh, owner, repo, baseRef)).cfg;
    if (values['dormant-days']) config.dormantDays = wholeNumber('--dormant-days', values['dormant-days'], 0, 3650);
    const api = new OwnersApi(gh, owner, repo, { org, maxSearches: config.maxSearches });
    const loaded = loadedPr ? await loadPr(api, { number: loadedPr.number, baseRef, headSha: loadedPr.head.sha, trusted: isTrustedPr(loadedPr) }) : await loadAudit(api, baseRef);
    report = await auditOwners({ repository: `${owner}/${repo}`, ...loaded, api, config });
    if (cmd === 'pr' && values.comment) await publishComment(gh, owner, repo, report, await resolveCommentAuthor(gh, values['comment-author']));
  }
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
