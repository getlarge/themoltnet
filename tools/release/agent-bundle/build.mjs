#!/usr/bin/env node
/**
 * Assemble the self-contained `moltnet-agent` payload (#2063).
 *
 * Layout (runbook on #2063, "Step 1 — assemble the unsigned payload"):
 *
 *   moltnet-agent-<platform>/
 *     bin/moltnet-agent          launcher (sh) → libexec/moltnet-agent daemon/dist/main.js
 *     libexec/moltnet-agent      pinned official Node binary (re-signed later)
 *     daemon/                    @themoltnet/agent-daemon dist + production node_modules
 *                                (includes the per-platform gondolin-krun-runner package:
 *                                 the runner + libkrun.dylib live under node_modules)
 *     vendor/qemu-img            Homebrew qemu-img + its dylib closure (vendor/lib), relinked
 *                                to @executable_path/@loader_path — gondolin needs it on the host
 *     manifest.json              versions + sha256 of every executable/Mach-O for self-heal
 *
 * Why a runtime folder instead of a single binary: the 2026-09-01 spike showed
 * yao-pkg / Node SEA fight every native boundary (keytar's hard `.node`
 * require, gondolin's CJS `vendored-node-vfs` require, the platform runner
 * package) for no gain — the Keychain requester is the one re-signed
 * `libexec/moltnet-agent` either way.
 *
 * The payload must be assembled ON the target platform: `pnpm deploy` only
 * installs the host's optional platform packages (krun runner). CI builds
 * each platform on its own runner.
 *
 * Usage:
 *   node tools/release/agent-bundle/build.mjs [--out dist/agent-bundle]
 *        [--node 24.14.1] [--skip-daemon-build] [--pack]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const daemonRoot = join(repoRoot, 'apps/agent-daemon');

function parseArgs(argv) {
  const args = {
    out: join(repoRoot, 'dist/agent-bundle'),
    node: readPinnedNodeVersion(),
    skipDaemonBuild: false,
    pack: false,
    packOnly: false,
    qemuImg: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = resolve(argv[++i]);
    else if (arg === '--node') args.node = argv[++i];
    else if (arg === '--skip-daemon-build') args.skipDaemonBuild = true;
    else if (arg === '--pack') args.pack = true;
    else if (arg === '--pack-only') args.packOnly = true;
    else if (arg === '--no-qemu-img') args.qemuImg = false;
    else if (arg === '-h' || arg === '--help') {
      console.log(
        'usage: build.mjs [--out DIR] [--node VERSION] [--skip-daemon-build] [--no-qemu-img] [--pack | --pack-only]',
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readPinnedNodeVersion() {
  const toolVersions = readFileSync(join(repoRoot, '.tool-versions'), 'utf8');
  const match = /^nodejs\s+(\S+)/m.exec(toolVersions);
  if (!match) throw new Error('.tool-versions has no nodejs pin');
  return match[1];
}

function hostPlatform() {
  const os = process.platform;
  const arch = process.arch;
  if (!['darwin', 'linux'].includes(os) || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`unsupported host platform ${os}-${arch}`);
  }
  return { os, arch, id: `${os}-${arch}` };
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    ...options,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
  }
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status}: ${url}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(response.body, createWriteStream(destination));
}

/** Fetch (cached) the official Node tarball and verify it against SHASUMS256. */
async function fetchNodeBinary(version, platform, cacheDir) {
  const name = `node-v${version}-${platform.os}-${platform.arch}`;
  const tarball = join(cacheDir, `${name}.tar.gz`);
  const base = `https://nodejs.org/dist/v${version}`;
  if (!existsSync(tarball)) {
    console.log(`downloading ${base}/${name}.tar.gz`);
    await download(`${base}/${name}.tar.gz`, tarball);
  }
  const shasums = join(cacheDir, `SHASUMS256-v${version}.txt`);
  if (!existsSync(shasums)) await download(`${base}/SHASUMS256.txt`, shasums);
  const expected = readFileSync(shasums, 'utf8')
    .split('\n')
    .find((line) => line.endsWith(`  ${name}.tar.gz`))
    ?.split(/\s+/)[0];
  if (!expected) throw new Error(`no SHASUMS256 entry for ${name}.tar.gz`);
  const actual = sha256File(tarball);
  if (actual !== expected) {
    rmSync(tarball);
    throw new Error(`checksum mismatch for ${name}.tar.gz (${actual})`);
  }
  const extractDir = join(cacheDir, name);
  if (!existsSync(join(extractDir, 'bin/node'))) {
    mkdirSync(extractDir, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', extractDir, '--strip-components', '1']);
  }
  return join(extractDir, 'bin/node');
}

const MACHO_MAGICS = [
  0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xfeedface, 0xcefaedfe,
];
const ELF_MAGIC = 0x7f454c46;

/** Native code for THIS platform's loader: Mach-O on darwin, ELF on linux. */
function isNativeForHost(path, platform) {
  const fd = readFileSync(path);
  if (fd.length < 4) return false;
  const magic = fd.readUInt32BE(0);
  return platform.os === 'darwin'
    ? MACHO_MAGICS.includes(magic)
    : magic === ELF_MAGIC;
}

/**
 * Drop prebuilt addons for other platforms (`prebuilds/<os>-<arch>` layout
 * used by keytar / node-gyp-build, and pi-tui's `native/<os>`): dead weight
 * and, on macOS, unsignable ELF files.
 */
function pruneForeignPrebuilds(root, platform) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      const parent = dir.split('/').at(-1);
      const foreignPrebuild =
        parent === 'prebuilds' && !entry.name.startsWith(platform.id);
      const foreignNative =
        parent === 'native' &&
        ['darwin', 'linux', 'win32'].includes(entry.name) &&
        entry.name !== platform.os;
      if (foreignPrebuild || foreignNative) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      walk(path);
    }
  };
  walk(root);
}

