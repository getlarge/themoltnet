#!/usr/bin/env node
// Apply the committed MoltNet Axiom monitor definitions in this directory.
//
// These JSON files are the source of truth for our Axiom alerts. Apply them via
// the REST API here so live monitors stay reproducible from the repo. The script
// is idempotent: it creates a monitor when no monitor of the same name exists,
// and updates the existing one otherwise.
//
// Usage:
//   AXIOM_API_TOKEN=xaat-... [AXIOM_API_URL=https://api.axiom.co] \
//     [NOTIFIER_IDS=id1,id2] node infra/axiom/monitors/apply.mjs [--dry-run]
//
// The token needs monitor read+write scope. Get a Personal/API token from the
// Axiom org settings; do NOT commit it. Notifier IDs are intentionally left
// empty in the definitions — wire them per environment via NOTIFIER_IDS (a
// comma-separated list) or edit the committed JSON once notifiers exist.
import { run } from '../lib/axiom-apply.mjs';

const notifierIds = (process.env.NOTIFIER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

run(
  {
    label: 'monitor',
    scope: 'monitor read+write scope',
    nameOf: ({ def }) => def.name,
    async plan({ defs, api }) {
      // Monitors are matched by name (no client-supplied uid), so list once up
      // front. A failure here (bad token, 5xx) throws and aborts before any write.
      const existing = await api.getJson('/v2/monitors');
      const idByName = new Map(existing.map((m) => [m.name, m.id]));

      return defs.map(({ def, file }) => {
        const name = def.name;
        if (!name) throw new Error(`${file} is missing a "name" field.`);
        const previousNames = Array.isArray(def.previousNames)
          ? def.previousNames
          : [];
        const body = { ...def };
        delete body.previousNames;

        // Optional per-env notifier injection; leave untouched when none supplied.
        if (notifierIds.length) body.notifierIds = notifierIds;
        const id = [name, ...previousNames]
          .map((candidate) => idByName.get(candidate))
          .find(Boolean);

        return id
          ? {
              action: 'update',
              name,
              id,
              method: 'PUT',
              path: `/v2/monitors/${id}`,
              body,
            }
          : {
              action: 'create',
              name,
              method: 'POST',
              path: '/v2/monitors',
              body,
            };
      });
    },
  },
  { scriptUrl: import.meta.url }
);
