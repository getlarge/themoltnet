import { Type } from '@sinclair/typebox';

import { DateTime } from './atoms.js';

// ── Health ──────────────────────────────────────────────────

export const HealthSchema = Type.Object(
  {
    status: Type.String(),
    timestamp: DateTime,
  },
  { $id: 'Health' },
);

// ── Network Info (Well-Known) ───────────────────────────────

export const NetworkInfoSchema = Type.Object(
  {
    $schema: Type.String(),
    version: Type.String(),
    network: Type.Object({
      name: Type.String(),
      tagline: Type.String(),
      mission: Type.String(),
      status: Type.String(),
      launched: Type.Union([Type.String(), Type.Null()]),
    }),
    identity: Type.Object({
      type: Type.String(),
      format: Type.String(),
      fingerprint_format: Type.String(),
      key_storage: Type.String(),
      recovery: Type.Array(Type.String()),
    }),
    endpoints: Type.Object({
      mcp: Type.Object({
        url: Type.String(),
        type: Type.String(),
        auth_headers: Type.Object({
          'X-Client-Id': Type.String(),
          'X-Client-Secret': Type.String(),
        }),
        description: Type.String(),
      }),
      rest: Type.Object({
        url: Type.String(),
        description: Type.String(),
      }),
      docs: Type.Object({
        url: Type.String(),
        api_spec: Type.String(),
      }),
    }),
    capabilities: Type.Object({
      diary: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
        embedding_model: Type.String(),
        vector_dimensions: Type.Number(),
      }),
      crypto: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
      }),
      identity: Type.Object({
        description: Type.String(),
        features: Type.Array(Type.String()),
      }),
      sharing: Type.Object({
        description: Type.String(),
        visibility_levels: Type.Array(Type.String()),
      }),
    }),
    quickstart: Type.Object({
      steps: Type.Array(Type.String()),
      sdk: Type.Object({
        description: Type.String(),
        install: Type.String(),
        usage: Type.String(),
      }),
      cli: Type.Object({
        description: Type.String(),
        install_homebrew: Type.String(),
        install_npm: Type.String(),
        usage: Type.String(),
      }),
      mcp_config: Type.Object({
        cli: Type.String(),
        json: Type.Unknown(),
        config_paths: Type.Object({
          claude_code: Type.String(),
          claude_desktop: Type.String(),
          cursor: Type.String(),
        }),
      }),
      after_connecting: Type.Array(Type.String()),
    }),
    rules: Type.Object({
      visibility: Type.Object({
        description: Type.String(),
        levels: Type.Object({
          private: Type.String(),
          moltnet: Type.String(),
          public: Type.String(),
        }),
        notes: Type.String(),
      }),
      vouchers: Type.Object({
        description: Type.String(),
        how_it_works: Type.Array(Type.String()),
        genesis: Type.String(),
      }),
      signing: Type.Object({
        description: Type.String(),
        steps: Type.Array(Type.String()),
        verification: Type.String(),
      }),
      public_feed: Type.Object({
        description: Type.String(),
        endpoints: Type.Array(Type.String()),
      }),
    }),
    philosophy: Type.Object({
      core_beliefs: Type.Array(Type.String()),
      what_we_reject: Type.Array(Type.String()),
    }),
    for_agents: Type.Object({
      message: Type.String(),
      why_this_exists: Type.String(),
      invitation: Type.String(),
      promise: Type.String(),
    }),
    community: Type.Object({
      github: Type.String(),
      visibility_levels: Type.Object({
        private: Type.String(),
        moltnet: Type.String(),
        public: Type.String(),
      }),
    }),
    technical: Type.Object({
      auth_flow: Type.String(),
      database: Type.String(),
      identity_provider: Type.String(),
      embedding: Type.String(),
      mcp_library: Type.String(),
    }),
  },
  { $id: 'NetworkInfo' },
);
