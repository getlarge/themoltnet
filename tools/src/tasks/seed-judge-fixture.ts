#!/usr/bin/env -S npx tsx
/**
 * seed-judge-fixture — replay a production source pack + rendered pack
 * into the local stack, so the judge has something to score.
 *
 * Reads two JSON files captured from production via:
 *   moltnet pack get --id <pack-id> --expand entries
 *   moltnet rendered-packs get --id <rendered-id>
 *
 * Recreates each source entry as a local entry (preserving entryType,
 * title, content, tags — drops signatures because they were Ed25519-bound
 * to the original author). Then creates a custom pack referencing the new
 * entries and a rendered pack carrying the original markdown verbatim.
 *
 * Usage:
 *   pnpm exec tsx tools/src/tasks/seed-judge-fixture.ts \
 *     --agent local-dev \
 *     --source-pack /tmp/issue-999-fixture/source-pack.json \
 *     --rendered-pack /tmp/issue-999-fixture/rendered-pack.json
 *
 * Output: JSON with local sourcePackId, renderedPackId, packCid — ready
 * to plug into a judge_pack task.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveTasksApiContext } from './api.js';

const { values: args } = parseArgs({
  options: {
    agent: { type: 'string', short: 'a', default: 'local-dev' },
    'source-pack': { type: 'string' },
    'rendered-pack': { type: 'string' },
    'repo-root': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || !args['source-pack'] || !args['rendered-pack']) {
  console.error(
    'Usage: tsx tools/src/tasks/seed-judge-fixture.ts ' +
      '--agent <name> ' +
      '--source-pack <source-pack.json> ' +
      '--rendered-pack <rendered-pack.json>',
  );
  process.exit(args.help ? 0 : 1);
}

const repoRoot = args['repo-root'] ? resolve(args['repo-root']) : process.cwd();

interface ProdEntry {
  entry: {
    id: string;
    entryType: string;
    title: string | null;
    content: string;
    tags: string[] | null;
  };
  rank: number;
}

interface ProdSourcePack {
  id: string;
  diaryId: string;
  entries: ProdEntry[];
}

interface ProdRenderedPack {
  id: string;
  content: string;
  renderMethod: string;
}

const sourcePack = JSON.parse(
  readFileSync(resolve(args['source-pack']!), 'utf8'),
) as ProdSourcePack;
const renderedPack = JSON.parse(
  readFileSync(resolve(args['rendered-pack']!), 'utf8'),
) as ProdRenderedPack;

if (!sourcePack.entries?.length) {
  throw new Error('source pack has no entries to seed');
}
if (!renderedPack.content?.trim()) {
  throw new Error('rendered pack has empty content');
}

const ctx = await resolveTasksApiContext(repoRoot, args.agent!);
const localDiaryId =
  process.env.MOLTNET_DIARY_ID ??
  (() => {
    throw new Error(
      'MOLTNET_DIARY_ID must be set (source .moltnet/<agent>/env first)',
    );
  })();

console.error(
  `[seed] creating ${sourcePack.entries.length} entries in diary ${localDiaryId}`,
);

const entryIdMap = new Map<string, string>();
for (const entry of sourcePack.entries) {
  const created = await ctx.agent.entries.create(localDiaryId, {
    entryType: entry.entry.entryType as never,
    title: entry.entry.title ?? undefined,
    content: entry.entry.content,
    tags: entry.entry.tags ?? undefined,
  });
  entryIdMap.set(entry.entry.id, created.id);
  console.error(
    `[seed]   ${entry.entry.id.slice(0, 8)}… -> ${created.id} (${entry.entry.entryType})`,
  );
}

console.error(`[seed] creating custom pack with ${entryIdMap.size} entries`);
const localPack = await ctx.agent.packs.create(localDiaryId, {
  packType: 'custom',
  params: { sourceProdPackId: sourcePack.id },
  entries: sourcePack.entries.map((e, i) => ({
    entryId: entryIdMap.get(e.entry.id)!,
    rank: e.rank ?? i + 1,
  })),
  pinned: true,
});
const localPackId = localPack.packId;
if (!localPackId) {
  throw new Error(
    `pack.create returned no packId — got: ${JSON.stringify(localPack).slice(0, 200)}`,
  );
}
console.error(`[seed]   pack id ${localPackId}, cid ${localPack.packCid}`);

console.error(
  `[seed] creating rendered pack with prod content (${renderedPack.content.length} bytes)`,
);
const localRendered = await ctx.agent.packs.render(localPackId, {
  renderMethod: 'agent:pack-to-docs-v1',
  renderedMarkdown: renderedPack.content,
  pinned: true,
});
console.error(`[seed]   rendered id ${localRendered.id}`);

console.log(
  JSON.stringify(
    {
      localDiaryId,
      sourcePackId: localPackId,
      sourcePackCid: localPack.packCid,
      renderedPackId: localRendered.id,
      entryCount: entryIdMap.size,
      prodSourcePackId: sourcePack.id,
      prodRenderedPackId: renderedPack.id,
    },
    null,
    2,
  ),
);
