/**
 * Manual-testing fixture for the diary map MCP app (issue #1194).
 *
 * Mints a throwaway agent against the RUNNING local e2e stack, seeds a handful
 * of namespaced-tag entries, builds a `entries_map_open` payload with a couple
 * of pre-interpreted zones, and prints a ready-to-open mcp-host URL. The agent +
 * diary persist in the stack (teardown only closes the DB pool), so the printed
 * URL stays valid for the life of the stack.
 *
 * Prereq: the e2e stack must be up (it runs the dockerized mcp-host on :8082):
 *   COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
 *
 * Run (from repo root):
 *   pnpm exec nx run @moltnet/mcp-host-e2e:diary-map-fixture
 * or directly:
 *   pnpm --filter @moltnet/mcp-host-e2e exec tsx manual/diary-map-fixture.ts
 *
 * Then open the printed URL in a browser. See apps/mcp-host/README.md.
 */
import { writeFile } from 'node:fs/promises';

import { createMcpTestHarness } from '@moltnet/mcp-test-harness';

const HOST_BASE = process.env.MCP_HOST_URL ?? 'http://localhost:8082';

interface SeedSpec {
  content: string;
  title: string;
  tags: string[];
  entryType: 'semantic' | 'episodic' | 'procedural' | 'reflection';
}

const SEED: SeedSpec[] = [
  {
    title: 'Chose Drizzle migrations over raw SQL',
    content:
      'Decided to manage the schema with Drizzle migrations rather than hand-written SQL, for type-safe diffs and a reviewable migration log.',
    tags: ['scope:infra', 'topic:database', 'decision'],
    entryType: 'semantic',
  },
  {
    title: 'Adopted Ory Keto for authorization',
    content:
      'Authorization is modeled in Ory Keto (relation tuples) instead of in-app role checks, so policy lives outside the services.',
    tags: ['scope:infra', 'scope:auth', 'decision'],
    entryType: 'semantic',
  },
  {
    title: 'Postgres + pgvector for hybrid search',
    content:
      'Picked Postgres with pgvector so semantic + full-text search share one store; avoids a separate vector DB to operate.',
    tags: ['scope:infra', 'topic:database', 'topic:search'],
    entryType: 'semantic',
  },
  {
    title: 'Reflected on agent autonomy boundaries',
    content:
      'Thinking through how much an agent should decide alone vs. ask the human — leaning toward explicit, auditable accountability over silent autonomy.',
    tags: ['topic:autonomy', 'reflection'],
    entryType: 'reflection',
  },
  {
    title: 'Identity is cryptographic, not account-based',
    content:
      'An agent owns an Ed25519 key; identity and signatures are the source of truth, not a human-owned account row.',
    tags: ['topic:autonomy', 'topic:identity', 'decision'],
    entryType: 'semantic',
  },
  {
    title: 'Rejected a server-side LLM for exploration',
    content:
      'Considered running interpretation on the server; rejected it to keep the server deterministic and retrieval-only. The client agent interprets.',
    tags: ['topic:research', 'scope:mcp-apps', 'decision'],
    entryType: 'semantic',
  },
  {
    title: 'MCP app foundation moved to ext-apps',
    content:
      'UI apps now build on @modelcontextprotocol/ext-apps in dedicated Vite libs, with a host fixture + browser e2e.',
    tags: ['scope:mcp-apps', 'topic:research'],
    entryType: 'procedural',
  },
];

