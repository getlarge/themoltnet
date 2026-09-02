import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  download,
  isNativeForHost,
  sha256File,
  validateQemuRuntimeProvenance,
  vendorQemuImg,
  writeLauncher,
} from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const installer = join(here, 'install.sh');
const signer = join(here, 'sign.sh');
const notarizer = join(here, 'notarize.sh');
const builder = join(here, 'build.mjs');
const supportedHost =
  (process.platform === 'darwin' && process.arch === 'arm64') ||
  (process.platform === 'linux' && process.arch === 'x64');
const platform = `${process.platform}-${process.arch}`;
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function run(command, args, options = {}) {
  return new Promise((resolveResult) => {
    execFile(
      command,
      args,
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        resolveResult({
          status:
            error && typeof error.code === 'number'
              ? error.code
              : error
                ? 1
                : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createBundle({
  version = '1.2.3',
  archivePlatform = platform,
  manifestPlatform = archivePlatform,
  helpStatus = 0,
  serveOutput = 'unknown command: serve',
  serveStatus = 1,
  unsigned = false,
} = {}) {
  const root = tempDir('moltnet-agent-fixture-');
  const name = `moltnet-agent-${archivePlatform}`;
  const payload = join(root, name);
  mkdirSync(join(payload, 'bin'), { recursive: true });
  const binary = join(payload, 'bin/moltnet-agent');
  writeFileSync(
    binary,
    `#!/bin/sh
if [ "\${1:-}" = "--help" ]; then
  echo "fixture help"
  exit ${helpStatus}
fi
if [ "\${1:-}" = "serve" ]; then
  echo "${serveOutput}" >&2
  exit ${serveStatus}
fi
exit 0
`,
  );
  chmodSync(binary, 0o755);
  writeFileSync(
    join(payload, 'manifest.json'),
    `${JSON.stringify({
      name: 'moltnet-agent',
      version,
      platform: manifestPlatform,
      launcher: 'bin/moltnet-agent',
      runtime: 'bin/moltnet-agent',
      entry: 'daemon/dist/main.js',
      native: [],
    })}\n`,
  );
  if (unsigned) writeFileSync(join(payload, 'UNSIGNED'), '');
  const archive = join(root, `${name}.tar.gz`);
  const packed = runSync('tar', ['-czf', archive, '-C', root, name]);
  assert.equal(packed.status, 0, packed.stderr);
  const checksum = `${archive}.sha256`;
  writeFileSync(checksum, `${digest(archive)}  ${basename(archive)}\n`);
  return { archive, checksum, name, payload, root, version };
}

function addCommandStubs(context, commands) {
  const root = tempDir('moltnet-agent-command-stubs-');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, source] of Object.entries(commands)) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  context.env.PATH = `${bin}:${context.env.PATH}`;
  return root;
}

function createInstallContext(fixture) {
  const root = tempDir('moltnet-agent-install-');
  const home = join(root, 'home');
  const installRoot = join(home, '.local/share/moltnet/agent');
  const binDir = join(home, '.local/bin');
  mkdirSync(home, { recursive: true });
  return {
    binDir,
    home,
    installRoot,
    env: {
      ...process.env,
      HOME: home,
      MOLTNET_AGENT_ALLOW_UNVERIFIED: '1',
      MOLTNET_AGENT_ARCHIVE: fixture.archive,
      MOLTNET_AGENT_BIN_DIR: binDir,
      MOLTNET_AGENT_HOME: installRoot,
      MOLTNET_AGENT_NO_SERVICE: '1',
    },
  };
}

async function runInstaller(context, args = [], script = installer) {
  return run('sh', [script, ...args], { env: context.env });
}

async function startAssetServer(root) {
  const server = createServer((request, response) => {
    const name = basename(new URL(request.url, 'http://localhost').pathname);
    const path = join(root, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200);
    createReadStream(path).pipe(response);
  });
  await new Promise((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function createSigningKey(root, name) {
  const key = join(root, name);
  const generated = runSync('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
    key,
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  return key;
}

function signChecksum(checksum, key) {
  const signed = runSync('ssh-keygen', [
    '-Y',
    'sign',
    '-f',
    key,
    '-n',
    'moltnet-release',
    checksum,
  ]);
  assert.equal(signed.status, 0, signed.stderr);
}

function installerWithPublicKey(root, key) {
  const publicKey = readFileSync(`${key}.pub`, 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const path = join(root, 'install-with-key.sh');
  const source = readFileSync(installer, 'utf8').replace(
    'RELEASE_SIGNER_PUBKEY=""',
    `RELEASE_SIGNER_PUBKEY="${publicKey}"`,
  );
  assert.notEqual(source, readFileSync(installer, 'utf8'));
  writeFileSync(path, source);
  return path;
}

describe('agent bundle installer', { skip: !supportedHost }, () => {
  it('installs and uninstalls an owned bundle cleanly', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);

    const installed = await runInstaller(context);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(
      readlinkSync(join(context.installRoot, 'current')),
      join(context.installRoot, fixture.version),
    );
    assert.equal(
      readlinkSync(join(context.binDir, 'moltnet-agent')),
      join(context.installRoot, 'current/bin/moltnet-agent'),
    );

    const removed = await runInstaller(context, ['--uninstall']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(context.installRoot), false);
    assert.equal(existsSync(`${context.installRoot}.lock`), false);
    assert.equal(existsSync(join(context.binDir, 'moltnet-agent')), false);
  });

  it('preserves unowned links and service definitions', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);
    mkdirSync(context.binDir, { recursive: true });
    const binary = join(context.binDir, 'moltnet-agent');
    writeFileSync(binary, 'user-owned');
    const service =
      process.platform === 'darwin'
        ? join(
            context.home,
            'Library/LaunchAgents/net.themolt.agent.serve.plist',
          )
        : join(context.home, '.config/systemd/user/moltnet-agent.service');
    mkdirSync(dirname(service), { recursive: true });
    writeFileSync(service, 'ExecStart=/user/managed/moltnet-agent serve\n');

    const removed = await runInstaller(context, ['--uninstall']);

    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(readFileSync(binary, 'utf8'), 'user-owned');
    assert.equal(existsSync(service), true);
  });

  it('refuses sensitive roots without touching their contents', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);
    const marker = join(context.home, 'keep-me');
    writeFileSync(marker, 'safe');
    context.env.MOLTNET_AGENT_HOME = context.home;

    const result = await runInstaller(context, ['--uninstall']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to operate/);
    assert.equal(readFileSync(marker, 'utf8'), 'safe');
  });

  it('refuses a non-empty foreign root without the ownership sentinel', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);
    const marker = join(context.installRoot, 'foreign-data');
    mkdirSync(context.installRoot, { recursive: true });
    writeFileSync(marker, 'keep');

    const result = await runInstaller(context, ['--uninstall']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing \.moltnet-agent-root/);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
  });

  it('serializes installs with the sibling mutation lock', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);
    const installed = await runInstaller(context);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(existsSync(`${context.installRoot}.lock`), false);
    mkdirSync(`${context.installRoot}.lock`);

    const second = await runInstaller(context);
    const uninstall = await runInstaller(context, ['--uninstall']);

    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /another install\/uninstall is in progress/);
    assert.notEqual(uninstall.status, 0);
    assert.match(uninstall.stderr, /another install\/uninstall is in progress/);
    assert.equal(
      readlinkSync(join(context.installRoot, 'current')),
      join(context.installRoot, fixture.version),
    );
  });

  it('rolls a failed first install back to a clean entrypoint', async () => {
    const fixture = createBundle({ helpStatus: 7 });
    const context = createInstallContext(fixture);

    const result = await runInstaller(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed its readiness check/);
    assert.equal(existsSync(join(context.installRoot, 'current')), false);
    assert.equal(existsSync(join(context.binDir, 'moltnet-agent')), false);
    assert.equal(
      existsSync(join(context.installRoot, `${fixture.version}.broken`)),
      true,
    );
    assert.equal(existsSync(`${context.installRoot}.lock`), false);
  });

  it('upgrades atomically, prunes only the previous version, and uninstalls', async () => {
    const first = createBundle({ version: '1.0.0' });
    const context = createInstallContext(first);
    const installed = await runInstaller(context);
    assert.equal(installed.status, 0, installed.stderr);

    const second = createBundle({ version: '2.0.0' });
    context.env.MOLTNET_AGENT_ARCHIVE = second.archive;
    const upgraded = await runInstaller(context);

    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(
      readlinkSync(join(context.installRoot, 'current')),
      join(context.installRoot, second.version),
    );
    assert.equal(existsSync(join(context.installRoot, first.version)), false);
    assert.equal(existsSync(join(context.installRoot, second.version)), true);

    const removed = await runInstaller(context, ['--uninstall']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(context.installRoot), false);
    assert.equal(existsSync(`${context.installRoot}.lock`), false);
  });

  it('rolls a failed upgrade back and keeps the broken payload for diagnosis', async () => {
    const first = createBundle({ version: '1.0.0' });
    const context = createInstallContext(first);
    const installed = await runInstaller(context);
    assert.equal(installed.status, 0, installed.stderr);

    const broken = createBundle({ version: '2.0.0', helpStatus: 7 });
    context.env.MOLTNET_AGENT_ARCHIVE = broken.archive;
    const result = await runInstaller(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rolled back to 1\.0\.0/);
    assert.equal(
      readlinkSync(join(context.installRoot, 'current')),
      join(context.installRoot, first.version),
    );
    assert.equal(existsSync(join(context.installRoot, first.version)), true);
    assert.equal(
      existsSync(join(context.installRoot, `${broken.version}.broken`)),
      true,
    );
    assert.equal(existsSync(`${context.installRoot}.lock`), false);
  });

  it('rejects unsigned artifacts unless explicitly waived', async () => {
    const fixture = createBundle({ unsigned: true });
    const context = createInstallContext(fixture);

    const refused = await runInstaller(context);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /artifact is marked UNSIGNED/);
    assert.equal(existsSync(join(context.installRoot, 'current')), false);

    context.env.MOLTNET_AGENT_ALLOW_UNSIGNED = '1';
    const accepted = await runInstaller(context);
    assert.equal(accepted.status, 0, accepted.stderr);
  });

  it('rejects a checksum mismatch before extraction', async () => {
    const fixture = createBundle();
    const context = createInstallContext(fixture);
    writeFileSync(fixture.archive, 'tampered');

    const result = await runInstaller(context);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(existsSync(context.installRoot), false);
  });

  it('rejects empty and path-hostile versions before touching the install root', async () => {
    for (const version of ['', '../escape']) {
      const fixture = createBundle({ version });
      const context = createInstallContext(fixture);

      const result = await runInstaller(context);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /refusing unsafe version string/);
      assert.equal(existsSync(context.installRoot), false);
    }
  });

  it('binds remote archives to the requested version and platform', async () => {
    const fixture = createBundle({ version: '1.0.0' });
    const context = createInstallContext(fixture);
    const assets = await startAssetServer(fixture.root);
    delete context.env.MOLTNET_AGENT_ARCHIVE;
    context.env.MOLTNET_AGENT_BASE_URL = assets.url;
    context.env.MOLTNET_AGENT_VERSION = '2.0.0';
    try {
      const result = await runInstaller(context);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /possible replay of a different release/);
      assert.equal(existsSync(join(context.installRoot, 'current')), false);
    } finally {
      await assets.close();
    }

    const wrongPlatform = createBundle({
      manifestPlatform:
        process.platform === 'darwin' ? 'linux-x64' : 'darwin-arm64',
    });
    const wrongContext = createInstallContext(wrongPlatform);
    const refused = await runInstaller(wrongContext);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /archive manifest is for platform/);
  });

  it('selects darwin-arm64 under Rosetta and rejects unreleased platforms', async () => {
    const translated = createBundle({ archivePlatform: 'darwin-arm64' });
    const translatedContext = createInstallContext(translated);
    addCommandStubs(translatedContext, {
      sysctl: '#!/bin/sh\nprintf 1\n',
      uname: `#!/bin/sh
case "$1" in
  -s) printf Darwin ;;
  -m) printf x86_64 ;;
esac
`,
    });

    const installed = await runInstaller(translatedContext);
    assert.equal(installed.status, 0, installed.stderr);

    const unsupported = createBundle({ archivePlatform: 'darwin-arm64' });
    const unsupportedContext = createInstallContext(unsupported);
    addCommandStubs(unsupportedContext, {
      sysctl: '#!/bin/sh\nprintf 0\n',
      uname: `#!/bin/sh
case "$1" in
  -s) printf Darwin ;;
  -m) printf x86_64 ;;
esac
`,
    });

    const refused = await runInstaller(unsupportedContext);
    assert.notEqual(refused.status, 0);
    assert.match(
      refused.stderr,
      /no moltnet-agent release exists for darwin-x64 yet.*darwin-arm64 linux-x64/,
    );
    assert.equal(existsSync(unsupportedContext.installRoot), false);
  });

  it('distinguishes a missing serve command from a broken serve command', async () => {
    const missing = createBundle();
    const missingContext = createInstallContext(missing);
    delete missingContext.env.MOLTNET_AGENT_NO_SERVICE;

    const skipped = await runInstaller(missingContext);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stderr, /has no 'serve' command/);

    const broken = createBundle({
      serveOutput: 'serve self-check crashed',
      serveStatus: 7,
    });
    const brokenContext = createInstallContext(broken);
    delete brokenContext.env.MOLTNET_AGENT_NO_SERVICE;

    const refused = await runInstaller(brokenContext);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /installed binary failed its self-check/);
    assert.match(refused.stderr, /serve self-check crashed/);
    assert.equal(existsSync(join(brokenContext.installRoot, 'current')), false);
  });

  it('restarts and asserts the Linux systemd unit during an upgrade', async () => {
    const first = createBundle({
      archivePlatform: 'linux-x64',
      serveStatus: 0,
      version: '1.0.0',
    });
    const context = createInstallContext(first);
    delete context.env.MOLTNET_AGENT_NO_SERVICE;
    const stubRoot = addCommandStubs(context, {
      journalctl: '#!/bin/sh\nexit 0\n',
      systemctl: `#!/bin/sh
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
exit 0
`,
      uname: `#!/bin/sh
case "$1" in
  -s) printf Linux ;;
  -m) printf x86_64 ;;
esac
`,
    });
    const systemctlLog = join(stubRoot, 'systemctl.log');
    context.env.SYSTEMCTL_LOG = systemctlLog;
    const installed = await runInstaller(context);
    assert.equal(installed.status, 0, installed.stderr);
    writeFileSync(systemctlLog, '');

    const second = createBundle({
      archivePlatform: 'linux-x64',
      serveStatus: 0,
      version: '2.0.0',
    });
    context.env.MOLTNET_AGENT_ARCHIVE = second.archive;
    const upgraded = await runInstaller(context);

    assert.equal(upgraded.status, 0, upgraded.stderr);
    const commands = readFileSync(systemctlLog, 'utf8');
    assert.match(commands, /--user try-restart moltnet-agent\.service/);
    assert.match(commands, /--user is-active --quiet moltnet-agent\.service/);
  });

  it('round-trips the release signature trust anchor', async () => {
    const fixture = createBundle();
    const key = createSigningKey(fixture.root, 'release-key');
    signChecksum(fixture.checksum, key);
    const verifiedInstaller = installerWithPublicKey(fixture.root, key);
    const context = createInstallContext(fixture);
    delete context.env.MOLTNET_AGENT_ALLOW_UNVERIFIED;

    const result = await runInstaller(context, [], verifiedInstaller);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /release signature verified/);
  });

  it('rejects missing and wrong-key release signatures', async () => {
    const missing = createBundle();
    const trustedKey = createSigningKey(missing.root, 'trusted-key');
    const verifiedInstaller = installerWithPublicKey(missing.root, trustedKey);
    const missingContext = createInstallContext(missing);
    delete missingContext.env.MOLTNET_AGENT_ALLOW_UNVERIFIED;

    const absent = await runInstaller(missingContext, [], verifiedInstaller);
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /release signature missing/);

    const wrong = createBundle();
    const expectedKey = createSigningKey(wrong.root, 'expected-key');
    const attackerKey = createSigningKey(wrong.root, 'attacker-key');
    signChecksum(wrong.checksum, attackerKey);
    const wrongInstaller = installerWithPublicKey(wrong.root, expectedKey);
    const wrongContext = createInstallContext(wrong);
    delete wrongContext.env.MOLTNET_AGENT_ALLOW_UNVERIFIED;
    const rejected = await runInstaller(wrongContext, [], wrongInstaller);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /signature verification FAILED/);
  });
});

