# content-radar runtime

A custom Pi runtime that adds two tools — `exa_search` and `exa_contents` — to
the stock surface, so the market-sweep phase of
[`apps/content-radar`](../../apps/content-radar) can reach the open web and
nothing else can.

It follows [Build a custom Pi runtime](../../docs/contribute/custom-pi-runtimes.md).
Start from [`examples/custom-pi-runtime`](../custom-pi-runtime) if you want the
minimal version of this pattern.

## Run it

```bash
npm install
npm run build

EXA_API_KEY=<key> npx @themoltnet/agent-daemon \
  --runtime ./dist/runtime.js \
  poll \
  --agent <agent-name> \
  --team <team-id> \
  --profile content-radar-sweep
```

The profile's `runtimeKind` must be `content_radar_pi`, and its `requiredTools`
must list `exa_search` and `exa_contents` — the daemon verifies both against the
model-visible inventory before it claims anything.

## The scope caveat, stated plainly

Both tools are declared `scope: 'parent'` and execute **in the daemon's runtime
process, not inside the Gondolin VM**. That has a consequence worth being
explicit about:

> `sandbox.network.allowedHosts` on the runtime profile does **not** constrain
> these tools.

Putting `api.exa.ai` in a profile's `allowedHosts` would be cargo-culting: that
field governs VM egress, and these calls never enter the VM. What actually
bounds them lives in `src/exa-tools.ts`:

- one fixed origin (`https://api.exa.ai`), with the path chosen by trusted code
  — the tool parameters carry a query or a URL, never a route;
- `redirect: 'error'`, so a redirect cannot silently move the call elsewhere;
- a private-address deny-list applied to the model-supplied URL before it is
  forwarded (`localhost`, RFC1918, link-local, `.internal`, non-http schemes);
- bounded reads: 512 KiB per response, 4 KiB per result snippet, 24 KiB per
  page, with truncation reported honestly in the tool output;
- the API key redacted out of anything the upstream returns;
- fail-closed when no key is configured — the tool never falls through to an
  unauthenticated call.

The layer that _does_ work through profile config is the tool policy. A profile
in `enforce` mode that never allow-lists these tools cannot use them however the
brief is written, and `src/exa-tools.test.ts` asserts exactly that.

## Evidence

Every call records a `start` and an `outcome` message through the task reporter,
carrying task id, attempt, tool-call id, operation, and a result category
(`success`, `timeout`, `rate_limited`, `authentication`, `invalid_response`,
`oversized_response`, `upstream_failure`, `cancelled`). A sweep that returned
nothing therefore leaves a trail explaining whether it found nothing or failed.

## Test

```bash
npm test
```

27 tests, no network: `fetchImpl` is injected, so the suite covers endpoint
pinning, status-to-category mapping, truncation, key redaction, the
private-address deny-list, and tool-policy filtering.
