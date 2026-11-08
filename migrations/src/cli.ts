import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CLI_NAME, PRODUCT, STATUS_CONTEXT, USER_AGENT, VERSION } from './brand.js';
import { parseConfig } from './config.js';
import { analyze } from './engine.js';
import { recheckMarkdown, recheckOpenPrs } from './recheck.js';
import { toMarkdown, toText } from './report.js';
import { GitHub, splitRepo } from '@mainfast/shared/github';

const USAGE = `${PRODUCT} ${VERSION}

Usage:
  ${CLI_NAME} check   [--repo DIR] [--main REF] [--head REF] [--config FILE] [--format text|json|md]
  ${CLI_NAME} recheck --github-repo OWNER/NAME [--repo DIR] [--main-branch main]
  ${' '.repeat(CLI_NAME.length)}         [--token TOKEN] [--no-comment] [--no-status] [--label NAME] [--max-prs N]

check    compares the migrations of --head (default HEAD) merged into --main
         (default origin/main). Exit 1 when the merge would break the migration history.
recheck  lists open PRs via the GitHub API (GITHUB_TOKEN), fetches each head, comments on
         and labels the ones that went stale, and sets the ${STATUS_CONTEXT} commit status on
         every head (failure when stale, success when clean; --no-status skips it).
         Token from --token or $GITHUB_TOKEN.`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    return cmd ? 0 : 2;
  }
  if (cmd === '--version') {
    console.log(VERSION);
    return 0;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      repo: { type: 'string', default: '.' },
      main: { type: 'string', default: 'origin/main' },
      head: { type: 'string', default: 'HEAD' },
      config: { type: 'string' },
      format: { type: 'string', default: 'text' },
      'github-repo': { type: 'string' },
      'main-branch': { type: 'string', default: 'main' },
      token: { type: 'string' },
      'no-comment': { type: 'boolean', default: false },
      'no-status': { type: 'boolean', default: false },
      label: { type: 'string' },
      'max-prs': { type: 'string', default: '50' },
    },
  });
  const config = values.config ? parseConfig(readFileSync(values.config, 'utf8')) : undefined;

  if (cmd === 'check') {
    const report = analyze({ repo: values.repo!, mainRef: values.main!, headRef: values.head!, config });
    const fmt = values.format;
    console.log(fmt === 'json' ? JSON.stringify(report, null, 2) : fmt === 'md' ? toMarkdown(report) : toText(report));
    return report.ok ? 0 : 1;
  }
  if (cmd === 'recheck') {
    if (!values['github-repo']) throw new Error('recheck needs --github-repo OWNER/NAME');
    const token = values.token ?? process.env.GITHUB_TOKEN;
    if (!token) throw new Error('recheck needs --token or $GITHUB_TOKEN');
    const { owner, repo } = splitRepo(values['github-repo']);
    const gh = new GitHub({ token, userAgent: USER_AGENT, apiUrl: process.env.GITHUB_API_URL });
    const entries = await recheckOpenPrs({
      repoDir: values.repo!,
      gh,
      owner,
      repo,
      mainBranch: values['main-branch']!,
      comment: !values['no-comment'],
      status: !values['no-status'],
      label: values.label,
      maxPrs: Number(values['max-prs']),
      config,
    });
    console.log(values.format === 'json' ? JSON.stringify(entries, null, 2) : recheckMarkdown(entries, values['main-branch']!));
    return 0;
  }
  console.error(`unknown command: ${cmd}\n\n${USAGE}`);
  return 2;
}

if (/cli\.(c?js|ts)$/.test(process.argv[1] ?? '')) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`${PRODUCT}: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    },
  );
}
