# Axiom config

Committed Axiom dashboards and monitors for the hosted MoltNet Axiom org.

This follows the source-of-truth pattern from the on-board Axiom refresh work,
adapted for MoltNet's hosted Axiom datasets:

- `moltnet` — logs and traces (`otel.traces`)
- `moltnet-metrics` — metrics (`otel:metrics:v1`)

There is no self-hosted customer/container layer here, so the config avoids
on-board-specific dimensions such as `customer.name`, `container.name`,
RabbitMQ, Docker stats, and Ory Prometheus scrape jobs.

## Apply dashboards

```bash
AXIOM_API_TOKEN=xaat-... node infra/axiom/dashboards/apply.mjs --dry-run
AXIOM_API_TOKEN=xaat-... node infra/axiom/dashboards/apply.mjs
```

The token needs dashboard read and create/update scope.

## Apply monitors

```bash
AXIOM_API_TOKEN=xaat-... NOTIFIER_IDS=id1,id2 \
  node infra/axiom/monitors/apply.mjs --dry-run

AXIOM_API_TOKEN=xaat-... NOTIFIER_IDS=id1,id2 \
  node infra/axiom/monitors/apply.mjs
```

The token needs monitor read/create/update scope and query access to
`moltnet` and `moltnet-metrics`. `NOTIFIER_IDS` is optional; without it the
monitors evaluate in Axiom but do not push notifications.

## Node-RED webhook notifier

For the alert-triage flow, create an Axiom custom webhook notifier that posts to
the Node-RED endpoint:

```json
{
  "action": "{{ .Action }}",
  "endTime": "now",
  "environment": "production",
  "monitorId": "{{ .MonitorID }}",
  "monitorName": "{{ .Title }}",
  "source": "axiom",
  "startTime": "now-30m",
  "summary": "{{ .Body }}",
  "triageHint": "Use the monitor description first; it says whether to inspect logs, traces, metrics, or code.",
  "value": "{{ .Value }}"
}
```

Add a secret header such as `x-axiom-webhook-secret` and configure the same
value as `AXIOM_WEBHOOK_SECRET` in Node-RED.

## Safety

- Do not commit Axiom tokens.
- Keep notifier IDs environment-injected unless the destination is stable and
  intentionally shared by every environment.
- Run `--dry-run` before applying.
- Treat monitor and dashboard apply as live operational changes.
