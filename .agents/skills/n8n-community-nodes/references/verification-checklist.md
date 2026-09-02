# n8n community-node verification checklist

Sources of truth:

- [Verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)
- [Submit community nodes](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes/)

Markdown versions are available by appending `.md`. This checklist was
reconciled with both official pages on 2026-09-02.

## Node and package eligibility

- Integrate exactly one third-party service. A trigger for the same service may
  share the package.
- Do not submit logic or flow-control nodes, or a duplicate of an existing n8n
  integration.
- Start from or remain structurally compatible with the official `n8n-node`
  tooling. Use its linter and development expectations even when an Nx/Vite
  workspace owns orchestration.
- Package name starts with `n8n-nodes-` or `@<scope>/n8n-nodes-`.
- `package.json` keywords include `n8n-community-node-package`.
- `package.json#n8n` registers every shipped node and credential entry.
- The interface, help, errors, examples, and README are English-only.

## Source and documentation

- npm repository metadata points to the public source repository and, for a
  monorepo package, its correct directory.
- Creator Portal's repository pre-check may ignore `repository.directory` when
  locating credential source files. If the exact-version beta scanner passes
  but the Portal reports `Can't find credential file in repo`, expose the
  credential at the repository-root `credentials/<Name>.credentials.ts` path.
  Prefer a tracked file-level symlink to the package source so GitHub's Contents
  API resolves the canonical file without maintaining a duplicate. Do not use a
  directory symlink: repository tree traversal does not expose nested paths
  beneath it consistently.
- `package.json#author` includes an explicit email that matches the verified
  npm owner and Creator Portal account. Do not rely on the registry-generated
  `maintainers` array: Creator Portal resolves `author.email` separately.
- The package uses the MIT license.
- The packed README explains installation, authentication, supported
  operations, important defaults or limits, and includes an importable example
  workflow or equivalent usage example.
- Documentation links resolve publicly and do not depend on a local checkout.

## Runtime boundaries

- Published `dependencies` is empty. The verification rule concerns the packed
  artifact, not merely the source manifest.
- Do not access environment variables or the filesystem at runtime. Receive
  configuration through credentials and node parameters.
- Use TypeScript, n8n-native validation and error handling, item linking, and
  `continueOnFail()` behavior appropriate to the node.
- Keep restricted globals and imports out of both direct code and bundled
  dependency closure.
- Scan the emitted JavaScript, not only TypeScript source. Bundling can introduce
  restricted globals, timers, Node built-ins, or direct network transports from
  an otherwise lint-clean dependency closure.
- Load every manifest entry from a clean installation of the tarball. For n8n's
  CommonJS loader, verify the shipped node and credential modules with
  `require()`.

## Automated preflight

For `@themoltnet/n8n-nodes-moltnet`, run:

```bash
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:lint
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:typecheck
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:test
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:build
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:check:pack
```

The affected CI graph runs `test-ci`; use `test` for local preflight because
atomized `test-ci` requires Nx Agents in this workspace.

Inspect the tarball produced by pack validation and confirm:

- only intended `dist`, README, license, changelog, and example assets ship;
- no `src/`, tests, private imports, source maps containing private source, or
  workspace protocols leak;
- all `package.json#n8n` entries and icons exist;
- every credential path in `package.json#n8n.credentials` is tracked in the
  public repository at that exact path; Creator Portal may resolve the manifest
  path against Git rather than infer it from the source credential;
- any repository-root Creator Portal compatibility symlink is tracked and
  resolves to the canonical package credential source;
- a clean project can install and require both CommonJS entries without the
  bundled SDK or another undeclared runtime package installed separately.

## Publication and Creator Portal

- Since 2026-05-01, Creator Portal submissions must be published by GitHub
  Actions with an npm provenance statement. A local/manual publication is not
  eligible for verification.
- The publishing job needs `id-token: write` and should use npm Trusted
  Publishing/OIDC rather than a long-lived token when configured.
- Submit the exact npm version whose provenance and contents were checked.
- After publication, run
  `npx --yes @n8n/scan-community-package@beta <package>@<version>` against that
  exact immutable package version. Keep it ephemeral rather than adding it to
  workspace dependencies or installing it globally. Registry, repository,
  maintainer, and provenance checks cannot be proven by scanning an unpublished
  workspace.
- Do not trust the scanner process status by itself. Scanner releases may print
  a failed report and return status 0, so CI must also require the explicit
  `has passed all security checks` marker before promotion.
- Query `npm view <package>@<version> author maintainers --json` and verify the
  registry-visible `author.email` matches the verified npm owner. A successful
  scanner result does not prove Creator Portal can resolve this field.
- Verify npm metadata, provenance, tarball integrity, GitHub tag/release, and
  package version all refer to the same source commit before submitting through
  the Creator Portal.

The official scanner is necessary but not sufficient: complete the UX
checklist and a local editor smoke test as separate gates.
