#!/usr/bin/env node
/**
 * Regenerate `src/gtfobins.generated.ts` from the GTFOBins dataset.
 *
 * GTFOBins (https://gtfobins.github.io/, GPL-3.0-or-later) documents, per
 * binary, the abuse "functions" it exposes (shell, command, reverse-shell,
 * file-read, file-write, sudo, suid, …). We vendor that mapping verbatim so the
 * analyzer can classify a resolved executable as `escapable` using the real
 * dataset rather than a hand-picked list, and surface each binary's functions
 * to downstream policy / LLM inspection.
 *
 * Usage:
 *   node scripts/generate-gtfobins.mjs [<commit-sha>]
 *
 * With no argument the pinned commit below is used (deterministic). Pass a SHA
 * to bump the snapshot; update DEFAULT_COMMIT to persist the new pin.
 *
 * Requires `curl` and `tar` on PATH. Downloads the repo tarball at the pinned
 * commit (one request), extracts `_gtfobins/`, parses each file's YAML
 * frontmatter, and writes the generated module.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_COMMIT = 'acd524623f9c406acedd2754ebd9c2431f3675ad';
const REPO = 'GTFOBins/GTFOBins.github.io';

const commit = process.argv[2] ?? DEFAULT_COMMIT;
const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../src/gtfobins.generated.ts');

/**
 * Parse a GTFOBins entry's YAML frontmatter. Returns the abuse function names
 * declared under `functions:` (2-space-indented `name:` lines; list items and
 * deeper nesting are ignored) and any `alias:` target. Frontmatter is delimited
 * by a leading `---` and a trailing `---` or `...`.
 */
function parseEntry(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l === '---');
  if (start === -1) {
    return { functions: [], alias: null };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end);

  const aliasLine = body.find((l) => /^alias:\s*\S/.test(l));
  const alias = aliasLine ? aliasLine.replace(/^alias:\s*/, '').trim() : null;

  const names = [];
  const fnStart = body.findIndex((l) => l.trimEnd() === 'functions:');
  if (fnStart !== -1) {
    for (let i = fnStart + 1; i < body.length; i++) {
      const line = body[i];
      if (line.length > 0 && !line.startsWith(' ')) {
        break; // dedented back to a top-level key
      }
      const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
      if (match) {
        names.push(match[1]);
      }
    }
  }
  return { functions: names, alias };
}

/**
 * Resolve `alias:` entries (e.g. `awk` → `mawk`) to the target's functions,
 * following single- or multi-level chains. Cycles fall back to own functions.
 */
function resolveFunctions(name, raw, seen = new Set()) {
  const entry = raw[name];
  if (!entry) {
    return [];
  }
  if (entry.functions.length > 0 || !entry.alias || seen.has(name)) {
    return entry.functions;
  }
  seen.add(name);
  return resolveFunctions(entry.alias, raw, seen);
}

function download(sha) {
  const dir = mkdtempSync(join(tmpdir(), 'gtfobins-'));
  const url = `https://codeload.github.com/${REPO}/tar.gz/${sha}`;
  // curl → tar, extracting only the _gtfobins directory.
  execFileSync(
    'sh',
    ['-c', `curl -fsSL "${url}" | tar -xz -C "${dir}" --strip-components=1 '*/_gtfobins'`],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return join(dir, '_gtfobins');
}

function main() {
  console.error(`Fetching GTFOBins @ ${commit} …`);
  const gtfobinsDir = download(commit);
  const files = readdirSync(gtfobinsDir).sort();

  const raw = {};
  for (const name of files) {
    raw[name] = parseEntry(readFileSync(join(gtfobinsDir, name), 'utf8'));
  }
  rmSync(dirname(gtfobinsDir), { recursive: true, force: true });

  const entries = files.map((name) => [name, resolveFunctions(name, raw)]);

  const body = entries
    .map(([name, fns]) => {
      const fnList = fns.map((f) => `'${f}'`).join(', ');
      return `  ${JSON.stringify(name)}: [${fnList}],`;
    })
    .join('\n');

  const out = `/**
 * GENERATED — DO NOT EDIT BY HAND. Run \`node scripts/generate-gtfobins.mjs\`.
 *
 * Vendored from GTFOBins (https://gtfobins.github.io/), GPL-3.0-or-later:
 *   https://github.com/${REPO} @ ${commit}
 *
 * Maps each GTFOBins binary to the abuse functions it documents (shell,
 * command, reverse-shell, file-read, file-write, sudo, suid, …). Presence in
 * this map classifies a resolved executable as \`escapable\`; the function list
 * is surfaced to the policy layer and any downstream LLM judge.
 */

/** GTFOBins commit this snapshot was generated from. */
export const GTFOBINS_SOURCE_COMMIT = '${commit}';

/** Binary name → GTFOBins abuse functions. */
export const GTFOBINS: Readonly<Record<string, readonly string[]>> = {
${body}
};
`;

  writeFileSync(outFile, out);

  // Format with the repo's Prettier so a regenerated file matches what the
  // commit hook would produce (no spurious diffs on re-run).
  try {
    execFileSync('pnpm', ['exec', 'prettier', '--write', outFile], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch {
    console.error('Warning: prettier formatting skipped (not available).');
  }

  console.error(`Wrote ${entries.length} entries to ${outFile}`);
}

main();