/** Every native executable / shared object in the payload (signing + self-heal). */
function listNativeFiles(root, platform) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && isNativeForHost(path, platform))
        hits.push(path);
    }
  };
  walk(root);
  return hits.sort();
}

/**
 * `pnpm deploy` copies workspace packages verbatim, so our published libs
 * still carry the development `exports` (`./src/index.ts`, source-direct
 * resolution). `pnpm publish` would overlay `publishConfig`; do the same
 * here so the payload resolves `dist/` like a registry install.
 */
function applyPublishConfig(nodeModulesDir) {
  const applied = [];
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < 6) walk(path, depth + 1);
      } else if (entry.name === 'package.json') {
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        if (
          !manifest.name?.startsWith('@themoltnet/') ||
          !manifest.publishConfig
        ) {
          continue;
        }
        const { publishConfig, ...rest } = manifest;
        // `pnpm deploy --legacy` HARDLINKS workspace files into the payload:
        // writing in place would edit the repo's own package.json. Unlink
        // first so the payload gets a fresh inode.
        rmSync(path);
        writeFileSync(
          path,
          `${JSON.stringify({ ...rest, ...publishConfig }, null, 2)}\n`,
        );
        applied.push(manifest.name);
      }
    }
  };
  walk(nodeModulesDir, 0);
  return applied;
}