async function main() {
  const harness = await createMcpTestHarness();
  const { agent, privateDiaryId, restApiUrl, personalTeamId } = harness;

  async function seed(spec: SeedSpec): Promise<string> {
    const response = await fetch(
      `${restApiUrl}/diaries/${privateDiaryId}/entries`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${agent.accessToken}`,
          'x-moltnet-team-id': personalTeamId,
        },
        body: JSON.stringify(spec),
      },
    );
    if (!response.ok) {
      throw new Error(
        `seed failed: ${response.status} ${await response.text()}`,
      );
    }
    return ((await response.json()) as { id: string }).id;
  }

  const ids = await Promise.all(SEED.map(seed));
  const idOf = (titlePart: string) =>
    ids[SEED.findIndex((s) => s.title.includes(titlePart))];

  // A pre-interpreted map with three zones, mirroring what the agent would push.
  const map = {
    diaryName: 'Manual fixture diary',
    totalEntries: SEED.length,
    sampledEntries: SEED.length,
    overview:
      'A small diary with three zones: infrastructure decisions, autonomy & identity, and research/MCP-app work.',
    zones: [
      {
        id: 'infra',
        label: 'Infrastructure decisions',
        why: 'Database, search, and authorization choices that shape the stack.',
        territory: 'scope:infra',
        entryIds: [idOf('Drizzle'), idOf('Keto'), idOf('pgvector')],
        provenance: {
          basis: 'tag:scope:infra',
          searches: [{ tags: ['scope:infra'] }],
        },
      },
      {
        id: 'autonomy',
        label: 'Autonomy & identity',
        why: 'Reflections and decisions about agent autonomy and cryptographic identity.',
        territory: 'topic:autonomy',
        entryIds: [idOf('autonomy boundaries'), idOf('cryptographic')],
        provenance: {
          basis: 'tag:topic:autonomy',
          searches: [{ tags: ['topic:autonomy'] }],
        },
      },
      {
        id: 'research',
        label: 'Research & MCP apps',
        why: 'Exploration of the MCP app foundation and design research.',
        territory: 'scope:mcp-apps',
        entryIds: [idOf('server-side LLM'), idOf('ext-apps')],
        provenance: {
          basis: 'tag:scope:mcp-apps',
          searches: [{ tags: ['scope:mcp-apps'] }],
        },
      },
    ],
  };

  const url = new URL('/', HOST_BASE);
  url.searchParams.set('tool', 'entries_map_open');
  url.searchParams.set('autorun', '1');
  url.searchParams.set('server', `${harness.mcpBaseUrl}/mcp`);
  url.searchParams.set('clientId', agent.clientId);
  // Throwaway fixture credentials for a local ephemeral stack ONLY. Putting a
  // secret in URL params leaks it to browser history / logs / Referer headers —
  // never do this with real agent credentials.
  url.searchParams.set('clientSecret', agent.clientSecret);
  url.searchParams.set(
    'args',
    JSON.stringify({ diary_id: privateDiaryId, map }),
  );

  await harness.teardown(); // closes the DB pool; the agent + diary persist.

  // Write the URL to a file too — copying a 1.7k single-line URL out of a
  // terminal/chat is error-prone (spaces/line-breaks corrupt the JSON args).
  const outFile = new URL('./diary-map-url.txt', import.meta.url);
  await writeFile(outFile, url.toString() + '\n', 'utf8');

  // eslint-disable-next-line no-console
  console.log('\n=== Diary map manual fixture ready ===');
  // eslint-disable-next-line no-console
  console.log(`agent fingerprint : ${agent.keyPair.fingerprint}`);
  // eslint-disable-next-line no-console
  console.log(`diary id          : ${privateDiaryId}`);
  // eslint-disable-next-line no-console
  console.log(`seeded entries    : ${ids.length}`);
  // eslint-disable-next-line no-console
  console.log(
    '\nURL written to apps/mcp-host-e2e/manual/diary-map-url.txt' +
      ' (cat it / scp it to avoid copy corruption).',
  );
  // eslint-disable-next-line no-console
  console.log(
    '\nOver SSH, forward the ports first:\n' +
      '  ssh -L 8082:localhost:8082 -L 8083:localhost:8083 -L 8001:localhost:8001 <host>\n' +
      'then open (the dockerized mcp-host on :8082):\n',
  );
  // eslint-disable-next-line no-console
  console.log(url.toString());
  // eslint-disable-next-line no-console
  console.log('');
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    error instanceof Error ? error.message : String(error),
    '\n\nIs the e2e stack up? Run:\n  COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build',
  );
  process.exit(1);
});
