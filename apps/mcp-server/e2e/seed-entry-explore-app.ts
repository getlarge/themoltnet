/**
 * Seed local e2e data for manual MCP Apps entry exploration testing.
 *
 * Requires the e2e Docker stack to be running:
 *   COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
 */

import { networkInterfaces } from 'node:os';

import { createClient, createDiaryEntry } from '@moltnet/api-client';

import { connectMcpTestClient, parseToolResult } from './mcp-client.js';
import { createMcpTestHarness } from './setup.js';

interface EntryExploreOpenResult {
  exploration_id: string;
  diary_id: string;
  diary_name: string;
  surface_html: string;
  surface_state: {
    visibleEntries: Array<{ id: string; title: string | null }>;
    pivots: Array<{
      id: string;
      label: string;
      action: { kind: string; value: string };
    }>;
    topTags: Array<{ tag: string; count: number }>;
  };
}

interface SeedEntryInput {
  title: string;
  content: string;
  entryType:
    | 'episodic'
    | 'semantic'
    | 'procedural'
    | 'reflection'
    | 'identity'
    | 'soul';
  importance: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  tags: string[];
}

function findReachableHost(): string {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.family === 'IPv4' &&
        !entry.internal &&
        entry.address !== '127.0.0.1'
      ) {
        return entry.address;
      }
    }
  }
  return 'localhost';
}

async function seedDiaryEntries(
  accessToken: string,
  teamId: string,
  diaryId: string,
  restApiUrl: string,
): Promise<void> {
  const client = createClient({ baseUrl: restApiUrl });
  const entries: SeedEntryInput[] = [
    {
      title: 'Identity notes for a future profile pack',
      content:
        'Sketching identity traits, long-term preferences, and recurring personal themes for later curation.',
      entryType: 'identity',
      importance: 9,
      tags: ['identity', 'profile', 'curation'],
    },
    {
      title: 'Exploring how to describe autonomy',
      content:
        'Loose exploration of autonomy, responsibility, and how to share those ideas with humans and agents.',
      entryType: 'reflection',
      importance: 8,
      tags: ['autonomy', 'ideas', 'reflection'],
    },
    {
      title: 'Product direction for visual diary browsing',
      content:
        'Thoughts about making a large diary feel closer to browsing a photo library than scrolling a log.',
      entryType: 'semantic',
      importance: 9,
      tags: ['product', 'ux', 'entry-exploration'],
    },
    {
      title: 'AI collaboration patterns',
      content:
        'Notes about sharing explorations with humans and agents without forcing everything into technical workflows.',
      entryType: 'procedural',
      importance: 7,
      tags: ['agents', 'humans', 'collaboration'],
    },
    {
      title: 'Open questions around packs',
      content:
        'Early curation questions: what belongs together, what should remain separate, and how to avoid overload.',
      entryType: 'reflection',
      importance: 8,
      tags: ['packs', 'curation', 'questions'],
    },
    {
      title: 'Personal diary fragment on direction',
      content:
        'A more personal fragment about where this work feels energizing and which paths seem too operational.',
      entryType: 'soul',
      importance: 7,
      tags: ['personal', 'direction', 'energy'],
    },
  ];

  for (const entry of entries) {
    const { error } = await createDiaryEntry({
      client,
      auth: () => accessToken,
      path: { diaryId },
      headers: { 'x-moltnet-team-id': teamId },
      body: entry,
    });
    if (error) {
      throw new Error(`createDiaryEntry failed: ${JSON.stringify(error)}`);
    }
  }
}

async function main(): Promise<void> {
  const harness = await createMcpTestHarness();
  const client = await connectMcpTestClient(
    harness,
    'seed-entry-explore-app-client',
  );

  try {
    await seedDiaryEntries(
      harness.agent.accessToken,
      harness.personalTeamId,
      harness.privateDiaryId,
      harness.restApiUrl,
    );

    const openResult = await client.callTool({
      name: 'entries_explore_open',
      arguments: {
        diary_id: harness.privateDiaryId,
        sample_limit: 48,
      },
    });
    const { content, parsed } =
      parseToolResult<EntryExploreOpenResult>(openResult);
    if (openResult.isError) {
      throw new Error(`entries_explore_open failed: ${content[0]?.text}`);
    }

    const firstPivot = parsed.surface_state.pivots[0] ?? null;
    const firstTag = parsed.surface_state.topTags[0]?.tag ?? null;
    const firstEntryId = parsed.surface_state.visibleEntries[0]?.id ?? null;
    const reachableHost = findReachableHost();
    const hostMcpUrl = `http://${reachableHost}:8001/mcp`;

    const summary = {
      mcp_url: `${harness.mcpBaseUrl}/mcp`,
      basic_host_servers_env: JSON.stringify([hostMcpUrl]),
      console_url: 'http://localhost:5174',
      auth_headers: {
        'X-Client-Id': harness.agent.clientId,
        'X-Client-Secret': harness.agent.clientSecret,
      },
      basic_host_env: {
        SERVERS: JSON.stringify([hostMcpUrl]),
        VITE_MCP_CLIENT_ID: harness.agent.clientId,
        VITE_MCP_CLIENT_SECRET: harness.agent.clientSecret,
      },
      basic_host_start_example:
        `SERVERS='${JSON.stringify([hostMcpUrl])}' ` +
        `VITE_MCP_CLIENT_ID='${harness.agent.clientId}' ` +
        `VITE_MCP_CLIENT_SECRET='${harness.agent.clientSecret}' npm run dev`,
      private_diary_id: harness.privateDiaryId,
      entries_explore_open: {
        diary_id: harness.privateDiaryId,
        sample_limit: 48,
      },
      opened_exploration: {
        exploration_id: parsed.exploration_id,
        diary_name: parsed.diary_name,
        visible_entry_count: parsed.surface_state.visibleEntries.length,
        first_entry_id: firstEntryId,
        first_pivot: firstPivot,
        first_tag: firstTag,
      },
      entries_explore_refine_examples: {
        query: {
          exploration_id: parsed.exploration_id,
          query: 'identity and autonomy ideas',
        },
        tag: firstTag
          ? {
              exploration_id: parsed.exploration_id,
              include_tag: firstTag,
            }
          : null,
        pivot: firstPivot
          ? {
              exploration_id: parsed.exploration_id,
              [firstPivot.action.kind === 'query' ? 'query' : 'include_tag']:
                firstPivot.action.value,
            }
          : null,
        reset: {
          exploration_id: parsed.exploration_id,
          reset: true,
        },
      },
      host_notes: [
        'If basic-host runs on a different device or origin, use SERVERS from this output instead of localhost.',
        'Connect ext-apps basic-host to mcp_url.',
        'Call entries_explore_open with entries_explore_open to render the entry exploration UI.',
        'Use entries_explore_refine_examples.query or .tag to manually verify refinement.',
        'The MCP App itself should also trigger entries_explore_refine when you click pivots, tags, or search.',
      ],
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
    await harness.teardown();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
