import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseAllDocuments } from 'yaml';

const sections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'packageManagerDependencies',
  'configDependencies',
];
const sorted = (items) => [...new Set(items)].sort();
const identity = (key) => key.split('(')[0];
const code = (text) =>
  `\`${String(text).replaceAll('`', 'ˋ').replaceAll('\n', ' ').replaceAll('\r', ' ')}\``;

function indexLockfile(text) {
  const versions = new Map();
  const overrides = new Map();
  const parents = new Map();
  const declarations = new Map();
  const nodes = new Map();
  const documents = parseAllDocuments(text).map((document) => {
    if (document.errors.length) throw document.errors[0];
    const lock = document.toJS();
    if (Number(lock?.lockfileVersion) !== 9) {
      throw new Error('Expected a pnpm v9 lockfile document');
    }
    return lock;
  });

  if (!documents.length) throw new Error('Expected a pnpm lockfile');
  for (const [documentIndex, lock] of documents.entries()) {
    for (const [name, range] of Object.entries(lock.overrides ?? {})) {
      overrides.set(name, range);
    }
    for (const key of Object.keys(lock.packages ?? {})) {
      const nameAndVersion = identity(key);
      const at = nameAndVersion.lastIndexOf('@');
      if (at <= 0) throw new Error(`Unsupported package key: ${key}`);
      const name = nameAndVersion.slice(0, at);
      const version = nameAndVersion.slice(at + 1);
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(version);
    }
    for (const key of Object.keys(lock.snapshots ?? {})) {
      nodes.set(`${documentIndex}:${key}`, key);
    }
  }

  // Resolve exact snapshot references, preserving peer contexts in the graph.
  const dependencyNode = (name, reference, documentIndex) => {
    const version =
      typeof reference === 'string' ? reference : reference?.version;
    if (!version || /^(link:|workspace:)/.test(version)) return undefined;
    return [`${name}@${version}`, version.replace(/^npm:/, '')]
      .map((key) => `${documentIndex}:${key}`)
      .find((key) => nodes.has(key));
  };
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const [documentIndex, lock] of documents.entries()) {
    for (const [parent, snapshot] of Object.entries(lock.snapshots ?? {})) {
      for (const section of ['dependencies', 'optionalDependencies']) {
        for (const [name, ref] of Object.entries(snapshot[section] ?? {})) {
          const child = dependencyNode(name, ref, documentIndex);
          if (child) add(parents, child, `${documentIndex}:${parent}`);
        }
      }
    }
    for (const [importer, manifest] of Object.entries(lock.importers ?? {})) {
      for (const section of sections) {
        for (const [name, ref] of Object.entries(manifest[section] ?? {})) {
          const child = dependencyNode(name, ref, documentIndex);
          if (child) {
            add(
              declarations,
              child,
              `${importer} / ${section} / ${name} (${ref.specifier ?? 'resolved'})`,
            );
          }
        }
      }
    }
  }
  return { versions, overrides, parents, declarations, nodes };
}

function consumers(graph, name) {
  const display = (node) => identity(graph.nodes.get(node));
  const nodes = [...graph.nodes.keys()].filter((node) => {
    const key = display(node);
    return key.slice(0, key.lastIndexOf('@')) === name;
  });
  const paths = [];
  const grandparents = [];
  for (const node of nodes) {
    for (const parent of graph.parents.get(node) ?? []) {
      paths.push([display(parent), display(node)].join(' → '));
      for (const grandparent of graph.parents.get(parent) ?? []) {
        grandparents.push(
          [display(grandparent), display(parent), display(node)].join(' → '),
        );
      }
    }
  }

  // Traverse ancestors once per snapshot, not every possible dependency path.
  const visited = new Set(nodes);
  const declarations = [];
  for (const node of visited) {
    declarations.push(...(graph.declarations.get(node) ?? []));
    for (const parent of graph.parents.get(node) ?? []) visited.add(parent);
  }
  return {
    paths: sorted(paths),
    grandparents: sorted(grandparents),
    declarations: sorted(declarations),
  };
}

