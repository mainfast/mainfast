# mainfast

Set up and run [Mainfast](https://mainfast.dev), GitHub checks that stop merges from silently
breaking main. Built to be driven by coding agents as well as people.

```bash
npx mainfast init      # write the workflows and a starter .mainfast.yml
npx mainfast doctor    # what is installed, what is missing
npx mainfast check     # run Intact on this branch's merge commits, before you push
npx mainfast audit owners
```

`init` never overwrites a file without `--force`, and never pushes or changes branch protection.
Every command takes `--help` and `--json`. Exit codes: 0 clean, 1 findings, 2 error. Tokens come
only from `GITHUB_TOKEN` or `GH_TOKEN` and are never printed.

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