describe('bundle manifest integrity', { skip: !supportedHost }, () => {
  function nativeMagic() {
    return process.platform === 'darwin'
      ? Buffer.from([0xfe, 0xed, 0xfa, 0xcf])
      : Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
  }

  function createPackFixture(recordedPaths, diskPaths) {
    const out = tempDir('moltnet-agent-pack-');
    const payload = join(out, `moltnet-agent-${platform}`);
    mkdirSync(join(payload, 'bin'), { recursive: true });
    for (const path of diskPaths) {
      const absolute = join(payload, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(
        absolute,
        Buffer.concat([nativeMagic(), Buffer.from('fixture')]),
      );
    }
    writeFileSync(
      join(payload, 'manifest.json'),
      `${JSON.stringify({
        runtime: 'bin/native',
        native: recordedPaths.map((path) => ({
          path,
          size: 0,
          sha256: 'stale',
        })),
      })}\n`,
    );
    return { out, payload };
  }

  it('refreshes post-sign hashes and packs the refreshed manifest', () => {
    const fixture = createPackFixture(['bin/native'], ['bin/native']);

    const result = runSync('node', [
      builder,
      '--pack-only',
      '--out',
      fixture.out,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      readFileSync(join(fixture.payload, 'manifest.json'), 'utf8'),
    );
    assert.equal(
      manifest.native[0].sha256,
      sha256File(join(fixture.payload, 'bin/native')),
    );
    const unpacked = tempDir('moltnet-agent-unpacked-');
    const tarball = `${fixture.payload}.tar.gz`;
    const extracted = runSync('tar', ['-xzf', tarball, '-C', unpacked]);
    assert.equal(extracted.status, 0, extracted.stderr);
    const archivedPayload = join(unpacked, basename(fixture.payload));
    const archivedManifest = JSON.parse(
      readFileSync(join(archivedPayload, 'manifest.json'), 'utf8'),
    );
    assert.equal(
      archivedManifest.native[0].sha256,
      sha256File(join(archivedPayload, 'bin/native')),
    );
  });

  it('refuses added or missing native files after assembly', () => {
    const added = createPackFixture([], ['bin/native']);
    const addedResult = runSync('node', [
      builder,
      '--pack-only',
      '--out',
      added.out,
    ]);
    assert.notEqual(addedResult.status, 0);
    assert.match(
      addedResult.stderr,
      /native file set changed.*added: bin\/native/,
    );

    const missing = createPackFixture(['bin/native'], []);
    const missingResult = runSync('node', [
      builder,
      '--pack-only',
      '--out',
      missing.out,
    ]);
    assert.notEqual(missingResult.status, 0);
    assert.match(
      missingResult.stderr,
      /native file set changed.*missing: bin\/native/,
    );
  });

  it('recognizes every supported Mach-O header variant', () => {
    const root = tempDir('moltnet-agent-magics-');
    const magics = [
      0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
      0xcafebabf, 0xbfbafeca,
    ];
    for (const magic of magics) {
      const path = join(root, magic.toString(16));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(magic);
      writeFileSync(path, header);
      assert.equal(isNativeForHost(path, { os: 'darwin' }), true);
    }
  });
});

describe('download cache integrity', () => {
  it('never promotes an interrupted download into the cache', async () => {
    const root = tempDir('moltnet-agent-download-');
    const destination = join(root, 'artifact');
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': '1000' });
      response.write('partial');
      response.destroy();
    });
    await new Promise((resolveListen) =>
      server.listen(0, '127.0.0.1', resolveListen),
    );
    const address = server.address();
    assert(address && typeof address === 'object');
    try {
      await assert.rejects(
        download(`http://127.0.0.1:${address.port}/artifact`, destination, {
          attempts: 2,
          timeoutMs: 1_000,
        }),
        /download failed after 2 attempts/,
      );
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(`${destination}.partial-${process.pid}`), false);
  });
});

