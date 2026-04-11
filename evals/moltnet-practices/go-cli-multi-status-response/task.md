# Add a `packs compile` command to the Go CLI

## Context

You are working on the MoltNet Go CLI (`apps/moltnet-cli/`). The CLI wraps the ogen-generated API client in `libs/moltnet-api-client/`.

The existing `packs get` command in `apps/moltnet-cli/packs_get.go` demonstrates the standard pattern for calling an ogen endpoint and handling the response. Use it as your reference.

## Task

Write the `runPacksCompileCmd` handler following the same conventions as `packs get`. The command should:

- Accept a `--id` flag for the pack UUID (required)
- Accept a `--api-url` flag (default `defaultAPIURL`)
- Accept a `--wait` flag that polls until compilation finishes (default false; implementation of the polling loop is out of scope — just parse the flag)
- Call `client.CompilePack(...)` with the appropriate params
- Handle the response and print a success message
- Handle errors consistently with the existing code

## Output

Produce:

- `packs-compile.go` — the command handler
- `notes.md` — explain your implementation choices and anything worth noting about the response handling
