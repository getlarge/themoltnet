---
name: axiom-observability
description: Maintain MoltNet Axiom observability assets. Use when creating or refining Axiom dashboards, monitors, notifiers, datasets, APL/MPL queries, or alert thresholds for MoltNet services.
license: Apache-2.0
---

# Axiom Observability

Use this skill for MoltNet Axiom dashboard, monitor, notifier, and query work.
Prefer read-only inspection before changing live Axiom config.

## Source of truth

Committed Axiom config lives in `infra/axiom/`:

- `infra/axiom/dashboards/*.json`: shared dashboards for `moltnet` and
  `moltnet-metrics`.
- `infra/axiom/monitors/*.json`: monitor definitions. `notifierIds` stay empty
  in git and are injected by `NOTIFIER_IDS`.
- `infra/axiom/lib/axiom-apply.mjs`: dependency-free shared upsert engine
  adapted from the on-board Axiom refresh work.

Default to editing the committed JSON, then applying with `--dry-run` first:

```bash
AXIOM_API_TOKEN=xaat-... node infra/axiom/dashboards/apply.mjs --dry-run
AXIOM_API_TOKEN=xaat-... NOTIFIER_IDS=id1,id2 node infra/axiom/monitors/apply.mjs --dry-run
```

Only use direct Axiom UI/API mutation for emergency repair or exploration, and
backport the final shape into `infra/axiom`.

## MoltNet datasets

- `moltnet`: logs and traces (`otel.traces`). Query with APL.
- `moltnet-metrics`: metrics (`otel:metrics:v1`). Query with MPL.

Known services:

- `moltnet-rest-api`
- `moltnet-mcp-server`
- agent daemon services when deployed with OTLP enabled

Useful log/trace fields:

- `service.name`
- `resource.deployment.environment`
- `attributes.route`
- `attributes.http.request.method`
- `attributes.http.response.status_code`
- `trace_id`
- `span_id`
- `attributes.taskId`
- `attributes.teamId`
- `attributes.diaryId`
- `attributes.error`
- `severity_number`
- `severity_text`

Useful metrics:

- `http.server.request.total`
- `http.server.request.duration`
- `http.server.active_requests`
- `nodejs.eventloop.delay.p99`
- `nodejs.eventloop.delay.max`
- `nodejs.eventloop.utilization`
- `v8js.memory.heap.used`
- `v8js.memory.heap.limit`
- `v8js.gc.duration`

## Monitor policy

Do not page on broad "error exists" queries. Split alerts by response class,
runtime symptom, and actionability.

Recommended monitor families:

- 5xx server errors: actionable by service and route.
- Latency regression: use request duration histograms by service/route.
- Event loop pressure: use `nodejs.eventloop.delay.p99` or `.max`.
- Memory pressure: compare heap used to heap limit.
- Auth/client noise: 401/404 spikes only as low-severity routing or debugging
  signals, not paging alerts.

Every monitor should state:

- severity
- service scope
- dataset and query language
- time window and interval
- threshold and operator
- expected action
- webhook route
- dashboard or query link for first inspection

## Query workflow

1. List datasets and confirm kind before querying.
2. For `moltnet`, inspect fields before changing APL. Map fields such as
   `attributes.error` can contain mixed types, so avoid grouping on them unless
   converted or sampled first.
3. For `moltnet-metrics`, inspect metric metadata before writing MPL. Use
   metric type and temporality to choose rate, increase, histogram, or gauge
   queries.
4. Keep time windows narrow. Widen only after a cheap probe proves the query.
5. Prefer grouped aggregates over raw rows for dashboards and monitors.

APL example:

```apl
['moltnet']
| where ['_time'] > ago(15m)
| where ['attributes.http.response.status_code'] >= 500
| summarize count() by ['service.name'], ['attributes.route']
```

MPL examples:

```mpl
`moltnet-metrics`:`nodejs.eventloop.delay.p99`
| align to 1m using max
| group by `service.name` using max
```

```mpl
`moltnet-metrics`:`http.server.request.duration`
| bucket by `service.name` to 5m using interpolate_cumulative_histogram(rate, 0.95, 0.99)
```

## Dashboard workflow

1. Export the existing dashboard before patching it.
2. Normalize metrics charts to `query.mpl` only; do not keep UI-exported legacy
   fields such as `metricsDataset`, `metricsMetric`, `datasetId`, or
   `numSeries` in committed dashboard JSON.
3. Keep dashboard panels tied to monitor families.
4. Use service, route, environment, and status class as primary dimensions.
5. Prefer dashboard links in monitor descriptions and webhook payloads.
6. After updates, verify the dashboard loads and every chart uses the expected
   dataset.

## Change safety

- Treat monitor and notifier edits as live operational changes.
- Never delete dashboards, monitors, or notifiers without explicit user approval.
- When creating or updating a custom webhook notifier, include only stable alert
  fields and avoid secrets in the body. Put secrets in notifier headers.
- Do not commit Axiom tokens. Pass them through `AXIOM_API_TOKEN` only.