describe('frozen QEMU runtime provenance', () => {
  const config = { runtimeVersion: '11.1.1-r1' };
  const artifact = {
    minimumMacosVersion: '15.0',
    qemuVersion: '11.1.1',
    sourceSha256: 'source-digest',
  };
  const provenance = {
    schemaVersion: 1,
    runtimeVersion: '11.1.1-r1',
    platform: 'darwin-arm64',
    minimumMacosVersion: '15.0',
    qemu: { version: '11.1.1', sourceSha256: 'source-digest' },
    nativeFiles: [{ path: 'vendor/qemu-img', sha256: 'binary-digest' }],
  };

  it('accepts the exact pinned runtime identity', () => {
    assert.doesNotThrow(() =>
      validateQemuRuntimeProvenance(
        provenance,
        { id: 'darwin-arm64' },
        config,
        artifact,
      ),
    );
  });

  it('rejects version, platform, and source drift', () => {
    for (const changed of [
      { ...provenance, runtimeVersion: '11.1.1-r2' },
      { ...provenance, platform: 'darwin-x64' },
      { ...provenance, minimumMacosVersion: '16.0' },
      {
        ...provenance,
        qemu: { ...provenance.qemu, version: '11.2.0' },
      },
      {
        ...provenance,
        qemu: { ...provenance.qemu, sourceSha256: 'other-source' },
      },
    ]) {
      assert.throws(
        () =>
          validateQemuRuntimeProvenance(
            changed,
            { id: 'darwin-arm64' },
            config,
            artifact,
          ),
        /QEMU runtime provenance/,
      );
    }
  });

  it('rejects a vendored qemu-img whose major drifts from the release pin', () => {
    const root = tempDir('moltnet-agent-qemu-major-');
    const source = join(root, 'qemu-img');
    writeFileSync(source, '#!/bin/sh\nprintf "qemu-img version 12.0.0\\n"\n');
    chmodSync(source, 0o755);
    const context = { env: { ...process.env } };
    addCommandStubs(context, {
      codesign: '#!/bin/sh\nexit 0\n',
      otool: `#!/bin/sh
case "$1" in
  -L) printf '%s:\\n' "$2" ;;
  -l) exit 0 ;;
esac
`,
    });
    const originalPath = process.env.PATH;
    const originalExpectedMajor = process.env.QEMU_IMG_EXPECTED_MAJOR;
    process.env.PATH = context.env.PATH;
    delete process.env.QEMU_IMG_EXPECTED_MAJOR;
    try {
      assert.throws(
        () => vendorQemuImg(join(root, 'payload'), source),
        /vendored qemu-img major 12 != expected 11/,
      );
    } finally {
      process.env.PATH = originalPath;
      if (originalExpectedMajor === undefined) {
        delete process.env.QEMU_IMG_EXPECTED_MAJOR;
      } else {
        process.env.QEMU_IMG_EXPECTED_MAJOR = originalExpectedMajor;
      }
    }
  });
});

