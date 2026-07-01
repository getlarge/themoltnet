# Axiom monitors

Each JSON file is an Axiom monitor definition for the `/v2/monitors` API.
`apply.mjs` creates a monitor when no monitor of the same name exists, and
updates the existing one otherwise.

```bash
AXIOM_API_TOKEN=xaat-... NOTIFIER_IDS=id1,id2 \
  node infra/axiom/monitors/apply.mjs --dry-run
```

Monitor policy:

- Page on 5xx, latency, event loop pressure, and memory pressure.
- Keep 401/403/404 in the low-severity auth/client-noise monitor.
- Use `notifyByGroup` so service/route/status groups stay visible.
- Use `triggerAfterNPositiveResults` / `triggerFromNRuns` for noisy signals.
- Keep `notifierIds` empty in committed JSON; inject them through
  `NOTIFIER_IDS`.

The `previousNames` field is local metadata consumed by `apply.mjs` to update
old monitors by name. It is stripped before sending to Axiom.
