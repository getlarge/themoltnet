import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const entry = resolve('dist/verify.js');
if (!existsSync(entry)) {
  throw new Error('dist/verify.js is missing; build the package first');
}

const forbidden = [
  /@themoltnet\/ctap/u,
  /\bnode-hid\b/u,
  /(?:from|import\()\s*['"]cbor['"]/u,
  /(?:from|import\()\s*['"]node:/u,
];
const imports = /(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/gu;
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
        `${file} pulls a Node-only transport/CBOR dependency into ./verify`,
      );
    }
  }
  for (const match of source.matchAll(imports)) {
    const specifier = match[1];
    if (!specifier) continue;
    const dependency = resolve(dirname(file), specifier);
    if (dependency.endsWith('.js') && existsSync(dependency)) {
      pending.push(dependency);
    }
  }
}

process.stdout.write(
  `Verified isomorphic ./verify graph (${visited.size} JavaScript files)\n`,
);