describe('launcher log bound', { skip: !supportedHost }, () => {
  it('truncates a crash-loop log on every launcher start', () => {
    const installRoot = tempDir('moltnet-agent-launcher-');
    const payload = join(installRoot, '1.2.3');
    const runtime = join(payload, 'libexec/moltnet-agent');
    mkdirSync(dirname(runtime), { recursive: true });
    writeFileSync(runtime, '#!/bin/sh\nexit 0\n');
    chmodSync(runtime, 0o755);
    mkdirSync(join(payload, 'daemon/dist'), { recursive: true });
    writeFileSync(join(payload, 'daemon/dist/main.js'), '');
    const launcher = writeLauncher(payload, { os: process.platform });
    const log = join(installRoot, 'serve.log');
    writeFileSync(log, Buffer.alloc(11 * 1024 * 1024, 1));

    const result = runSync(launcher, [], { env: process.env });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(log).size, 1024 * 1024);
  });
});

function createStubSigner({
  extraEntitlement = false,
  krunEntitlements = ['com.apple.security.hypervisor'],
  runtimeEntitlements = [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
  ],
  tampered = true,
} = {}) {
  const root = tempDir('moltnet-agent-sign-stub-');
  const payload = join(root, 'payload');
  const paths = [
    'lib/good.node',
    'lib/bad.node',
    'bin/gondolin-krun-runner',
    'libexec/moltnet-agent',
  ];
  for (const path of paths) {
    const absolute = join(payload, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'native fixture');
  }
  writeFileSync(
    join(payload, 'manifest.json'),
    JSON.stringify({
      runtime: 'libexec/moltnet-agent',
      native: paths.map((path) => ({ path })),
    }),
  );
  const bin = join(root, 'bin');
  const commandLog = join(root, 'codesign.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\nprintf Darwin\n');
  chmodSync(join(bin, 'uname'), 0o755);
  writeFileSync(
    join(bin, 'codesign'),
    `#!/bin/sh
last=""
entitlements=""
previous=""
for arg in "$@"; do
  last=$arg
  if [ "$previous" = "--entitlements" ]; then entitlements=$arg; fi
  previous=$arg
done
case " $* " in
  *" -d "*)
    case "$last" in
      *gondolin-krun-runner)
${[
  ...krunEntitlements,
  ...(extraEntitlement ? ['com.apple.security.network.client'] : []),
]
  .map((entitlement) => `        echo '<key>${entitlement}</key>'`)
  .join('\n')} ;;
      *moltnet-agent)
${runtimeEntitlements
  .map((entitlement) => `        echo '<key>${entitlement}</key>'`)
  .join('\n')} ;;
    esac
    exit 0 ;;
  *" --verify "*)
    ${tampered ? `case "$last" in *bad.node) echo 'tampered fixture' >&2; exit 1 ;; esac` : ''}
    exit 0 ;;
  *)
    policy=no-library-validation
    if [ -n "$entitlements" ] && grep -q disable-library-validation "$entitlements"; then
      policy=disable-library-validation
    fi
    printf '%s [%s]\\n' "$last" "$policy" >> "$CODESIGN_LOG"
    exit 0 ;;
esac
`,
  );
  chmodSync(join(bin, 'codesign'), 0o755);
  return {
    commandLog,
    env: {
      ...process.env,
      CODESIGN_LOG: commandLog,
      PATH: `${bin}:${process.env.PATH}`,
    },
    payload,
  };
}

