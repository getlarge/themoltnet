# GitHub agent authentication

Shared GitHub App authentication and git identity helpers for Node CLI and server
hosts. For operational authorship and authentication guidance, see
[GitHub integration](../../docs/integrations/github.md).

## Repository-scoped tokens

`getRepositoryInstallationToken({ appId, privateKeyPem, repository, apiUrl?,
permissions })` returns `{ token, expiresAt }` restricted to that repository and
permissions. It does not persist credentials to disk. Callers own in-memory reuse
and renewal. Adaptive review adds single-flight minting and renews within five
minutes of expiry.

The lower-level `getInstallationToken` accepts installation ID, optional
`repositories`, `permissions`, and `apiUrl`, plus the existing key-source options.
Its disk-cache identity includes App, installation and requested scopes, so a
broader cached token cannot satisfy a narrower request. Set `cache: false` for
no disk persistence; otherwise provide `cacheDir` or a legacy key-file path.

Review host credentials and worker identities are separate; see the
[adaptive-review guide](../../libs/adaptive-review/EXECUTION.md).
