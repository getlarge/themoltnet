#!/usr/bin/env node
// Apply the committed MoltNet Axiom dashboard definitions in this directory.
//
// These JSON files are the source of truth for our Axiom dashboards. Each file
// is the dashboard document (the shape returned by exportDashboard, minus the
// server-managed id/version/timestamps) plus a stable top-level "uid". The
// script is idempotent: the Axiom dashboards API (`POST /v2/dashboards` with
// `overwrite: true`) creates the dashboard when its uid is new and overwrites
// the existing one otherwise. Keep repo-managed UIDs distinct from private UI
// dashboards: API tokens cannot see or overwrite private dashboards owned by a
// user, and Axiom reports that collision as `dashboard_not_found`.
//
// IMPORTANT — traces charts use APL under `query.apl`; metrics charts use MPL
// under `query.mpl` and must NOT keep the older API-authored metric metadata
// fields (`metricsDataset`, `metricsMetric`, `queryOptions`, chart `datasetId`,
// chart `numSeries`). UI-saved metric dashboard filters use `selectType:
// "query"` with `query.mpl`, but the public dashboards API currently rejects
// that filter type on writes. Store those UI exports in this repo, but do not
// apply them until Axiom fixes API support. Validate chart queries against live
// data before committing.
//
// Usage:
//   AXIOM_API_TOKEN=xaat-... [AXIOM_API_URL=https://api.axiom.co] \
//     node infra/axiom/dashboards/apply.mjs [--dry-run]
//
// The token needs dashboard read+write scope. Do NOT commit it.
import { run } from '../lib/axiom-apply.mjs';
import { validateResources } from '../lib/validate.mjs';

function assertNoApiUnsupportedMetricFilters({ defs }) {
  const unsupported = [];

  for (const { def, file } of defs) {
    for (const chart of def.charts ?? []) {
      if (chart?.type !== 'SmartFilter') continue;

      for (const filter of chart.filters ?? []) {
        if (filter?.selectType === 'query') {
          unsupported.push(
            `${file}: filter "${filter.name ?? filter.id ?? '(unnamed)'}"`,
          );
        }
      }
    }
  }

  if (unsupported.length === 0) return;

  throw new Error(
    [
      'Axiom dashboard API currently rejects UI-exported dynamic metric filters',
      'with selectType: "query". These files are stored from the UI export, but',
      'must not be applied through the public API until Axiom supports that',
      'filter type on writes:',
      ...unsupported.map((item) => `- ${item}`),
    ].join('\n'),
  );
}

run(
  {
    label: 'dashboard',
    scope: 'dashboard read+write scope',
    nameOf: ({ def }) => def.name,
    validate: (defs) => validateResources('dashboard', defs),
    async plan({ defs, api }) {
      assertNoApiUnsupportedMetricFilters({ defs });

      // List once so we can label create vs update in the output. Managed
      // dashboards are shared with X-AXIOM-EVERYONE and therefore visible to
      // the deployment token. A failed list aborts before any write.
      const existing = await api.getJson('/v2/dashboards');
      const uidsInOrg = new Set(
        existing.map((d) => d?.dashboard?.uid).filter(Boolean),
      );

      return defs.map(({ def, file }) => {
        const name = def.name;
        if (!name) throw new Error(`${file} is missing a "name" field.`);
        if (!def.uid) throw new Error(`${file} is missing a "uid" field.`);

        // Upsert is unconditional: POST { dashboard, overwrite: true }. overwrite
        // is harmless on first create and makes re-applies idempotent (no dup,
        // no version juggling). action is cosmetic — for the log line only.
        const action = uidsInOrg.has(def.uid) ? 'update' : 'create';
        return {
          action,
          name,
          id: uidsInOrg.has(def.uid) ? def.uid : undefined,
          method: 'POST',
          path: '/v2/dashboards',
          body: { dashboard: def, overwrite: true },
        };
      });
    },
  },
  { scriptUrl: import.meta.url },
);
