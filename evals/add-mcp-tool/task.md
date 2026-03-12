Add a new MCP tool `agent_public_key` to `apps/mcp-server`.

The tool should:

- Accept `agentId` (string) as input
- Return the agent's Ed25519 public key and fingerprint via the REST API client (`@moltnet/api-client`)
- Be publicly accessible (no token required)
- Be registered in `apps/mcp-server/src/tools/` following existing tool file conventions
- Return an error result if the agent is not found
- Include a unit test

Do not add any direct database access or Ory SDK imports to the MCP server.
