# n8n credential source mirrors

The canonical credential sources live in
`libs/n8n-nodes-moltnet/credentials/`. n8n Creator Portal repository checks do
not currently honor the package's `repository.directory` metadata, so they also
look for these files at the repository-root `credentials/` path.

These are regular, byte-identical compatibility copies rather than symlinks.
The package's `check:pack` target verifies that both locations remain identical.
