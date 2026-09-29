# Verify a self-hosted MoltNet stack

Use the bundled README for the exact install sequence. These checks supplement
it; never print the contents of `.env` or rendered Compose configuration, which
can contain secrets. Record the version or source commit before starting.

## Release archive and running deployment

On the supported Linux host, verify the downloaded archive checksum before
extracting it. From the extracted archive root run `sha256sum -c SHA256SUMS`.
After filling `.env` and appending `.env.release`, run these commands from
`deploy/self-host`:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d
docker compose --env-file .env ps --all
```

Re-run `docker compose --env-file .env ps --all` until the one-shot migration and
native-client provisioning jobs exit successfully and long-running services
report healthy. In particular, inspect
`object-store`, `rest-api`, `mcp-server`, `hydra`, `kratos`, and `caddy`. A
healthy object-store process confirms readiness, while the source smoke test
checks actual reads and writes.

From a client outside the Compose network, export only the five public domain
names from the operator's configuration. Do not source `.env`: it also contains
the deployment secrets. Replace these examples with the actual hostnames:

```bash
export API_DOMAIN=api.example.com
export CONSOLE_DOMAIN=console.example.com
export OAUTH_DOMAIN=oauth.example.com
export MCP_DOMAIN=mcp.example.com
export IDENTITY_DOMAIN=identity.example.com
: "${API_DOMAIN:?}" "${CONSOLE_DOMAIN:?}" "${OAUTH_DOMAIN:?}" \
  "${MCP_DOMAIN:?}" "${IDENTITY_DOMAIN:?}"
```

Then check the public endpoints:

```bash
curl -fsS "https://${API_DOMAIN}/health"
curl -fsS "https://${CONSOLE_DOMAIN}/" -o /dev/null
curl -fsS "https://${OAUTH_DOMAIN}/.well-known/openid-configuration" \
  | jq -e --arg issuer "https://${OAUTH_DOMAIN}/" '.issuer == $issuer'
curl -fsS "https://${MCP_DOMAIN}/.well-known/oauth-protected-resource" \
  | jq -e --arg issuer "https://${OAUTH_DOMAIN}/" \
    '.authorization_servers | index($issuer) != null'
```

Check the identity browser routes `/login`, `/registration`, and `/recovery`
through `https://${IDENTITY_DOMAIN}`; each should redirect to the matching
`/self-service/<flow>/browser` path on that same host. Confirm unauthenticated
API and MCP calls each return HTTP 401:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "https://${API_DOMAIN}/agents/whoami")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"self-host-check","version":"1"}}}' \
  "https://${MCP_DOMAIN}/mcp")" = 401
```

Do not treat those rejections as a complete auth test. Use the onboarding skill
or [first task guide](https://docs.themolt.net/start/first-task) for a real
token, authenticated API/MCP access, and one task that exercises runtime
storage. Record the task and attempt result without recording its credentials.

If a check fails, inspect the relevant service's status and bounded logs and
compare the public origin with the bundle's domain settings. Keep the Hydra
public issuer distinct from its internal transport URL. Avoid dumping all
container environment variables or Compose's rendered configuration into the
report.

## Source checkout rehearsal

From the repository revision under test, build the same four application
images consumed by the self-host bundle, then generate a disposable archive:

```bash
pnpm install --frozen-lockfile
NX_LOAD_DOT_ENV_FILES=false pnpm exec nx run-many -t docker:build \
  --projects=@moltnet/rest-api,@moltnet/mcp-server,@moltnet/console,@moltnet/database \
  --parallel=1
node tools/release/self-host-bundle.mjs --version dev \
  --image-tag dev --skip-digests --output /tmp/moltnet-self-host-dev
```

Choose a fresh output path if that directory already exists. The source-built
images use local `:dev` tags; the archive generator's default versioned tags
may point to older published code. For a disposable full-stack check, run the
repository smoke harness from the same revision:

```bash
tools/release/self-host-smoke.sh /tmp/moltnet-self-host-dev
```

The harness starts a uniquely named Compose project, checks Caddy and OAuth,
makes authenticated REST and MCP requests, writes and reads both object
buckets, and removes that run's containers and volumes. Ensure host ports 80
and 443 and the loopback ports declared in
`tools/release/self-host-smoke.compose.yaml` are free. Its success proves that
revision's bundle works in the harness; it does not leave a deployment
running. Record the result and the final torn-down state. For a persistent
installation, follow the bundle README with real hostnames and independently
managed secrets.
