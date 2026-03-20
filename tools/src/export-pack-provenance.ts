#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateRawSync } from 'node:zlib';

import { connect } from '@themoltnet/sdk';

import { resolveRepoRoot } from './repo.js';

function printUsage(): void {
  console.error(`Usage: pnpm --filter @moltnet/tools graph:provenance [options]

Options:
  --pack-id <uuid>        Export provenance rooted at a persisted pack id
  --pack-cid <cid>        Export provenance rooted at a persisted pack CID
  --diary-id <uuid>       Resolve the newest pack in a diary when --pack-id is omitted
  --credentials <path>    Path to moltnet.json credentials file
  --config-dir <path>     MoltNet config directory (defaults to ~/.config/moltnet)
  --api-url <url>         API base URL (default resolved by SDK)
  --depth <n>             Follow pack supersession ancestry to this depth (default: 2)
  --out <path>            Write JSON to file instead of stdout
  --share-url <base>      Print a shareable viewer URL (e.g. https://themolt.net/labs/provenance)
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      'pack-id': { type: 'string' },
      'pack-cid': { type: 'string' },
      'diary-id': { type: 'string' },
      credentials: { type: 'string' },
      'config-dir': { type: 'string' },
      'api-url': { type: 'string' },
      depth: { type: 'string', default: '2' },
      out: { type: 'string' },
      'share-url': { type: 'string' },
    },
    strict: true,
  });

  const packIdArg =
    typeof values['pack-id'] === 'string' ? values['pack-id'] : undefined;
  const packCidArg =
    typeof values['pack-cid'] === 'string' ? values['pack-cid'] : undefined;
  const diaryIdArg =
    typeof values['diary-id'] === 'string' ? values['diary-id'] : undefined;

  const rootSelectors = [packIdArg, packCidArg, diaryIdArg].filter(Boolean);
  if (rootSelectors.length !== 1) {
    printUsage();
    throw new Error('Pass exactly one of --pack-id, --pack-cid, or --diary-id');
  }

  const depth = Number.parseInt(String(values.depth ?? '2'), 10);
  if (!Number.isFinite(depth) || depth < 0) {
    throw new Error('--depth must be a non-negative integer');
  }

  // Resolve config directory: --credentials (file) takes precedence,
  // then --config-dir (directory). Relative paths are resolved from repo root.
  let configDir: string | undefined;
  if (typeof values.credentials === 'string') {
    const credPath = isAbsolute(values.credentials)
      ? values.credentials
      : resolve(await resolveRepoRoot(), values.credentials);
    configDir = dirname(credPath);
  } else if (typeof values['config-dir'] === 'string') {
    configDir = isAbsolute(values['config-dir'])
      ? values['config-dir']
      : resolve(await resolveRepoRoot(), values['config-dir']);
  }

  const agent = await connect({
    apiUrl:
      typeof values['api-url'] === 'string' ? values['api-url'] : undefined,
    configDir,
  });
  let graph;

  if (packIdArg) {
    graph = await agent.packs.getProvenance(packIdArg, { depth });
  } else if (packCidArg) {
    graph = await agent.packs.getProvenanceByCid(packCidArg, { depth });
  } else {
    // diaryIdArg is guaranteed non-null here by the rootSelectors check above
    const list = await agent.packs.list(diaryIdArg as string, { limit: 1 });
    const pack = list.items[0];
    if (!pack) {
      throw new Error(`No persisted packs found for diary ${diaryIdArg}`);
    }
    graph = await agent.packs.getProvenance(pack.id, { depth });
  }

  const serialized = `${JSON.stringify(graph, null, 2)}\n`;
  const outPath = typeof values.out === 'string' ? values.out : undefined;
  const shareBase =
    typeof values['share-url'] === 'string' ? values['share-url'] : undefined;

  if (shareBase) {
    const compact = JSON.stringify(graph);
    const compressed = deflateRawSync(compact);
    const param = compressed
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const url = `${shareBase.replace(/\/$/, '')}?graph=${param}`;
    if (param.length > 8000) {
      console.error(
        `[graph:provenance] warning: URL param is ${param.length} bytes — may exceed browser limits`,
      );
    }
    process.stdout.write(`${url}\n`);
    return;
  }

  if (outPath) {
    await writeFile(outPath, serialized, 'utf8');
    console.error(`[graph:provenance] wrote ${outPath}`);
    return;
  }

  process.stdout.write(serialized);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
