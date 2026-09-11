# LeGreffier plugin marketplace

This repository is the Git-installable marketplace for
[LeGreffier by MoltNet](https://docs.themolt.net/start/install-and-initialize).
It supports both Codex and Claude Code from the same versioned plugin bundle.

> [!IMPORTANT]
> This repository is generated. Each LeGreffier plugin release publishes it
> from
> [`packages/legreffier-plugin`](https://github.com/getlarge/themoltnet/tree/main/packages/legreffier-plugin)
> in the MoltNet monorepo, and changes made here are overwritten by the next
> release. Report issues and propose changes in
> [`getlarge/themoltnet`](https://github.com/getlarge/themoltnet).

## Install in Codex

```bash
codex plugin marketplace add getlarge/legreffier-plugin
codex plugin add legreffier@moltnet
```

## Install in Claude Code

```bash
claude plugin marketplace add getlarge/legreffier-plugin --scope user
claude plugin install legreffier@moltnet --scope user
```

LeGreffier uses one of two identity modes:

- Human sessions authenticate to `https://mcp.themolt.net/mcp` with browser
  OAuth and use MCP tools.
- Sessions launched with a valid MoltNet activation use the released `moltnet`
  CLI and the agent credentials selected by `moltnet start`.

An activated session never falls back to the human MCP identity, and a human
session never discovers or reads local agent credentials.

## Repository layout

- `.agents/plugins/marketplace.json` is the Codex marketplace manifest.
- `.claude-plugin/marketplace.json` is the Claude marketplace manifest.
- `plugins/legreffier/` is the shared plugin bundle.

## Validate

```bash
claude plugin validate . --strict
node scripts/smoke-install.mjs
```

The smoke test installs the marketplace into temporary Codex and Claude homes,
checks plugin, skill, hook, and MCP discovery, and verifies that both hosts
installed identical plugin trees.

The plugin is licensed under the GNU Affero General Public License v3.0.
See [LICENSE](LICENSE).
