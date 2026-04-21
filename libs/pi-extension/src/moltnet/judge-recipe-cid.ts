import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PACKAGE_DIR = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);
const SELF_PACKAGE_NAME = '@themoltnet/pi-extension';
const PI_PACKAGE_NAME = '@mariozechner/pi-coding-agent';
const SDK_PACKAGE_NAME = '@themoltnet/sdk';
const CID_VERSION = 0x01;
const RAW_CODEC = 0x55;
const SHA2_256_CODE = 0x12;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

interface PackageJsonLike {
  name?: unknown;
  version?: unknown;
}

export interface PiJudgeRecipeVersions {
  pi: string | null;
  piExtension: string | null;
  sdk: string | null;
}

export interface PiJudgeRecipeInputs {
  judgePrompt: string;
  rubric: string;
  skillFragment?: string | null;
  implementationSource?: string | null;
  promptAsset?: string | null;
  rubricAsset?: string | null;
  skillSourcePath?: string | null;
  overrides?: Partial<PiJudgeRecipeVersions>;
}

export interface PiJudgeRecipeManifest {
  kind: 'pi-judge-recipe/v1';
  versions: PiJudgeRecipeVersions;
  assets: {
    promptAsset: string | null;
    rubricAsset: string | null;
    skillSourcePath: string | null;
  };
  hashes: {
    judgePromptSha256: string;
    rubricSha256: string;
    skillFragmentSha256: string | null;
    implementationSha256: string | null;
  };
}

export interface PiJudgeRecipeCid {
  cid: string;
  manifest: PiJudgeRecipeManifest;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let current = value >>> 0;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current);
  return bytes;
}

function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return `b${output}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`,
    );

  return `{${entries.join(',')}}`;
}

function readPackageVersion(pkgPath: string, expectedName?: string): string | null {
  if (!existsSync(pkgPath)) return null;

  const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonLike;
  if (expectedName && parsed.name !== expectedName) return null;
  return typeof parsed.version === 'string' ? parsed.version : null;
}

function resolveInstalledPackageVersion(packageName: string): string | null {
  try {
    let current = path.dirname(require.resolve(packageName));
    while (true) {
      const candidate = path.join(current, 'package.json');
      const version = readPackageVersion(candidate, packageName);
      if (version) return version;

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolvePiJudgeRecipeVersions(): PiJudgeRecipeVersions {
  return {
    pi: resolveInstalledPackageVersion(PI_PACKAGE_NAME),
    piExtension: readPackageVersion(
      path.join(PACKAGE_DIR, 'package.json'),
      SELF_PACKAGE_NAME,
    ),
    sdk: resolveInstalledPackageVersion(SDK_PACKAGE_NAME),
  };
}

export function buildPiJudgeRecipeManifest(
  inputs: PiJudgeRecipeInputs,
): PiJudgeRecipeManifest {
  const versions = {
    ...resolvePiJudgeRecipeVersions(),
    ...inputs.overrides,
  };

  return {
    kind: 'pi-judge-recipe/v1',
    versions,
    assets: {
      promptAsset: inputs.promptAsset ?? null,
      rubricAsset: inputs.rubricAsset ?? null,
      skillSourcePath: inputs.skillSourcePath ?? null,
    },
    hashes: {
      judgePromptSha256: sha256Hex(inputs.judgePrompt),
      rubricSha256: sha256Hex(inputs.rubric),
      skillFragmentSha256: inputs.skillFragment
        ? sha256Hex(inputs.skillFragment)
        : null,
      implementationSha256: inputs.implementationSource
        ? sha256Hex(inputs.implementationSource)
        : null,
    },
  };
}

export function computePiJudgeRecipeCid(
  inputs: PiJudgeRecipeInputs,
): PiJudgeRecipeCid {
  const manifest = buildPiJudgeRecipeManifest(inputs);
  const manifestBytes = Buffer.from(stableStringify(manifest), 'utf8');
  const digestBytes = createHash('sha256').update(manifestBytes).digest();
  const cidBytes = Uint8Array.from([
    ...encodeVarint(CID_VERSION),
    ...encodeVarint(RAW_CODEC),
    ...encodeVarint(SHA2_256_CODE),
    ...encodeVarint(digestBytes.length),
    ...digestBytes,
  ]);
  const cid = base32Lower(cidBytes);
  return { cid, manifest };
}
