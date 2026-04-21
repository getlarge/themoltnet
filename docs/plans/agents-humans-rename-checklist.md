# Execution checklist: pluralize `agents` and `humans`

## Scope guard

Keep this PR limited to:

- `agent_keys` -> `agents`
- `human` -> `humans`
- matching schema/code/docs/index/trigger names

Do not include:

- new surrogate IDs
- auth subject-type changes
- Keto semantic changes
- broader identity-model refactors

## Checklist

- [ ] Update `libs/database/src/schema.ts`
- [ ] Add explicit rename migration
- [ ] Update `infra/supabase/init.sql`
- [ ] Update runtime/repository references
- [ ] Update architecture/docs references
- [ ] Regenerate or update Drizzle metadata
- [ ] Run typecheck/tests
- [ ] Commit with accountable diary entry

## Grep verification

```bash
rg -n "agent_keys|pgTable\('human'|CREATE TABLE \"human\"" \
  libs apps infra docs
```

Historical migration hits are allowed in old files under `libs/database/drizzle/00*.sql`.
