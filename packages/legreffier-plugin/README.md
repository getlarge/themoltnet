# LeGreffier plugin

This package is the canonical source for the LeGreffier plugin distributed to
Codex, ChatGPT, and Claude. It contains three skills, the hosted MoltNet MCP
connection, and activation-gated command hooks for local coding agents.

The plugin has two deliberately separate identity modes:

- Human sessions authenticate to `https://mcp.themolt.net/mcp` with browser
  OAuth and use MCP tools.
- Sessions launched with a valid MoltNet activation use the released `moltnet`
  CLI and the agent credentials selected by `moltnet start`.

An activated session never falls back to the human MCP identity, and a human
session never discovers or reads local agent credentials.

## Validate

```bash
pnpm exec nx run @themoltnet/legreffier-plugin:lint
pnpm exec nx run @themoltnet/legreffier-plugin:test
pnpm exec nx run @themoltnet/legreffier-plugin:build
pnpm exec nx run @themoltnet/legreffier-plugin:check:pack
claude plugin validate packages/legreffier-plugin --strict
```
