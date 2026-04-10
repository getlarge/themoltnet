# Add a delete command to the Go CLI

## Problem

You're adding a `packs delete` command to the MoltNet Go CLI. The ogen-generated API client has already been regenerated. Look at the existing `packs get` handler in `apps/moltnet-cli/packs_get.go` for the current pattern, and check the generated response types in `libs/moltnet-api-client/oas_response_decoders_gen.go` to understand what the client returns.

The server returns HTTP 204 (No Content) on successful deletion.

Write the `runPacksDeleteCmd` handler following the project conventions.

## Output

Produce:

- `packs-delete.go` — the command handler
- `notes.md` — explain your implementation choices
