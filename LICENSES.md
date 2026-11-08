# Licenses

Everything in this repository is open source under the MIT license,
Copyright (c) 2026 Mainfast authors. The full text is in [LICENSE](LICENSE); each
package carries the same file so it stays licensed when copied or published alone.

| Path | What | License |
| --- | --- | --- |
| `intact/` | Mainfast Intact (Action, CLI, library) | MIT ([intact/LICENSE](intact/LICENSE)) |
| `migrations/` | Mainfast Migrations | MIT ([migrations/LICENSE](migrations/LICENSE)) |
| `rollcall/` | Mainfast Rollcall | MIT ([rollcall/LICENSE](rollcall/LICENSE)) |
| `owners/` | Mainfast Owners | MIT ([owners/LICENSE](owners/LICENSE)) |
| `evidence/` | Mainfast Evidence | MIT ([evidence/LICENSE](evidence/LICENSE)) |
| `packages/shared/` | `@mainfast/shared` (GitHub client, Actions I/O, config loader, plan gate) | MIT ([packages/shared/LICENSE](packages/shared/LICENSE)) |
| `cli/` | `mainfast`, the CLI and MCP server on npm | MIT ([cli/LICENSE](cli/LICENSE)) |
| `schema/`, `docs/`, `scripts/` | Config schema, docs, build and brand scripts | MIT ([LICENSE](LICENSE)) |

## The license and the plan are separate things

The code is MIT for everyone. The plan is a fair-use request, not a condition of the license:

- **Free**: public repositories, and private repositories with up to 5 active
  contributors (opened a pull request or pushed in the last 30 days; bots excluded).
- **Pro**: private repositories above that, $4 per active contributor per month.

The Actions never fail, block or degrade a check over the plan. On a private repository
over the limit without a `MAINFAST_LICENSE` key, they add one notice to the job summary.
See [README.md#free-and-pro](README.md#free-and-pro).

## Third-party code

The bundles in `*/dist/` inline these runtime dependencies:

| Package | License |
| --- | --- |
| [`yaml`](https://github.com/eemeli/yaml) | ISC |

Build and test tools (TypeScript, esbuild, Vitest, Ajv, @types/node) are dev-only and are
not shipped. Example workflows reference `actions/checkout` and `actions/download-artifact`
(MIT, GitHub) by pinned commit; they are not vendored.