function machoDeps(file) {
  const out = spawnSync('otool', ['-L', file], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`otool -L failed for ${file}`);
  return out.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (')[0])
    .filter(Boolean)
    .filter(
      (dep) => !dep.startsWith('/usr/lib/') && !dep.startsWith('/System/'),
    );
}

function machoRpaths(file) {
  const out = spawnSync('otool', ['-l', file], { encoding: 'utf8' }).stdout;
  return [...out.matchAll(/LC_RPATH[\s\S]*?path (\S+)/g)].map((m) => m[1]);
}

/** Resolve a load command to a real file, following @loader_path/@rpath. */
function resolveDep(dep, fromFile) {
  const candidates = [];
  if (dep.startsWith('@loader_path/') || dep.startsWith('@executable_path/')) {
    candidates.push(join(dirname(fromFile), dep.replace(/^@[a-z_]+\//, '')));
  } else if (dep.startsWith('@rpath/')) {
    for (const rpath of machoRpaths(fromFile)) {
      candidates.push(
        join(
          rpath.replace(/^@loader_path/, dirname(fromFile)),
          dep.slice('@rpath/'.length),
        ),
      );
    }
  } else {
    candidates.push(dep);
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(`cannot resolve ${dep} referenced by ${fromFile}`);
}

function findQemuImg() {
  if (process.env.QEMU_IMG) return process.env.QEMU_IMG;
  const brew = spawnSync('brew', ['--prefix', 'qemu'], { encoding: 'utf8' });
  if (brew.status === 0) {
    const candidate = join(brew.stdout.trim(), 'bin/qemu-img');
    if (existsSync(candidate)) return candidate;
  }
  const which = spawnSync('which', ['qemu-img'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

/**
 * gondolin shells out to `qemu-img` (create/info/resize) on the host, so the
 * bundle must carry one. Vendor Homebrew's build plus the closure of its
 * non-system dylibs, relinked so nothing points back into /opt/homebrew:
 *   vendor/qemu-img        → @executable_path/lib/<dylib>
 *   vendor/lib/<dylib>     → @loader_path/<dylib>
 * The launcher puts vendor/ first on PATH. Every file here is Mach-O, so it
 * lands in manifest.native and gets signed with the rest of the payload.
 */
function vendorQemuImg(payloadDir) {
  const source = findQemuImg();
  if (!source) {
    throw new Error(
      'qemu-img not found (brew install qemu, or set QEMU_IMG); pass --no-qemu-img to skip',
    );
  }
  const vendorDir = join(payloadDir, 'vendor');
  const libDir = join(vendorDir, 'lib');
  mkdirSync(libDir, { recursive: true });

  // Walk the closure from the real binary.
  const closure = new Map(); // realpath -> basename
  const queue = [realpathSync(source)];
  const binary = queue[0];
  while (queue.length > 0) {
    const file = queue.pop();
    for (const dep of machoDeps(file)) {
      const real = resolveDep(dep, file);
      if (real === binary || closure.has(real)) continue;
      closure.set(real, real.split('/').at(-1));
      queue.push(real);
    }
  }

  const target = join(vendorDir, 'qemu-img');
  writeFileSync(target, readFileSync(binary));
  chmodSync(target, 0o755);
  const copied = [];
  for (const [real, base] of closure) {
    const dest = join(libDir, base);
    writeFileSync(dest, readFileSync(real));
    chmodSync(dest, 0o755);
    copied.push(dest);
  }

  const relink = (file, prefix) => {
    const args = [];
    for (const dep of machoDeps(file)) {
      const real = resolveDep(dep, file === target ? binary : realOf(file));
      const base = closure.get(real) ?? real.split('/').at(-1);
      args.push('-change', dep, `${prefix}${base}`);
    }
    if (file !== target)
      args.push('-id', `@loader_path/${file.split('/').at(-1)}`);
    if (args.length === 0) return;
    const result = spawnSync('install_name_tool', [...args, file], {
      encoding: 'utf8',
    });
    if (result.status !== 0)
      throw new Error(`install_name_tool failed for ${file}: ${result.stderr}`);
  };
  // Resolve deps of a copied dylib against its ORIGINAL location (its
  // @loader_path siblings live there, not in vendor/lib yet).
  const originals = new Map(
    copied.map((dest, i) => [dest, [...closure.keys()][i]]),
  );
  const realOf = (dest) => originals.get(dest);
  for (const dest of copied) relink(dest, '@loader_path/');
  relink(target, '@executable_path/lib/');

  // install_name_tool invalidates the signatures and arm64 refuses to run
  // such binaries. Ad-hoc sign now so the payload is runnable as assembled;
  // sign.sh replaces these with the release identity.
  for (const file of [...copied, target]) {
    const signed = spawnSync('codesign', ['--force', '-s', '-', file], {
      encoding: 'utf8',
    });
    if (signed.status !== 0) {
      throw new Error(`ad-hoc codesign failed for ${file}: ${signed.stderr}`);
    }
  }

  const version = spawnSync(target, ['--version'], { encoding: 'utf8' });
  return {
    version: version.stdout.split('\n')[0],
    dylibs: copied.length,
  };
}

function writeLauncher(payloadDir, platform) {
  const launcher = join(payloadDir, 'bin/moltnet-agent');
  mkdirSync(dirname(launcher), { recursive: true });
  // The bundle must not depend on a host qemu-system install: on macOS the
  // gondolin backend defaults to the bundled, signed krun runner (libkrun).
  // gondolin's own default is qemu; the env override keeps working.
  const vmmDefault =
    platform.os === 'darwin'
      ? '\n# Bundled VM backend: libkrun (signed krun runner ships in the payload).\nexport GONDOLIN_VMM="${GONDOLIN_VMM:-krun}"'
      : '';
  writeFileSync(
    launcher,
    `#!/bin/sh
# moltnet-agent launcher — self-contained bundle (see #2063).
set -eu
# The installer links this script from ~/.local/bin: follow symlinks so the
# bundle root resolves from the real file, portably (no readlink -f on macOS).
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case "$link" in /*) self=$link ;; *) self=$(dirname -- "$self")/$link ;; esac
done
root=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd)
export MOLTNET_AGENT_BUNDLE_ROOT="$root"
# vendor/ carries host tools we ship (qemu-img); keep the user's PATH after it.
export PATH="$root/vendor:$PATH"${vmmDefault}
exec "$root/libexec/moltnet-agent" "$root/daemon/dist/main.js" "$@"
`,
  );
  chmodSync(launcher, 0o755);
  return launcher;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const platform = hostPlatform();
  const daemonManifest = JSON.parse(
    readFileSync(join(daemonRoot, 'package.json'), 'utf8'),
  );
  const version = daemonManifest.version;
  const bundleName = `moltnet-agent-${platform.id}`;
  const payloadDir = join(args.out, bundleName);
  const cacheDir = join(homedir(), '.cache/moltnet-release/node');

  if (args.packOnly) {
    // CI signs the assembled payload in place, then packs: the tarball
    // must contain the signed binaries, not the ones we assembled.
    if (!existsSync(join(payloadDir, 'manifest.json'))) {
      throw new Error(`nothing to pack: ${payloadDir} has no manifest.json`);
    }
    pack(args.out, bundleName);
    return;
  }

  console.log(`assembling ${bundleName} v${version} (node ${args.node})`);
  rmSync(payloadDir, { recursive: true, force: true });
  mkdirSync(payloadDir, { recursive: true });

  if (!args.skipDaemonBuild) {
    run('pnpm', ['exec', 'nx', 'run', '@themoltnet/agent-daemon:build'], {
      env: { NX_LOAD_DOT_ENV_FILES: 'false' },
    });
  }

  // Production tree, exactly like the Docker images: dist + prod deps for
  // THIS platform (the optional krun-runner package resolves to the host).
  run(
    'pnpm',
    [
      '--filter',
      '@themoltnet/agent-daemon',
      'deploy',
      '--legacy',
      '--prod',
      join(payloadDir, 'daemon'),
    ],
    { env: { MOLTNET_SKIP_NX_SYNC: '1', HUSKY: '0' } },
  );

  const published = applyPublishConfig(join(payloadDir, 'daemon/node_modules'));
  console.log(`applied publishConfig: ${published.join(', ')}`);

  const nodeBinary = await fetchNodeBinary(args.node, platform, cacheDir);
  const runtime = join(payloadDir, 'libexec/moltnet-agent');
  mkdirSync(dirname(runtime), { recursive: true });
  writeFileSync(runtime, readFileSync(nodeBinary));
  chmodSync(runtime, 0o755);

  mkdirSync(join(payloadDir, 'vendor'), { recursive: true });
  if (args.qemuImg && platform.os === 'darwin') {
    const vendored = vendorQemuImg(payloadDir);
    console.log(`vendored ${vendored.version} (+${vendored.dylibs} dylibs)`);
  } else if (platform.os === 'linux') {
    console.log(
      'linux: qemu-img is not vendored (install qemu-utils on the host)',
    );
  }
  const launcher = writeLauncher(payloadDir, platform);
  writeFileSync(
    join(payloadDir, 'LICENSE'),
    readFileSync(join(repoRoot, 'LICENSE')),
  );

  pruneForeignPrebuilds(join(payloadDir, 'daemon/node_modules'), platform);
  const nativeFiles = listNativeFiles(payloadDir, platform);
  const manifest = {
    name: 'moltnet-agent',
    version,
    platform: platform.id,
    node: args.node,
    builtAt: new Date().toISOString(),
    launcher: relative(payloadDir, launcher),
    runtime: relative(payloadDir, runtime),
    entry: 'daemon/dist/main.js',
    // Everything a signer must touch and self-heal must re-verify.
    native: nativeFiles.map((path) => ({
      path: relative(payloadDir, path),
      size: statSync(path).size,
      sha256: sha256File(path),
    })),
  };
  writeFileSync(
    join(payloadDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `payload: ${payloadDir}\n  runtime: node ${args.node}\n  native files: ${nativeFiles.length}`,
  );
  for (const file of manifest.native) console.log(`    ${file.path}`);

  if (args.pack) pack(args.out, bundleName);
}

function pack(outDir, bundleName) {
  const tarball = join(outDir, `${bundleName}.tar.gz`);
  run('tar', ['-czf', tarball, '-C', outDir, bundleName]);
  const digest = sha256File(tarball);
  writeFileSync(`${tarball}.sha256`, `${digest}  ${bundleName}.tar.gz\n`);
  console.log(`packed: ${tarball} (${digest})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
