import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // The pnpm-managed Nx plugin patch reads targetDefaults/configurations and
  // resolves commands from Nx's workspace-root cwd. Keep knip-nx.spec.ts green
  // when upgrading; remove the patch once upstream covers these cases.
  ignore: [
    'dist/**',
    '**/dist/**',
    // Deliberately incomplete source used as eval input.
    'evals/moltnet-practices/**/fixtures/**',
    // Standalone consumer example installed independently of this workspace.
    'examples/custom-pi-runtime/**',
  ],
  // Infrastructure files are not imported but are used externally
  ignoreFiles: ['infra/**'],
  // Provisioned toolchains and a shell function, not npm packages.
  ignoreBinaries: [
    'go',
    'gofmt',
    'cmake',
    'ctest',
    'gpg',
    'moltnet',
    'verify_with_published_key',
  ],

  workspaces: {
    '.': {
      entry: [
        '.agents/skills/monitor-ci/scripts/*.mjs',
        'examples/*.ts',
        'test-fixtures/generate-*-vectors.mjs',
      ],
    },
    tools: {
      // Operator commands and CI scripts invoked indirectly by shell wrappers.
      entry: [
        'db/*.ts',
        'release/{docker-preversion,self-host-smoke,self-host-smoke-prepare}.mjs',
        'release/agent-desktop/{manifest,verify-published-assets}.mjs',
        'renovate/format-pnpm-workspace.mjs',
        'src/tasks/{read-task-output,seed-judge-fixture}.ts',
        'src/codex-environment/probe.ts',
      ],
      ignoreFiles: ['*.d.mts'],
    },
    // ── Apps ──
    'apps/agent-daemon': { entry: ['test-fixtures/*.{ts,mjs}'] },
    'apps/agent-desktop': { entry: ['scripts/test-store-root.mjs'] },
    'apps/agent-desktop-e2e': {
      // Load as source: native config intentionally throws outside its launcher.
      entry: [
        'wdio.*.conf.ts',
        'src/{chrome,native}-entry.ts',
        'src/fixtures/*.{ts,mjs}',
      ],
      ignoreDependencies: [
        '@wdio/local-runner',
        '@wdio/mocha-framework',
        '@wdio/spec-reporter',
      ],
    },
    'apps/mcp-host': { entry: ['server.mjs'] },
    'apps/orchestration-e2e': {
      entry: ['src/fixtures/process-recovery-worker.ts'],
    },
    'apps/rest-api-e2e': {
      entry: [
        'src/fixtures/{invite-http-server,team-invite-recovery.worker}.ts',
      ],
    },
    'apps/mcp-server': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'apps/rest-api': {
      entry: ['__tests__/**/*.spec.ts', 'scripts/*.ts', 'src/migrate.ts'],
    },

    // ── Libs ──
    'libs/api-client': {
      entry: ['openapi-ts.config.ts', 'openapi-bindings.config.ts'],
      // Generated code — exports are intentionally broad (full API surface)
      ignore: ['src/generated/**', 'src/generated-api-bindings/**'],
      ignoreDependencies: [],
    },
    'libs/agent-config': { entry: ['__tests__/fixtures/*-writer.ts'] },
    'libs/sdk': { entry: ['__tests__/fixtures/config-repair.ts'] },
    'libs/cpp-sdk': { entry: ['e2e/setup.ts'] },
    'libs/n8n-nodes-moltnet': {
      // Template files copied into a standalone consumer repository.
      ignore: ['standalone/overlay/**'],
    },
    'libs/shell-command-analyzer': {
      entry: ['src/default-wasm-loader.browser.ts'],
    },
    'libs/task-ui': { entry: ['demo/main.tsx'] },
    'libs/auth': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/crypto-service': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/database': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/design-system': {
      entry: ['demo/{main.tsx,vite.config.ts}'],
      project: ['src/**/*.{ts,tsx}', 'demo/**/*.{ts,tsx}'],
    },
    'libs/diary-service': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/models': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/mcp-auth-proxy': {
      entry: ['__tests__/**/*.spec.ts'],
    },
    'libs/observability': {
      entry: ['__tests__/**/*.spec.ts'],
      ignoreDependencies: [
        // Used as pino transport targets (string references, not imports)
        'pino-opentelemetry-transport',
        'pino-pretty',
      ],
    },
  },
};

export default config;
