// Fixture GitHub API for the acme/app repository, shaped like docs.github.com
// REST responses (API version 2022-11-28). Users:
//   alice  member, write, 4 recent reviews        dave   member, write, 0 reviews (dormant)
//   bob    exists, left the org, read access      ghost  account deleted (404)
//   carol  member, read access only
// Teams: platform (push), web (push), readers (pull only); gone does not exist.
// `GET /orgs/acme/teams` is the org-token probe (Organization > Members: read); tests without an
// org-token assert that no /orgs/ endpoint is called at all.
import type { MockRoute } from '@mainfast/shared/mockfetch';

/** A contents-API file reply. */
export const file = (text: string) => ({ body: { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), sha: 'b'.repeat(40), content: Buffer.from(text).toString('base64') } });
/** A git-trees reply. */
export const tree = (paths: string[], truncated = false) => ({ body: { sha: 't', truncated, tree: paths.map((path) => ({ path, type: 'blob', mode: '100644' })) } });

const R = '/repos/acme/app';
const user = (login: string) => ({ body: { login, id: login.length, type: 'User', html_url: `https://github.com/${login}` } });
const perm = (login: string, permission: string, role_name = permission) => ({
  body: { permission, role_name, user: { login, id: 1, type: 'User' } },
});
const team = (slug: string) => ({ body: { id: slug.length, slug, name: slug, privacy: 'closed', permission: 'pull', organization: { login: 'acme' } } });
const teamRepo = (permissions: Record<string, boolean>, role_name: string) => ({
  body: { id: 1, full_name: 'acme/app', role_name, permissions },
});
const reviews: Record<string, number> = { alice: 4, dave: 0, bob: 1, carol: 2 };

export function acmeRoutes(extra: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  return {
    [`GET ${R}`]: { body: { id: 1, full_name: 'acme/app', owner: { login: 'acme', type: 'Organization' }, default_branch: 'main' } },
    'GET /users/alice': user('alice'),
    'GET /users/bob': user('bob'),
    'GET /users/carol': user('carol'),
    'GET /users/dave': user('dave'),
    'GET /users/ghost': { status: 404, body: { message: 'Not Found' } },
    'GET /orgs/acme/teams': { body: [] },
    'GET /orgs/acme/members/alice': { status: 204 },
    'GET /orgs/acme/members/carol': { status: 204 },
    'GET /orgs/acme/members/dave': { status: 204 },
    'GET /orgs/acme/members/bob': { status: 404, body: { message: 'Not Found' } },
    [`GET ${R}/collaborators/alice/permission`]: perm('alice', 'write'),
    [`GET ${R}/collaborators/bob/permission`]: perm('bob', 'read'),
    [`GET ${R}/collaborators/carol/permission`]: perm('carol', 'read', 'triage'),
    [`GET ${R}/collaborators/dave/permission`]: perm('dave', 'admin'),
    'GET /orgs/acme/teams/platform': team('platform'),
    'GET /orgs/acme/teams/web': team('web'),
    'GET /orgs/acme/teams/readers': team('readers'),
    'GET /orgs/acme/teams/gone': { status: 404, body: { message: 'Not Found' } },
    [`GET /orgs/acme/teams/platform/repos/acme/app`]: teamRepo({ admin: false, maintain: true, push: true, triage: true, pull: true }, 'maintain'),
    [`GET /orgs/acme/teams/web/repos/acme/app`]: teamRepo({ admin: false, maintain: false, push: true, triage: true, pull: true }, 'write'),
    [`GET /orgs/acme/teams/readers/repos/acme/app`]: teamRepo({ admin: false, maintain: false, push: false, triage: false, pull: true }, 'read'),
    'GET /search/issues': ({ path }) => {
      const q = decodeURIComponent(new URL(`http://x${path}`).searchParams.get('q') ?? '');
      const login = q.match(/reviewed-by:(\S+)/)?.[1] ?? '';
      return { body: { total_count: reviews[login] ?? 0, incomplete_results: false, items: [] } };
    },
    [`GET ${R}/codeowners/errors`]: {
      body: {
        errors: [
          {
            line: 11,
            column: 21,
            kind: 'Unknown owner',
            source: '/api/payments/          @ghost @acme/readers',
            suggestion: 'make sure @ghost exists and has write access to the repository',
            message: 'Unknown owner on line 11: make sure @ghost exists and has write access to the repository\n\n  /api/payments/ @ghost',
            path: '.github/CODEOWNERS',
          },
        ],
      },
    },
    ...extra,
  };
}

export const repoFiles = [
  '.github/CODEOWNERS',
  'README.md',
  'web/app.ts',
  'web/style.css',
  'web/legacy/old.ts',
  'web/generated/schema.ts',
  'api/server.ts',
  'api/payments/charge.ts',
  'api/search/index.ts',
  'docs/intro.md',
  'docs/guides/setup.md',
];
