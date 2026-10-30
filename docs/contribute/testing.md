# Test Conventions

Every project names and places its tests the same way, so a single glob
recognises a test file in every tool: Vitest and Playwright configs, tsconfigs,
Nx inputs, knip and release locks.

## Suffixes

| Suite       | Suffix                  | Example                                    |
| ----------- | ----------------------- | ------------------------------------------ |
| Unit        | `*.spec.ts`/`.spec.tsx` | `__tests__/lib/repair.spec.ts`             |
| Integration | `*.integration.spec.ts` | `__tests__/repository.integration.spec.ts` |
| End-to-end  | `*.e2e.spec.ts`         | `src/diary-flow.e2e.spec.ts` (e2e project) |
| Plain JS    | `*.spec.mjs`            | `__tests__/release/install.spec.mjs`       |

Never use `*.test.*`. The kind marker (`integration`, `e2e`) lets a project run
slow suites as separate targets by `include` glob.

## Placement

Tests live in the project's root `__tests__/` folder, which mirrors `src/`:

```text
libs/json-repair/
├── src/lib/json-repair.ts
└── __tests__/lib/json-repair.spec.ts
```

Test support code goes in `__tests__/` too: setup files, fixtures, fakes,
harnesses and shared helpers. `src/` holds production code only, so the
`__tests__/**` glob is the whole boundary between production and test code. Nx
production inputs, `tsconfig.lib.json` and published `files` exclude it without
per-file rules.

`*-e2e` projects contain only tests and keep them in `src/`.

`libs/cpp-sdk` follows CMake conventions and is exempt.

## Enforcement

`pnpm run check:test-conventions` (`tools/src/check-test-conventions.ts`) runs
in CI and fails on:

- a `*.test.*` file, or a legacy `*.e2e.ts` file;
- a test file outside the project-root `__tests__/` folder (non-e2e projects);
- another test folder, such as `tests/` or a nested `__tests__/`;
- a file in `src/` that imports a test framework (`vitest`,
  `@testing-library/*`, `@playwright/test`, `node:test`).

## Migrating a project

The `harmonize-tests` generator renames and moves a project's tests, moves its
test support files, rewrites relative imports, `vi.mock` paths and
`import.meta.url` paths, and updates the project's config globs:

```bash
pnpm exec nx g @moltnet/tools:harmonize-tests --project=<name> --dry-run
pnpm exec nx g @moltnet/tools:harmonize-tests --project=<name>
```

It prints the path expressions it cannot rewrite statically, such as a path
computed from `import.meta.dirname` at runtime. Fix those by hand, then check
that the project's test target collects the same files as before.
