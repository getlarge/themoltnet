#!/usr/bin/env node
/**
 * Build the immutable macOS ARM64 qemu-img runtime consumed by agent bundles.
 *
 * This is an update-time tool, not part of normal daemon releases. It builds
 * the exact official QEMU source recorded in qemu-runtime-source.json, vendors
 * the non-system dylib closure, exercises Gondolin's create/info/resize calls,
 * and emits a release archive whose digest is pinned by the agent bundle.
 */
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import {
  assertMinimumMacos,
  download,
  isNativeForHost,
  sha256File,
  vendorQemuImg,
} from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sourceConfig = JSON.parse(
  readFileSync(join(here, 'qemu-runtime-source.json'), 'utf8'),
);

function parseArgs(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      cache: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    console.log('usage: build-qemu-runtime.mjs [--out DIR] [--cache DIR]');
    process.exit(0);
  }
  return {
    out: resolve(values.out ?? 'dist/qemu-runtime'),
    cache: resolve(
      values.cache ?? join(homedir(), 'Library/Caches/moltnet/qemu-runtime'),
    ),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

async function ensureDownload(url, expectedSha256, destination) {
  if (!existsSync(destination)) await download(url, destination);
  const actual = sha256File(destination);
  if (actual !== expectedSha256) {
    rmSync(destination, { force: true });
    throw new Error(
      `checksum mismatch for ${basename(destination)}: ${actual} != ${expectedSha256}`,
    );
  }
}

function verifyOfficialSignature(source, signature, work) {
  const gnupg = join(work, 'gnupg');
  mkdirSync(gnupg, { mode: 0o700 });
  run('gpg', [
    '--homedir',
    gnupg,
    '--batch',
    '--import',
    join(here, 'qemu-release-key.asc'),
  ]);
  const status = run('gpg', [
    '--homedir',
    gnupg,
    '--batch',
    '--no-autostart',
    '--status-fd',
    '1',
    '--verify',
    signature,
    source,
  ]);
  const validFingerprint = /\[GNUPG:\] VALIDSIG ([A-F0-9]{40})\b/.exec(
    status,
  )?.[1];
  if (validFingerprint !== sourceConfig.signerFingerprint) {
    throw new Error(
      `QEMU signature fingerprint ${validFingerprint ?? 'missing'} != ${sourceConfig.signerFingerprint}`,
    );
  }
}

function dependency(name) {
  const entry = sourceConfig.dependencies.find((dep) => dep.name === name);
  if (!entry) throw new Error(`qemu-runtime-source.json has no ${name}`);
  return entry;
}

function readWrap(path) {
  const fields = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^(\w+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

// GLib's own wraps supply these, pinned by hash inside the GLib tarball, so
// nothing is taken from the build host's Homebrew prefix.
const GLIB_FALLBACKS = ['libffi', 'proxy-libintl', 'pcre2'];

/**
 * Build qemu-img's library closure from pinned sources into `prefix`, every
 * object linked for `minimumMacosVersion`. Homebrew bottles carry the build
 * host's macOS as their floor, so they cannot be vendored.
 */
function buildDependencies(work, sources, buildEnv) {
  const prefix = join(work, 'deps');
  const env = { ...buildEnv, PKG_CONFIG_LIBDIR: join(prefix, 'lib/pkgconfig') };
  const extract = (name) => {
    const dir = join(work, `${name}-source`);
    mkdirSync(dir);
    run('tar', ['-xf', sources[name], '--strip-components', '1', '-C', dir]);
    return dir;
  };

  const zstd = extract('zstd');
  run(
    'make',
    [
      '-C',
      join(zstd, 'lib'),
      'install-pc',
      'install-includes',
      'install-shared',
      `PREFIX=${prefix}`,
    ],
    { env },
  );

  const glib = extract('glib');
  const glibBuild = join(work, 'glib-build');
  run(
    'meson',
    [
      'setup',
      glibBuild,
      `--prefix=${prefix}`,
      '--libdir=lib',
      ...dependency('glib').mesonArgs,
    ],
    { cwd: glib, env },
  );
  run('meson', ['compile', '-C', glibBuild], { env });
  run('meson', ['install', '-C', glibBuild], { env });

  const fallbacks = GLIB_FALLBACKS.map((name) => {
    const wrap = readWrap(join(glib, 'subprojects', `${name}.wrap`));
    return {
      name,
      directory: wrap.directory,
      sourceUrl: wrap.source_url,
      sourceSha256: wrap.source_hash,
      root: join(glib, 'subprojects', wrap.directory),
    };
  });
  return { prefix, env, roots: { zstd, glib }, fallbacks };
}

function exerciseQemuImg(binary, work) {
  const image = join(work, 'smoke.qcow2');
  run(binary, ['create', '-q', '-f', 'qcow2', image, '16M']);
  run(binary, ['info', '--output=json', image]);
  run(binary, ['resize', image, '24M']);
  const size = JSON.parse(run(binary, ['info', '--output=json', image]))[
    'virtual-size'
  ];
  if (size !== 24 * 1024 * 1024) {
    throw new Error(`qemu-img resize smoke test reported ${size} bytes`);
  }
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      `qemu runtime must be built natively on darwin-arm64, got ${process.platform}-${process.arch}`,
    );
  }
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  mkdirSync(args.cache, { recursive: true });

  const sourceName = basename(sourceConfig.sourceUrl);
  const source = join(args.cache, sourceName);
  const signature = `${source}.sig`;
  await ensureDownload(
    sourceConfig.sourceUrl,
    sourceConfig.sourceSha256,
    source,
  );
  await ensureDownload(
    sourceConfig.signatureUrl,
    sourceConfig.signatureSha256,
    signature,
  );
  const dependencySources = {};
  for (const dep of sourceConfig.dependencies) {
    const path = join(args.cache, basename(dep.sourceUrl));
    await ensureDownload(dep.sourceUrl, dep.sourceSha256, path);
    dependencySources[dep.name] = path;
  }

  const work = mkdtempSync(join(tmpdir(), 'moltnet-qemu-runtime-'));
  try {
    verifyOfficialSignature(source, signature, work);
    const sourceDir = join(work, 'source');
    const buildDir = join(work, 'build');
    mkdirSync(sourceDir);
    mkdirSync(buildDir);
    run('tar', ['-xf', source, '--strip-components', '1', '-C', sourceDir]);

    const deps = buildDependencies(work, dependencySources, {
      MACOSX_DEPLOYMENT_TARGET: sourceConfig.minimumMacosVersion,
    });
    run(join(sourceDir, 'configure'), sourceConfig.configureArgs, {
      cwd: buildDir,
      env: deps.env,
    });
    run('ninja', ['qemu-img'], { cwd: buildDir, env: deps.env });

    const builtBinary = join(buildDir, 'qemu-img');
    const version = run(builtBinary, ['--version']).split('\n')[0];
    if (version !== `qemu-img version ${sourceConfig.qemuVersion}`) {
      throw new Error(`unexpected built version: ${version}`);
    }

    const rootName = `moltnet-qemu-runtime-${sourceConfig.platform}`;
    const root = join(work, rootName);
    mkdirSync(root);
    vendorQemuImg(root, builtBinary);
    const nativePaths = listFiles(join(root, 'vendor')).filter((path) =>
      isNativeForHost(path, { os: 'darwin', arch: 'arm64' }),
    );
    assertMinimumMacos(nativePaths, sourceConfig.minimumMacosVersion);
    exerciseQemuImg(join(root, 'vendor/qemu-img'), work);

    const fallback = (name) =>
      deps.fallbacks.find((entry) => entry.name === name);
    const licenseSources = {
      qemu: [sourceDir, ['COPYING', 'COPYING.LIB']],
      glib: [deps.roots.glib, dependency('glib').licenseFiles],
      pcre2: [fallback('pcre2').root, ['LICENCE.md']],
      'proxy-libintl': [fallback('proxy-libintl').root, ['COPYING']],
      zstd: [deps.roots.zstd, dependency('zstd').licenseFiles],
    };
    for (const [name, [from, files]] of Object.entries(licenseSources)) {
      const licenses = join(root, 'vendor/licenses', name);
      mkdirSync(licenses, { recursive: true });
      for (const file of files) {
        copyFileSync(join(from, file), join(licenses, file));
      }
    }
    writeFileSync(
      join(root, 'vendor/THIRD_PARTY_NOTICES.md'),
      `# Third-party runtime components

This runtime contains QEMU \`${sourceConfig.qemuVersion}\`, built from the official
source archive retained with the MoltNet GitHub release. QEMU is distributed
under GPL-2.0-only.

The dynamically linked runtime closure is built from pinned sources, copied
into \`lib/\`, and pinned by per-file SHA-256 in \`provenance.json\`. Each
component's license texts are in \`licenses/<component>/\`:

- GLib ${dependency('glib').version} — LGPL-2.1-or-later — https://gitlab.gnome.org/GNOME/glib
- PCRE2 (\`${fallback('pcre2').directory}\`, statically linked into GLib) — BSD-3-Clause — https://github.com/PCRE2Project/pcre2
- proxy-libintl (\`${fallback('proxy-libintl').directory}\`) — LGPL-2.0-or-later — https://github.com/frida/proxy-libintl
- Zstandard ${dependency('zstd').version} — BSD-3-Clause OR GPL-2.0-only — https://github.com/facebook/zstd
`,
    );

    const compiler = run('xcrun', ['clang', '--version']).split('\n')[0];
    const dependencies = [
      ...sourceConfig.dependencies.map(
        ({ name, version, sourceUrl, sourceSha256 }) => ({
          name,
          version,
          sourceUrl,
          sourceSha256,
        }),
      ),
      ...deps.fallbacks.map(({ name, directory, sourceUrl, sourceSha256 }) => ({
        name,
        directory,
        sourceUrl,
        sourceSha256,
        via: 'glib wrap',
      })),
    ];
    const nativeFiles = nativePaths.map((path) => ({
      path: relative(root, path),
      bytes: statSync(path).size,
      sha256: sha256File(path),
    }));
    writeFileSync(
      join(root, 'vendor/provenance.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          runtimeVersion: sourceConfig.runtimeVersion,
          platform: sourceConfig.platform,
          minimumMacosVersion: sourceConfig.minimumMacosVersion,
          qemu: {
            version: sourceConfig.qemuVersion,
            sourceUrl: sourceConfig.sourceUrl,
            sourceSha256: sourceConfig.sourceSha256,
            signatureUrl: sourceConfig.signatureUrl,
            signatureSha256: sourceConfig.signatureSha256,
            signerFingerprint: sourceConfig.signerFingerprint,
            signatureNote: sourceConfig.signatureNote,
          },
          build: {
            configureArgs: sourceConfig.configureArgs,
            compiler,
            meson: run('meson', ['--version']),
            dependencies,
          },
          nativeFiles,
        },
        null,
        2,
      )}\n`,
    );

    const archiveName = `${rootName}.tar.gz`;
    const archive = join(args.out, archiveName);
    run('tar', ['-czf', archive, '-C', work, rootName], {
      env: { COPYFILE_DISABLE: '1' },
    });
    const digest = sha256File(archive);
    writeFileSync(`${archive}.sha256`, `${digest}  ${archiveName}\n`);
    copyFileSync(source, join(args.out, sourceName));
    copyFileSync(signature, join(args.out, basename(signature)));
    console.log(`${archive}\nsha256 ${digest}`);
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
