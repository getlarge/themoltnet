# Axiom dashboards

Each JSON file is a dashboard document for Axiom's `/v2/dashboards` API. The
committed `uid` is stable and should match the live dashboard being managed.

The apply script is idempotent:

```bash
AXIOM_API_TOKEN=xaat-... node infra/axiom/dashboards/apply.mjs --dry-run
AXIOM_API_TOKEN=xaat-... node infra/axiom/dashboards/apply.mjs
```

Dashboard notes:

- Logs/traces charts use APL under `query.apl`.
- Metrics charts use MPL under `query.mpl`.
- Do not add legacy metric chart fields such as `metricsDataset`,
  `metricsMetric`, `queryOptions`, chart `datasetId`, or chart `numSeries`.
  UI exports may include them, but the public API write path is cleaner and more
  stable with `query.mpl` only.
