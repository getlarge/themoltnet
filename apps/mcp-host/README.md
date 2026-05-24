# @moltnet/mcp-host — MCP App host fixture

A browser host for exercising MoltNet MCP apps (the task app, the diary map app)
against a real MCP server. It mounts a tool's UI in a sandboxed iframe via
`@modelcontextprotocol/ext-apps`, exactly like a real MCP client would.

It is used two ways:

- **Automated**: the `@moltnet/mcp-host-e2e` Playwright suite drives it headless.
- **Manual**: a human opens it in a browser to _see and click_ an app.

## How it's wired

The host reads its configuration from **URL query params** (which override
everything) and, when served via `server.mjs`/Docker, from a `/config.js`
runtime object. Query params (`src/config.ts`):

| Param          | Meaning                                                   |
| -------------- | --------------------------------------------------------- |
| `tool`         | Tool to call, e.g. `entries_map_open` or `tasks_app_open` |
| `server`       | MCP endpoint, e.g. `http://localhost:8001/mcp`            |
| `clientId`     | Agent OAuth2 client id (sent as `X-Client-Id`)            |
| `clientSecret` | Agent OAuth2 client secret (sent as `X-Client-Secret`)    |
| `args`         | JSON tool arguments, e.g. `{"diary_id":"…","map":{…}}`    |
| `autorun`      | `1` to connect + run the tool on load                     |

The app runs **two iframes deep**: `#app-frame` loads the sandbox proxy
(`sandbox.html`), which mounts the app HTML in a nested `srcdoc` iframe. The
sandbox is served on a separate port (`:8083` in the e2e stack); the standalone
Vite dev server does **not** wire this up, which is why manual testing uses the
**dockerized** host below.

## Manual testing (recommended path)

The diary map app's first paint expects the _client agent_ to push an
interpreted map. In a headless browser there is no agent, so the
`entries_map_open` tool accepts an optional pre-built `map` in its `args`; the
fixture script below supplies one so you can see and click the real UI.

### 1. Start the local e2e stack

This builds + runs everything, including the dockerized host on `:8082`
(sandbox on `:8083`) pointed at the MCP server on `:8001`.

```bash
# Build app dists + the rest-api embedding model first (image build needs them):
pnpm exec nx run-many -t build --projects=@moltnet/mcp-host,@moltnet/mcp-server,@moltnet/rest-api,@moltnet/console
pnpm exec nx run @moltnet/rest-api:download-model

COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
# wait until all services are (healthy):
docker compose -f docker-compose.e2e.yaml ps
```

> If you changed an MCP app's UI, rebuild its lib and the mcp-server image so
> the container serves the new `dist/index.html`:
> `pnpm exec nx build @moltnet/entry-explore-mcp-app && COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build mcp-server`

### 2. Mint a throwaway agent, seed entries, get a ready URL

```bash
pnpm exec nx run @moltnet/mcp-host-e2e:diary-map-fixture
```

This provisions an agent against the running stack (via the e2e harness), seeds
~7 namespaced-tag entries into its private diary, and prints a URL with the
client credentials + a three-zone `entries_map_open` payload baked in. The agent
and diary persist for the life of the stack.

### 3. Open the printed URL

Paste it into a browser. You should see the diary map first paint (overview +
zone cards), be able to focus a zone (entry mosaic with a "showing N of M"
header), follow the breadcrumb, and click **Save this zone** to materialize an
unpinned draft pack (the button then offers to validate = pin it).

### 4. Tear down

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

## Other tools

To exercise the task app instead, open the host with `tool=tasks_app_open` and
appropriate `args` (see `apps/mcp-host-e2e/src/example.spec.ts`).

## Notes

- **CORS**: the MCP server reflects any browser `Origin` (auth stays mandatory),
  so any host origin works.
- **Credentials**: there is no UI to mint OAuth2 clients for the local stack;
  the fixture script uses `bootstrapGenesisAgents()` from `@moltnet/bootstrap`
  (the same path the e2e harness uses). `pnpm bootstrap` targets Ory **Network**
  (cloud), not the local Docker Hydra — don't use it for local manual testing.
