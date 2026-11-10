import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignore: [
    'dist/**',
    '**/dist/**',
    // Deliberately incomplete source used as eval input.
    'evals/moltnet-practices/**/fixtures/**',
    // Seeded source copied into eval sandboxes and inspected by the agent.
    'evals-v2/*/workspace/**',
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

  // Generated client surfaces are owned by their OpenAPI generators. Keep
  // dependency and unresolved-import analysis enabled for those files.
  ignoreIssues: {
    'libs/{agent-daemon,signer}-api-client/src/generated/**': [
      'exports',
      'types',
    ],
  },

  workspaces: {
    '.': {
      entry: [
        '.agents/skills/monitor-ci/scripts/*.mjs',
        'examples/*.ts',
        'test-fixtures/generate-*-vectors.mjs',
        'infra/axiom/{dashboards,monitors}/apply.mjs',
      ],
      ignoreDependencies: [
        // Loaded by ID from .secretlintrc.json (no Knip Secretlint plugin).
        '@secretlint/secretlint-rule-azure',
        '@secretlint/secretlint-rule-pattern',
        '@secretlint/secretlint-rule-preset-recommend',
        // .husky/pre-commit resolves this executable through a shell variable.
        'lint-staged',
      ],
      ignoreBinaries: ['ory'], // Operator-installed Ory CLI.
    },
    tools: {
      // Operator commands and CI scripts invoked indirectly by shell wrappers.
      entry: [
        // Invoked through nx.json targetDefaults.
        'check-bundle-externals.mjs',
        'db/*.ts',
        'release/{docker-preversion,self-host-smoke,self-host-smoke-prepare}.mjs',
        'release/agent-desktop/{manifest,verify-published-assets}.mjs',
        'renovate/format-pnpm-workspace.mjs',
        'src/tasks/{read-task-output,seed-judge-fixture}.ts',
        'src/codex-environment/probe.ts',
        // Nx Release loads this default export by path from nx.json.
        'src/release/go-version-actions.ts',
      ],
      ignoreFiles: ['*.d.mts'],
      // OS tools used by release packaging and local agent provisioning.
      ignoreBinaries: ['brew', 'install_name_tool', 'otool', 'ssh-keygen'],
    },
    'packages/github-agent': {
      // The bundler traverses agent-config's crypto-service/ssh re-export.
      // The published-package boundary requires its Ed25519 dependency.
      ignoreDependencies: ['@noble/ed25519'],
    },
    // ── Apps ──
    'apps/agent-daemon': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: [
        '@earendil-works/gondolin',
        '@fastify/cors',
        '@fastify/helmet',
        '@fastify/otel',
        '@ipld/dag-cbor',
        '@noble/ciphers',
        '@noble/curves',
        '@noble/ed25519',
        '@noble/hashes',
        '@opentelemetry/instrumentation-dns',
        '@opentelemetry/instrumentation-http',
        '@opentelemetry/instrumentation-net',
        '@opentelemetry/instrumentation-pg',
        '@opentelemetry/instrumentation-pino',
        '@opentelemetry/instrumentation-runtime-node',
        '@opentelemetry/instrumentation-undici',
        '@opentelemetry/instrumentation',
        'fastify-plugin',
        'multiformats',
        'pino-opentelemetry-transport',
      ],
      entry: ['test-fixtures/*.{ts,mjs}'],
    },
    'apps/agent-desktop': { entry: ['scripts/test-store-root.mjs'] },
    'apps/agent-desktop-e2e': {
      // Executes the Tauri CLI owned by apps/agent-desktop using pnpm --dir.
      ignoreBinaries: ['tauri'],
      // Load as source: native config intentionally throws outside its launcher.
      entry: [
        // Nx commands use workspace-root paths; declare their owning workspace.
        '{build,run}-native.mjs',
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
    'apps/console-e2e': { entry: ['src/seed-diary-browser.ts'] },
    'apps/moltnet-signer': {
      // Runtime imports of bundled loopback-companion and CTAP transport.
      ignoreDependencies: ['@fastify/cors', '@fastify/helmet', 'node-hid'],
    },
    'apps/mcp-host': { entry: ['server.mjs'] },
    'apps/orchestration-e2e': {
      // Child-process worker uses node --import tsx.
      ignoreDependencies: ['tsx'],
      entry: ['src/fixtures/process-recovery-worker.ts'],
    },
    'apps/rest-api-e2e': {
      entry: [
        'src/fixtures/{invite-http-server,team-invite-recovery.worker}.ts',
      ],
    },
    'apps/mcp-server': {
      // Serves the built HTML asset through createRequire().resolve().
      ignoreDependencies: ['@moltnet/entry-explore-mcp-app'],
      entry: ['__tests__/**/*.spec.ts'],
    },
    'apps/rest-api': {
      // Runtime imports of bundled crypto-service, secret-scanner and tasks.
      ignoreDependencies: [
        '@noble/ed25519',
        '@secretlint/core',
        '@secretlint/secretlint-rule-azure',
        '@secretlint/secretlint-rule-pattern',
        '@secretlint/secretlint-rule-preset-recommend',
        'multiformats',
      ],
      entry: ['__tests__/**/*.spec.ts', 'scripts/*.ts', 'src/migrate.ts'],
    },

    'apps/issue-lifecycle': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: [
        '@ipld/dag-cbor',
        '@noble/curves',
        '@noble/ed25519',
        '@noble/hashes',
        'multiformats',
      ],
    },

    // ── Libs ──
    'libs/adaptive-review': {
      // Integration tests spawn these workers with node --import tsx.
      entry: ['__tests__/fixtures/{recovery-worker,retention-worker}.ts'],
      ignoreDependencies: ['tsx'],
    },
    'libs/agent-runtime': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: [
        '@ipld/dag-cbor',
        '@noble/ciphers',
        '@noble/curves',
        'multiformats',
      ],
    },

    'libs/pi-runtime': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: [
        '@ipld/dag-cbor',
        '@noble/curves',
        '@noble/hashes',
        '@secretlint/core',
        '@secretlint/secretlint-rule-azure',
        '@secretlint/secretlint-rule-pattern',
        '@secretlint/secretlint-rule-preset-recommend',
        'json5',
        'multiformats',
      ],
    },

    'libs/tasks-orchestrator': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: ['multiformats', 'typebox'],
    },

    'libs/api-client': {
      entry: [
        'openapi-ts.config.ts',
        'openapi-bindings.config.ts',
        // hey-api copies this client template into generated consumer code.
        'generator/api-bindings/index.ts',
      ],
      // Generated code — exports are intentionally broad (full API surface)
      ignore: ['src/generated/**', 'src/generated-api-bindings/**'],
      ignoreDependencies: [],
    },
    'libs/agent-config': { entry: ['__tests__/fixtures/*-writer.ts'] },
    'libs/bootstrap': {
      // generate:durable-fixture runs this from the workspace root.
      entry: ['src/testing/generate-conversation-fixture.ts'],
    },
    'libs/sdk': {
      // External runtime imports of bundled private libraries; also documented
      // in eslint.config.mjs and checked against the emitted package.
      ignoreDependencies: [
        '@ipld/dag-cbor',
        '@noble/ciphers',
        '@noble/hashes',
        'multiformats',
      ],
      entry: ['__tests__/fixtures/config-repair.ts'],
    },
    'libs/sandbox-gondolin': {
      ignoreBinaries: ['qemu-img'], // Installed with the VM toolchain.
    },
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
