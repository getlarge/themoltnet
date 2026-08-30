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

## Release

`package.json` is the canonical plugin version. Release Please applies that
version to the Codex manifest, Claude manifest, and Claude marketplace entry in
the same release commit, then tags the bundle as
`legreffier-plugin-v<version>`.

The release workflow builds one deterministic archive, uploads its SHA-256
checksum, records GitHub build provenance, and only then publishes the draft
GitHub release. Codex, ChatGPT, and Claude releases must use that exact tagged
artifact; never submit a mutable branch or rebuild a published version.

Directory publication is deliberately separate from artifact publication:

1. Download and verify the archive for the GitHub tag.
2. Install and smoke-test that archive in Codex and Claude.
3. Rescan the tagged bundle in the OpenAI submission portal and submit an
   update with its release notes.
4. Publish only the approved OpenAI version and record the matching GitHub tag
   in the submission notes.

Bundled skills, hooks, rules, and MCP metadata share the plugin version. A
backward-compatible MCP server deployment does not require a plugin release;
changed tool schemas, annotations, permissions, or bundled guidance do.
