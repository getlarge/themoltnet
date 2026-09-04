---
name: n8n-community-nodes
description: Build, audit, improve, test, or prepare n8n community-node packages for npm and Creator Portal verification. Use for n8n node UX, credentials, node properties, community-package metadata, scanners, local node development, and verified-node releases; not for merely authoring or running an ordinary n8n workflow.
---

# n8n Community Nodes

Apply n8n's technical checks and its human-facing UX rules as separate gates.
A passing linter or community-package scan does not prove that operation copy,
resource selection, output size, or recovery guidance meets the UX standard.

## Route the task

- For node fields, credentials, operations, output, copy, or errors, read
  [references/ux-checklist.md](references/ux-checklist.md).
- For package structure, verification, npm publication, provenance, or Creator
  Portal submission, read
  [references/verification-checklist.md](references/verification-checklist.md).
- Read both references for a verification preflight or when changing a node
  that is intended to remain verified.

The references are a maintained decision checklist, not a replacement for the
official documentation. Re-fetch the linked official Markdown pages before a
verification submission or release when their contents may have changed.

## Audit before editing

1. Resolve the effective Nx project with
   `pnpm exec nx show project <project> --json`.
2. Inspect the credential classes, node descriptions, execution code,
   `package.json`, README, examples, tests, build configuration, and pack
   validation. Inspect the packed artifact when publication is in scope.
   For Creator Portal submission, confirm the packed `author.email` exactly
   matches the verified npm owner and Portal account; npm maintainer metadata
   does not substitute for this field.
3. Report findings as:
   - **Required**: an explicit n8n requirement is unmet.
   - **Recommended**: n8n says "try", "whenever possible", or the API makes a
     standard UX pattern useful.
   - **Not applicable**: state the product or API constraint that makes the
     guideline irrelevant.
4. Preserve service terminology. Do not manufacture CRUD operations that the
   service does not support; use its real equivalent, such as Cancel instead of
   Delete, and document the applicability decision.

## Implement deliberately

- Keep secrets in password fields and never place them in workflow JSON,
  errors, logs, examples, or source.
- Use n8n-native error types, process every input item, preserve `pairedItem`,
  and honor `continueOnFail()` unless the node type has a documented reason not
  to.
- Keep the official n8n ESLint rules enabled. Fix violations rather than
  disabling strict, cloud-support, metadata, credential, item-linking, import,
  environment, or filesystem rules.
- For MoltNet's Nx/Vite packages, retain top-level `nodes/` and `credentials/`,
  produce CommonJS entries loadable with `require()`, bundle intentionally
  private/workspace implementation dependencies from `devDependencies`, and
  publish with no runtime `dependencies`.
- Add behavioral tests for UX-affecting choices: defaults, display conditions,
  credential modes, simplified/raw output, resource lookup, actionable errors,
  multi-item execution, linking, and `continueOnFail()` as applicable.

## Verify through Nx

Use the project's effective target names. For the MoltNet package, the expected
preflight is:

```bash
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:lint
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:typecheck
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:test
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:build
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:check:pack
```

The affected CI graph uses `test-ci`. Run `test` locally because this workspace
reserves the atomized `test-ci` target for Nx Agents.

Run the local development target when the UI or node registration changed:

```bash
pnpm exec nx run @themoltnet/n8n-nodes-moltnet:dev
```

Confirm the credential and every operation in the editor, including display
conditions, labels, defaults, placeholders, resource locators, output modes,
dark/light icons, and one failing execution. A code-only inspection cannot
fully validate n8n editor behavior.

Run `npx --yes @n8n/scan-community-package@beta <package>@<version>` against
the exact immutable npm version after publication for Creator Portal parity.
Keep the scanner out of workspace dependencies and do not install it globally.
Do not use an unpublished workspace scan as proof of registry, repository, or
provenance compliance.

Treat emitted JavaScript and packed manifest paths as verification inputs: scan
the built entries for restricted dependency code, and ensure every credential
path registered in `package.json#n8n` exists in the packed tarball and loads in
a clean installation. Generated `dist` entries do not need to be tracked in
Git; the official starter ignores `dist`. Require the scanner's explicit `has
passed all security checks` output in CI because scanner releases may print a
failed report with status 0. See the verification checklist for the concrete
pack and publication gates.

The scanner does not prove that Creator Portal can resolve package ownership.
Query the exact published version with `npm view <package>@<version> author
maintainers --json` and confirm `author.email` is present and matches the
verified npm owner before submission.
