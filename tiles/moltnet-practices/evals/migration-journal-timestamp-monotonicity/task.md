# Drizzle Migration Journal Validator

## Problem/Feature Description

A team working on a TypeScript project has been using Drizzle ORM for database migrations. Their project uses synthetic future-dated timestamps in the migration journal (starting at `1774560400000` and incrementing by 1 for each migration), but `drizzle-kit generate` writes `Date.now()` wall-clock timestamps which are far smaller than the synthetic values. This has caused silent ordering bugs in the migration system.

A new developer on the team recently ran `drizzle-kit generate` and committed the result without checking, introducing a non-monotonic timestamp entry. The team now wants a script that validates the journal and fixes any out-of-order entries automatically.

Write a Node.js script (or TypeScript script) that reads the `_journal.json` file provided, validates that the `when` field in each entry is strictly greater than the previous entry, and automatically patches any entries that are out of order to restore monotonic ordering. The script should print a report of what was changed and output the corrected journal.

## Output Specification

- `validate-journal.js` (or `.ts`) — the validator/fixer script
- `fixed_journal.json` — the corrected journal produced by running your script against the provided input

## Input Files (optional)

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/\_journal.json ===============
{
"\_meta": {
"custom_migrations": "custom"
},
"entries": [
{
"idx": 0,
"version": "7",
"when": 1774560400000,
"tag": "0000_initial_schema",
"breakpoints": true
},
{
"idx": 1,
"version": "7",
"when": 1774560400001,
"tag": "0001_add_users",
"breakpoints": true
},
{
"idx": 2,
"version": "7",
"when": 1774560400002,
"tag": "0002_add_entries",
"breakpoints": true
},
{
"idx": 3,
"version": "7",
"when": 1774560400003,
"tag": "0003_add_relations",
"breakpoints": true
},
{
"idx": 4,
"version": "7",
"when": 1774560400004,
"tag": "0004_add_context_packs",
"breakpoints": true
},
{
"idx": 5,
"version": "7",
"when": 1748100000000,
"tag": "0005_add_notification_column",
"breakpoints": true
}
]
}
