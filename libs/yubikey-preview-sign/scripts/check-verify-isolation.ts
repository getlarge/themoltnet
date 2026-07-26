import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const verifyForbidden = [
  /@themoltnet\/ctap/u,
  /\bnode-hid\b/u,
  /(?:from|import\()\s*['"]cbor['"]/u,
  /(?:from|import\()\s*['"]node:/u,
];
const protocolForbidden = [
  /(?:from|import\()\s*['"]@themoltnet\/ctap['"]/u,
  /\bnode-hid\b/u,
];
const imports = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/gu;

function resolveDependency(
  file: string,
  specifier: string,
  sourceGraph: boolean,
): string | undefined {
  const dependency = resolve(dirname(file), specifier);
  if (existsSync(dependency)) return dependency;
  if (sourceGraph && dependency.endsWith('.js')) {
    const sourceDependency = `${dependency.slice(0, -3)}.ts`;
    if (existsSync(sourceDependency)) return sourceDependency;
  }
  return undefined;
}

function checkIsolation(
  entry: string,
  label: './verify' | './protocol',
  forbidden: RegExp[],
  options: { sourceGraph?: boolean } = {},
): number {
  if (!existsSync(entry)) {
    throw new Error(`${entry} is missing`);
  }
  const visited = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file) break;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        throw new Error(
          `${file} pulls a forbidden transport dependency into ${label}`,
        );
      }
    }
    for (const match of source.matchAll(imports)) {
      const specifier = match[1];
      if (!specifier) continue;
      const dependency = resolveDependency(
        file,
        specifier,
        options.sourceGraph === true,
      );
      if (dependency) pending.push(dependency);
    }
  }
  return visited.size;
}

export function checkVerifyIsolation(
  entry: string,
  options: { sourceGraph?: boolean } = {},
): number {
  return checkIsolation(entry, './verify', verifyForbidden, options);
}

export function checkProtocolIsolation(
  entry: string,
  options: { sourceGraph?: boolean } = {},
): number {
  return checkIsolation(entry, './protocol', protocolForbidden, options);
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const entry = resolve('dist/verify.js');
  const protocolEntry = resolve('dist/protocol.js');
  if (!existsSync(entry)) {
    throw new Error('dist/verify.js is missing; build the package first');
  }
  if (!existsSync(protocolEntry)) {
    throw new Error('dist/protocol.js is missing; build the package first');
  }
  const visited = checkVerifyIsolation(entry);
  const protocolVisited = checkProtocolIsolation(protocolEntry);
  process.stdout.write(
    `Verified isomorphic ./verify graph (${visited} JavaScript files) and hardware-free server ./protocol graph (${protocolVisited} JavaScript files)\n`,
  );
}
