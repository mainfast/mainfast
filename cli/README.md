# mainfast

Set up and run [Mainfast](https://mainfast.dev), GitHub checks that stop merges from silently
breaking main. It works the same for people and for coding agents.

```bash
npx mainfast init      # write the workflows and a starter .mainfast.yml
npx mainfast doctor    # what is installed, what is missing
npx mainfast check     # run Intact on this branch's merge commits, before you push
npx mainfast audit owners  # run one check now: rollcall, owners, migrations or evidence
```

`init` never overwrites a file unless you pass `--force`, and it does not commit, push or change
branch protection. Every command takes `--help` and `--json`. Exit codes: `0` nothing failed
(warnings may still be listed), `1` a finding that fails or something missing, `2` error. The
token comes only from `GITHUB_TOKEN` or `GH_TOKEN` and is never printed.

## MCP

`mainfast mcp` is an MCP server over stdio, with the tools `init`, `doctor`, `check` and `audit`:

```json
{
  "mcpServers": {
    "mainfast": { "command": "npx", "args": ["-y", "mainfast", "mcp"] }
  }
}
```

Report problems in [GitHub issues](https://github.com/mainfast/mainfast/issues).