describe('signing policy', () => {
  it('rejects krun entitlements outside the allowlist', () => {
    const fixture = createStubSigner({ extraEntitlement: true });

    const result = runSync(
      'sh',
      [signer, '--payload', fixture.payload, '--adhoc'],
      { env: fixture.env },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /entitlement outside the allowlist/);
  });

  it('aggregates native verification failures and exits non-zero', () => {
    const fixture = createStubSigner();

    const result = runSync(
      'sh',
      [signer, '--payload', fixture.payload, '--adhoc', '--verify'],
      { env: fixture.env },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verify {2}FAILED tampered fixture/);
    assert.match(result.stderr, /signature verification failed for:/);
    assert.match(result.stderr, /lib\/bad.node/);
  });

  it('fails verification when required runtime or krun entitlements are missing', () => {
    const fixture = createStubSigner({
      krunEntitlements: [],
      runtimeEntitlements: [],
      tampered: false,
    });

    const result = runSync(
      'sh',
      [signer, '--payload', fixture.payload, '--adhoc', '--verify'],
      { env: fixture.env },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime is missing allow-jit/);
    assert.match(
      result.stderr,
      /runtime is missing allow-unsigned-executable-memory/,
    );
    assert.match(result.stderr, /krun runner is missing the hypervisor/);
  });

  it(
    'disables library validation only for ad-hoc signatures',
    { skip: process.platform !== 'darwin' },
    () => {
      const adhoc = createStubSigner({ tampered: false });
      const adhocResult = runSync(
        'sh',
        [signer, '--payload', adhoc.payload, '--adhoc'],
        { env: adhoc.env },
      );
      assert.equal(adhocResult.status, 0, adhocResult.stderr);
      assert.match(
        readFileSync(adhoc.commandLog, 'utf8'),
        /disable-library-validation/,
      );

      const developerId = createStubSigner({ tampered: false });
      const developerIdResult = runSync(
        'sh',
        [
          signer,
          '--payload',
          developerId.payload,
          '--identity',
          'Developer ID Application: Fixture',
        ],
        { env: developerId.env },
      );
      assert.equal(developerIdResult.status, 0, developerIdResult.stderr);
      assert.doesNotMatch(
        readFileSync(developerId.commandLog, 'utf8'),
        /disable-library-validation/,
      );
    },
  );

  it(
    'completes the real ad-hoc signing and entitlement checks on macOS',
    { skip: process.platform !== 'darwin' },
    () => {
      const root = tempDir('moltnet-agent-sign-real-');
      const payload = join(root, 'payload');
      const paths = [
        'lib/good.dylib',
        'bin/gondolin-krun-runner',
        'libexec/moltnet-agent',
      ];
      for (const path of paths) {
        const absolute = join(payload, path);
        mkdirSync(dirname(absolute), { recursive: true });
        copyFileSync('/usr/bin/true', absolute);
        chmodSync(absolute, 0o755);
      }
      writeFileSync(
        join(payload, 'manifest.json'),
        JSON.stringify({
          runtime: 'libexec/moltnet-agent',
          native: paths.map((path) => ({ path })),
        }),
      );

      const result = runSync('sh', [
        signer,
        '--payload',
        payload,
        '--adhoc',
        '--verify',
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /verification passed for 3 native files/);
    },
  );
});

function createStubNotarizer({ codesignStatus = 0 } = {}) {
  const root = tempDir('moltnet-agent-notarize-stub-');
  const payload = join(root, 'payload');
  const runtime = 'libexec/moltnet-agent';
  mkdirSync(join(payload, 'libexec'), { recursive: true });
  writeFileSync(join(payload, runtime), 'native fixture');
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify({ runtime }));

  const bin = join(root, 'bin');
  const commandLog = join(root, 'commands.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ditto'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(bin, 'xcrun'), '#!/bin/sh\nexit 0\n');
  writeFileSync(
    join(bin, 'codesign'),
    `#!/bin/sh
printf 'codesign %s\\n' "$*" >> "$COMMAND_LOG"
if [ "${codesignStatus}" -ne 0 ]; then
  echo 'notarization requirement failed' >&2
  exit ${codesignStatus}
fi
`,
  );
  writeFileSync(
    join(bin, 'spctl'),
    `#!/bin/sh
printf 'spctl %s\\n' "$*" >> "$COMMAND_LOG"
echo 'spctl must not assess raw executable code' >&2
exit 99
`,
  );
  for (const command of ['ditto', 'xcrun', 'codesign', 'spctl']) {
    chmodSync(join(bin, command), 0o755);
  }

  return {
    commandLog,
    env: {
      ...process.env,
      COMMAND_LOG: commandLog,
      NOTARY_ISSUER_ID: 'issuer-id',
      NOTARY_KEY: 'private-key-contents',
      NOTARY_KEY_ID: 'key-id',
      PATH: `${bin}:${process.env.PATH}`,
    },
    payload,
    runtime,
  };
}

describe('notarization verification', () => {
  it('checks the notarization requirement for raw executable code', () => {
    const fixture = createStubNotarizer();

    const result = runSync('sh', [notarizer, '--payload', fixture.payload], {
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(fixture.commandLog, 'utf8'),
      `codesign -vvvv -R=notarized --check-notarization ${join(
        fixture.payload,
        fixture.runtime,
      )}\n`,
    );
  });

  it('fails when the runtime does not satisfy the notarization requirement', () => {
    const fixture = createStubNotarizer({ codesignStatus: 1 });

    const result = runSync('sh', [notarizer, '--payload', fixture.payload], {
      env: fixture.env,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /notarization requirement failed/);
  });
});
