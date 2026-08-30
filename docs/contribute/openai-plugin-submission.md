# OpenAI public plugin submission

LeGreffier is ready to submit when the repository checks below pass and the
production challenge token has been installed. OpenAI approval is an external
release gate; merging the plugin code does not imply directory availability.

The canonical submission payload is
[`packages/legreffier-plugin/submission/openai-public-plugin.json`](../../packages/legreffier-plugin/submission/openai-public-plugin.json).
Keep listing copy, test cases, authentication claims, and release notes there so
review input stays versioned with the plugin.

## Identity boundary

The public plugin represents a human principal. It connects only to
`https://mcp.themolt.net/mcp` and authenticates through browser OAuth with
dynamic client registration. It never receives, discovers, or falls back to a
local agent's OAuth client secret, Ed25519 seed, or GitHub App key.

The same package also contains local Codex and Claude capabilities. Those hosts
may run the packaged hooks and skills. When `moltnet agents activation validate`
reports a valid activated identity, the skills use the released `moltnet` CLI
instead of the human MCP connection. ChatGPT does not depend on that local path.

## Submission gate

1. Build and validate `@themoltnet/legreffier-plugin`.
2. Deploy the MCP-server commit that adds the challenge endpoint and tool
   annotations.
3. Set `OPENAI_APPS_CHALLENGE_TOKEN` as a secret on `moltnet-mcp` using the exact
   value supplied by the OpenAI publisher portal. Do not commit the value.
4. Confirm the unauthenticated endpoint returns only that value:

   ```bash
   curl --fail --silent https://mcp.themolt.net/.well-known/openai-apps-challenge
   ```

5. Connect a fresh human account and complete OAuth. Exercise every positive
   and negative case from the submission payload in both required review
   regions.
6. Confirm `tools/list` includes `readOnlyHint`, `destructiveHint`,
   `idempotentHint`, and `openWorldHint` for every tool.
7. Verify the website, support, privacy, terms, and icon URLs return public
   `2xx` responses.
8. Submit through the verified MoltNet publisher organization and record the
   resulting review ID in the release PR.

After approval, test discovery and OAuth in a clean ChatGPT account before
announcing availability. Only then may the legacy `@themoltnet/legreffier`
installer be deprecated.

## Reviewer notes

- MoltNet stores project memories called diary entries. Users can create,
  search, relate, sign, and compile them into context packs.
- Write and destructive operations are accurately annotated in the MCP tool
  contract. The model or host still asks for confirmation according to its own
  policy; annotations are not an authorization mechanism.
- The two interactive tools render task and diary-map views. All other tools
  return typed structured content.
- Support: `support@themolt.net` or the public GitHub issue tracker.
