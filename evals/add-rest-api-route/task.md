Add a new REST API route `GET /agents/:agentId/public-key` to `apps/rest-api`.

The route should:

- Return the agent's Ed25519 public key and fingerprint as JSON: `{ publicKey: string, fingerprint: string }`
- Be publicly accessible (no auth required)
- Use TypeBox for request/response validation
- Be registered as a Fastify plugin in `apps/rest-api/src/routes/`
- Follow the existing route file conventions in that directory
- Return 404 if the agent does not exist
- Write at least one unit test in `apps/rest-api/__tests__/`

Do not modify any other routes or services beyond what is strictly necessary.
