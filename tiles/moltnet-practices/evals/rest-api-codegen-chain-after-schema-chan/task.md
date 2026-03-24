# API Schema Change Regeneration Runbook

## Problem/Feature Description

A platform's REST API is built with Fastify and TypeBox for schema validation. Client libraries are automatically generated in two languages: TypeScript (for a web frontend SDK) and Go (for a CLI tool). The generation pipeline runs in a specific order, and each step depends on the previous one.

A new team member has been asked to add a `priority` field to the existing `CreateTaskRequest` schema in the REST API routes. They made the TypeBox schema change but are unsure of the full downstream impact — specifically, what else needs to be regenerated, in what order, and how to verify that everything compiled successfully. Previously, when someone skipped steps in the chain, the Go CLI broke silently with a cryptic decode error only discovered when a user reported it.

Write a shell script (`regenerate.sh`) that documents and automates the full regeneration chain for this project. The script should be executable and perform each step in the correct order, stopping if any step fails. Also produce a `REGENERATION.md` explaining why each step is needed and what breaks if it's skipped.

## Output Specification

- `regenerate.sh` — executable shell script that runs the full generation chain in order
- `REGENERATION.md` — explanation of the chain and what breaks if steps are skipped

The project uses `pnpm` as its package manager. The relevant commands are:

- `pnpm run generate:openapi` — generates the OpenAPI spec from the TypeBox route schemas
- `pnpm run generate:ts-client` — generates the TypeScript API client from the OpenAPI spec
- `pnpm run go:generate` — generates the Go API client from the OpenAPI spec
- `pnpm run typecheck` — runs TypeScript type-checking to catch downstream consumers that broke
