/**
 * Review cues from repository policy, selected by changed path. A rule is a
 * question for the focused reviewer, not a finding. CI remains authoritative
 * for lint, formatting, typecheck, and test failures.
 */
export interface ConventionRule {
  id: string;
  description: string;
  paths: string[];
  kind: 'mechanical' | 'semantic';
  source: string;
}

export const CONVENTIONS: readonly ConventionRule[] = [
  {
    id: 'schema-migration',
    description:
      'Changes to the Drizzle schema require a matching SQL migration.',
    paths: ['libs/database/src/schema.ts'],
    kind: 'mechanical',
    source: 'AGENTS.md#database-schema-changes',
  },
  {
    id: 'migration-metadata',
    description:
      'Custom structural SQL must keep Drizzle schema, snapshots, and the monotonic journal consistent.',
    paths: [
      'libs/database/drizzle/**/*.sql',
      'libs/database/drizzle/meta/**/*.json',
    ],
    kind: 'semantic',
    source: '.agents/skills/drizzle-migrations/SKILL.md',
  },
  {
    id: 'tsconfig-paths',
    description:
      'TypeScript package resolution uses workspace exports, never tsconfig paths aliases.',
    paths: ['**/tsconfig*.json'],
    kind: 'mechanical',
    source: 'AGENTS.md#typescript-configuration-rules',
  },
  {
    id: 'tsconfig-project-graph',
    description:
      'Nx syncs the composite project-reference graph; Vite projects use a glue tsconfig with separate source and spec configs and outputs.',
    paths: ['**/tsconfig*.json', 'nx.json'],
    kind: 'semantic',
    source: 'AGENTS.md#vite-nx-multi-tsconfig-layout',
  },
  {
    id: 'build-cache-outputs',
    description:
      'Build outputs and typecheck outputs follow the project group; dist and out-tsc do not overlap.',
    paths: ['**/tsconfig*.json', 'nx.json', '**/package.json'],
    kind: 'semantic',
    source: 'AGENTS.md#build-cache-contract-three-groups',
  },
  {
    id: 'workspace-dependencies',
    description:
      'In-repo dependencies use workspace:* and catalogued third-party dependencies use catalog:; apply the published-versus-bundled dependency policy.',
    paths: ['**/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'],
    kind: 'semantic',
    source: 'AGENTS.md#adding-a-new-workspace',
  },
  {
    id: 'package-exports',
    description:
      'Workspace imports resolve through source conditional exports; published packages also provide dist fallbacks. Private reviewer libraries may omit main/types and build scripts.',
    paths: ['**/package.json'],
    kind: 'semantic',
    source: 'AGENTS.md#typescript-configuration-rules',
  },
  {
    id: 'nx-project-tasks',
    description:
      'Use Nx-resolved project tasks and standard package scripts; confirm test-ci inference for projects with tests. A package script may itself be an inferred Nx target.',
    paths: [
      '**/package.json',
      '**/project.json',
      '**/vitest.config.ts',
      'nx.json',
    ],
    kind: 'semantic',
    source: 'AGENTS.md#quick-start',
  },
  {
    id: 'vite-action-build',
    description:
      'Bundled GitHub Actions use Vite SSR on Node 22+, emit dist, typecheck to out-tsc, and expose check:externals.',
    paths: [
      'packages/*-action/package.json',
      'packages/*-action/vite.config.ts',
      'packages/*-action/tsconfig*.json',
    ],
    kind: 'semantic',
    source: 'AGENTS.md#bundle-externals-must-be-declared',
  },
  {
    id: 'eslint-boundaries',
    description:
      'ESLint enforces Nx tag and browser/server import boundaries, typed promises, type-only imports, and sorting. Review config edits for weakened enforcement; let lint report ordinary violations.',
    paths: ['eslint.config.mjs', '**/eslint.config.mjs', 'nx.json'],
    kind: 'semantic',
    source: 'eslint.config.mjs',
  },
  {
    id: 'source-config-env',
    description:
      'Read process.env through a source config.ts module; the Pi extension has an explicit exception.',
    paths: [
      'apps/**/src/**/*.ts',
      'libs/**/src/**/*.ts',
      'packages/**/src/**/*.ts',
      'apps/**/src/**/*.tsx',
      'libs/**/src/**/*.tsx',
      'packages/**/src/**/*.tsx',
    ],
    kind: 'mechanical',
    source: 'eslint.config.mjs',
  },
  {
    id: 'test-dynamic-import',
    description:
      'Tests use static imports; dynamic import is reserved for explicit vi.resetModules environment reloads.',
    paths: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.test.tsx',
      '**/*.spec.tsx',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
    ],
    kind: 'mechanical',
    source: 'AGENTS.md#code-style',
  },
  {
    id: 'test-structure',
    description:
      'Meaningful Vitest tests follow Arrange, Act, Assert and cover changed behavior rather than mirroring implementation.',
    paths: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.test.tsx',
      '**/*.spec.tsx',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.tsx',
    ],
    kind: 'semantic',
    source: 'AGENTS.md#code-style',
  },
  {
    id: 'fixture-secretlint',
    description:
      'Fake credentials use a rule-scoped inline Secretlint suppression with a reason; whole-file disables and .secretlintignore entries are not acceptable.',
    paths: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/fixtures/**',
      '**/.secretlintrc*',
      '.secretlintignore',
    ],
    kind: 'semantic',
    source: 'docs/contribute/secret-scanning.md#false-positives',
  },
  {
    id: 'runtime-typebox',
    description:
      'Changed HTTP, MCP, or webhook trust boundaries validate external input with TypeBox schemas.',
    paths: [
      'apps/rest-api/src/**/*.ts',
      'apps/mcp-server/src/**/*.ts',
      'libs/mcp-*/src/**/*.ts',
    ],
    kind: 'semantic',
    source: 'AGENTS.md#code-style',
  },
  {
    id: 'fastify-plugin',
    description:
      'Cross-cutting Fastify behavior belongs in plugins, with route-specific logic in routes or handlers.',
    paths: ['apps/rest-api/src/**/*.ts', 'apps/mcp-server/src/**/*.ts'],
    kind: 'semantic',
    source: 'AGENTS.md#code-style',
  },
  {
    id: 'database-repository',
    description:
      'Application data access uses the repository layer rather than scattering direct database queries across routes or workflows.',
    paths: ['apps/**/src/**/*.ts', 'libs/**/src/**/*.ts'],
    kind: 'semantic',
    source: 'AGENTS.md#code-style',
  },
  {
    id: 'db-transaction',
    description:
      'Repository writes use getExecutor(db) to preserve the active transaction; do not launch DBOS workflows inside runTransaction.',
    paths: [
      'libs/database/src/repositories/**/*.ts',
      'libs/**/src/workflows/**/*.ts',
    ],
    kind: 'semantic',
    source: '.agents/skills/rendered-pack-6e1e24d4/SKILL.md',
  },
  {
    id: 'db-embedding',
    description:
      'Ordinary repository reads omit the 384-dimensional embedding column unless the query actually needs it.',
    paths: ['libs/database/src/repositories/**/*.ts'],
    kind: 'semantic',
    source: '.agents/skills/rendered-pack-6e1e24d4/SKILL.md',
  },
  {
    id: 'tenant-scope',
    description:
      'ID lookups with team or diary scope combine both filters with AND; verify reachability before alleging a security regression.',
    paths: [
      'libs/database/src/repositories/**/*.ts',
      'apps/rest-api/src/**/*.ts',
      'apps/mcp-server/src/**/*.ts',
    ],
    kind: 'semantic',
    source: '.agents/skills/rendered-pack-6e1e24d4/SKILL.md',
  },
  {
    id: 'e2e-api-client',
    description:
      'E2E requests for in-spec endpoints use @moltnet/api-client. Raw fetch is allowed for health, OAuth/token/auth/register, and documented spec gaps.',
    paths: [
      'apps/**/e2e/**/*.ts',
      'apps/*-e2e/src/**/*.ts',
      'libs/mcp-test-harness/**/*.ts',
    ],
    kind: 'semantic',
    source: '.agents/skills/rendered-pack-bba8dca4/SKILL.md',
  },
  {
    id: 'ui-design-system',
    description:
      'Consumer UI uses design-system components and theme tokens; design-system internals are an exception to the import rule.',
    paths: [
      'apps/console/src/**/*.tsx',
      'libs/*-ui/src/**/*.tsx',
      'libs/design-system/src/**/*.tsx',
    ],
    kind: 'semantic',
    source: 'docs/contribute/design-system.md',
  },
  {
    id: 'ui-accessibility',
    description:
      'Interactive UI preserves native control semantics, accessible names and state, keyboard focus, and reduced-motion behavior.',
    paths: [
      'apps/console/src/**/*.tsx',
      'libs/*-ui/src/**/*.tsx',
      'libs/design-system/src/**/*.tsx',
    ],
    kind: 'semantic',
    source: 'docs/contribute/accessibility.md',
  },
  {
    id: 'docs-accessibility',
    description:
      'Docs use meaningful alt text and link labels, context around code and Mermaid, and absolute dates where time matters.',
    paths: ['docs/**/*.md', 'docs/**/*.mdx'],
    kind: 'semantic',
    source: 'docs/contribute/accessibility.md',
  },
  {
    id: 'docs-canonical',
    description:
      'Onboarding and use docs extend the canonical page and cross-link instead of duplicating guidance; keep user-facing tone.',
    paths: ['docs/start/**/*.md', 'docs/use/**/*.md', 'docs/reference/**/*.md'],
    kind: 'semantic',
    source: '.agents/skills/rendered-pack-5bf21e8c/SKILL.md',
  },
  {
    id: 'review-workflow-trust',
    description:
      'Review automation executes trusted pinned runtime code, treats PR head as inert Git data, and publishes through the App identity.',
    paths: [
      '.github/workflows/*review*.yml',
      'libs/*review*/**',
      'packages/*review-action/**',
    ],
    kind: 'semantic',
    source: '.github/workflows/docs-impact-review.yml',
  },
];