/** Pure lockfile comparison: no installs, registry queries or compatibility guesses. */
export function dependencyImpact(
  baseText,
  headText,
  { limit = Infinity } = {},
) {
  const base = indexLockfile(baseText);
  const head = indexLockfile(headText);
  const names = sorted([
    ...base.versions.keys(),
    ...head.versions.keys(),
  ]).filter(
    (name) =>
      JSON.stringify(sorted(base.versions.get(name) ?? [])) !==
      JSON.stringify(sorted(head.versions.get(name) ?? [])),
  );
  const lines = [
    '## Dependency impact',
    '',
    `${names.length} package(s) changed resolved versions.`,
    '',
    'Paths point from consumer to dependency; up to two parent levels are shown.',
    'Workspace declarations trace all ancestors and identify which direct dependencies to inspect.',
    'Catalog specifiers refer to pnpm-workspace.yaml; other declarations live in the indicated workspace package.json.',
    'This is lockfile evidence, not API compatibility, declared transitive ranges, or shipped-code analysis.',
    'Peer-only changes are excluded; peer variants are deduplicated for display.',
    '',
  ];
  const versionText = (graph, name) =>
    code(sorted(graph.versions.get(name) ?? []).join(', ') || 'absent');
  lines.push('### Changed overrides', '');
  const overrideNames = sorted([
    ...base.overrides.keys(),
    ...head.overrides.keys(),
  ]).filter((name) => base.overrides.get(name) !== head.overrides.get(name));
  for (const name of overrideNames) {
    lines.push(
      `- ${code(name)}: ${code(base.overrides.get(name) ?? 'absent')} → ${code(head.overrides.get(name) ?? 'absent')}`,
    );
  }
  if (!overrideNames.length) lines.push('None.');
  lines.push('', '### Resolved version changes', '');
  for (const name of names) {
    lines.push(
      `- ${code(name)}: ${versionText(base, name)} → ${versionText(head, name)}`,
    );
  }
  lines.push('');
  const list = (values, cap = limit) => {
    for (const value of values.slice(0, cap)) lines.push(`- ${code(value)}`);
    if (!values.length) lines.push('- None recorded.');
    if (values.length > cap) {
      lines.push(`- … ${values.length - cap} more in the full report.`);
    }
    lines.push('');
  };
  for (const name of names) {
    lines.push(`### ${code(name)}`, '');
    lines.push(
      `${code(sorted(base.versions.get(name) ?? []).join(', ') || 'absent')} → ${code(sorted(head.versions.get(name) ?? []).join(', ') || 'absent')}`,
      '',
    );
    lines.push(
      '<details>',
      '<summary>Parents, grandparents and workspace declarations</summary>',
      '',
    );
    for (const [label, graph] of [
      ['Before', base],
      ['After', head],
    ]) {
      const { paths, grandparents, declarations } = consumers(graph, name);
      lines.push(`**${label}: parents**`, '');
      list(paths, Infinity);
      lines.push(`**${label}: grandparents**`, '');
      list(grandparents);
      lines.push(`**${label}: workspace declarations**`, '');
      list(declarations);
    }
    lines.push('</details>', '');
  }
  return `${lines.join('\n')}\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [base, head, fullOutput, commentOutput] = process.argv.slice(2);
  if (!base || !head || !fullOutput || !commentOutput) {
    throw new Error(
      'Usage: dependency-impact.mjs BASE HEAD FULL.md COMMENT.md',
    );
  }
  const args = [readFileSync(base, 'utf8'), readFileSync(head, 'utf8')];
  writeFileSync(fullOutput, dependencyImpact(...args));
  const compact = dependencyImpact(...args, { limit: 12 });
  writeFileSync(
    commentOutput,
    compact.length > 50_000
      ? `${compact.slice(0, compact.lastIndexOf('\n', 49_000))}\n</details>\n\nReport truncated; see the full report artifact.\n`
      : compact,
  );
}
