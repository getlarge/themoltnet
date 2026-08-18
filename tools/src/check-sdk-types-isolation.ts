#!/usr/bin/env tsx
/**
 * Verify @themoltnet/sdk's published declarations from a consumer's viewpoint.
 *
 * The SDK dist is staged into a throwaway node_modules using the real
 * `publishConfig.exports` map, so both checks resolve entries exactly the way
 * an installed consumer does. Two independent compilations run against it:
 *
 * 1. Isolation — imports only the root entry, with `skipLibCheck: false` and no
 *    Node typings. Catches unresolvable `@moltnet/*` imports (#257) and Node
 *    globals leaking into the isomorphic root surface.
 * 2. Cross-entry — imports `.`, `/node` and `/human` in ONE program under
 *    NodeNext, the way a real consumer does. Catches per-entry declaration
 *    duplication (#1928): a type reached through two entries must be a single
 *    type, and every type an entry names in its signatures must be exported by
 *    that entry.
 *
 * Check 2 is the one that was missing: single-entry programs cannot observe
 * either defect, because both only appear once two entries meet in one program.
 *
 * Usage:
 *   tsx tools/src/check-sdk-types-isolation.ts
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const sdkRoot = join(root, 'libs/sdk');
const sdkDist = join(sdkRoot, 'dist');
const sdkTypesEntry = join(sdkDist, 'index.d.ts');

if (!existsSync(sdkTypesEntry)) {
  console.error(
    `SDK dist types not found at ${sdkTypesEntry}. ` +
      'Run "pnpm exec nx run @themoltnet/sdk:build" before running this script.',
  );
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(join(sdkRoot, 'package.json'), 'utf8'),
) as { name: string; version: string; publishConfig?: { exports?: unknown } };

if (!manifest.publishConfig?.exports) {
  console.error(
    'libs/sdk/package.json has no publishConfig.exports — cannot stage the ' +
      'published entry layout that consumers actually resolve.',
  );
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'sdk-types-isolation-'));
const stagedPkg = join(tmpDir, 'node_modules', '@themoltnet', 'sdk');

interface TypecheckCase {
  readonly name: string;
  readonly description: string;
  readonly consumer: string;
  readonly compilerOptions: Record<string, unknown>;
}

const cases: readonly TypecheckCase[] = [
  {
    name: 'isolation',
    description:
      'root entry resolves without @moltnet/* packages or Node typings',
    consumer: `import type { Agent, EntriesNamespace } from '@themoltnet/sdk';
import { MoltNetError, connect, updateOAuth2Config } from '@themoltnet/sdk';

declare const _agent: Agent;
declare const _entries: EntriesNamespace;
const _err: MoltNetError = new MoltNetError('test', { code: 'TEST' });
const _connect: typeof connect = connect;
const _updateOAuth2Config: typeof updateOAuth2Config = updateOAuth2Config;
void _agent;
void _entries;
void _err;
void _connect;
void _updateOAuth2Config;
`,
    compilerOptions: {
      // No @types/node: the root entry is isomorphic and must not name
      // Node globals. skipLibCheck stays off so the whole rollup is checked.
      types: [],
      skipLibCheck: false,
    },
  },
  {
    name: 'cross-entry',
    description:
      'types reached through two entries are one type, and each entry exports what it names',
    consumer: `import type { Agent, HumanClient } from '@themoltnet/sdk';
import type { Agent as AgentFromNode } from '@themoltnet/sdk/node';
import { connect } from '@themoltnet/sdk/node';
import type { HumanClient as HumanClientFromHuman } from '@themoltnet/sdk/human';
import { connectHuman } from '@themoltnet/sdk/human';

// Every type an entry names in its exported signatures must be exported by that
// entry, or a consumer cannot annotate against it (TS2459).
declare const nodeAgent: AgentFromNode;
declare const humanClient: HumanClientFromHuman;

// A type reached through two entries must be a single type (TS2345/TS2322).
export const agentAcrossEntries: Agent = nodeAgent;
export const humanAcrossEntries: HumanClient = humanClient;

// The shape a real consumer writes: hand /node's connect() to a root-typed API.
export function takesRootAgent(agent: Agent): Agent {
  return agent;
}
export async function build(): Promise<Agent> {
  return takesRootAgent(await connect());
}
export const human: HumanClient = connectHuman();
`,
    compilerOptions: {
      // A real Node consumer: Node typings present, skipLibCheck on. The issue
      // reproduced with skipLibCheck: true, so it must not be relied on here.
      types: ['node'],
      typeRoots: [join(root, 'node_modules/@types')],
      skipLibCheck: true,
    },
  },
];

try {
  mkdirSync(stagedPkg, { recursive: true });
  symlinkSync(sdkDist, join(stagedPkg, 'dist'), 'dir');
  writeFileSync(
    join(stagedPkg, 'package.json'),
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        type: 'module',
        exports: manifest.publishConfig.exports,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'sdk-types-consumer', type: 'module' }, null, 2),
  );

  let failed = false;

  for (const testCase of cases) {
    const caseDir = join(tmpDir, testCase.name);
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(join(caseDir, 'consumer.ts'), testCase.consumer);
    writeFileSync(
      join(caseDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          ...testCase.compilerOptions,
        },
        include: ['consumer.ts'],
      }),
    );

    try {
      execFileSync(
        join(root, 'node_modules/.bin/tsc'),
        ['--project', join(caseDir, 'tsconfig.json')],
        { cwd: caseDir, stdio: 'inherit' },
      );
      console.log(`✓ ${testCase.name}: ${testCase.description}`);
    } catch {
      console.error(`✗ ${testCase.name}: ${testCase.description}`);
      failed = true;
    }
  }

  if (failed) {
    console.error(
      '\nSDK published type check failed. Common causes:\n' +
        '  isolation   — @moltnet/* or Node globals leaked into dist/index.d.ts\n' +
        '  cross-entry — an entry re-declares types the root entry already owns,\n' +
        '                so the same type has two identities (see issue #1928)\n',
    );
    process.exit(1);
  }

  console.log('\n✓ SDK published types are consistent across entries');
  process.exit(0);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
