#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const VERSION = require('./package.json').version;
const WORKSPACE_PLATFORM_ROOT = path.resolve(__dirname, 'npm');
const FETCH_TIMEOUT_MS = 15_000;

function getBinaryName() {
  return process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';
}

function getPlatformPackageName() {
  return `@themoltnet/cli-${process.platform}-${process.arch}`;
}

function resolvePlatformPackage() {
  const pkgName = getPlatformPackageName();
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    return {
      binaryPath: path.join(pkgDir, 'bin', getBinaryName()),
      isWorkspacePackage:
        pkgDir === WORKSPACE_PLATFORM_ROOT ||
        pkgDir.startsWith(`${WORKSPACE_PLATFORM_ROOT}${path.sep}`),
      pkgDir,
    };
  } catch {
    return null;
  }
}

// Case 1 (happy path): the platform package was installed via
// optionalDependencies. bin/moltnet.js resolves the binary in place at
// runtime, so install.js has nothing to do.
function tryPlatformPackage() {
  const resolvedPackage = resolvePlatformPackage();
  if (!resolvedPackage) {
    // Platform package not installed (e.g. --no-optional, yarn v1 optional bug)
    return null;
  }

  if (fs.existsSync(resolvedPackage.binaryPath)) {
    return resolvedPackage.binaryPath;
  }

  // In this monorepo, workspace platform packages resolve during `pnpm install`
  // before their release artifacts exist in the checkout. That should not
  // trigger a registry fetch; the fallback is only for published installs.
  if (resolvedPackage.isWorkspacePackage) {
    console.log(
      `Skipping moltnet binary download for workspace package ${getPlatformPackageName()} ` +
        `(${resolvedPackage.pkgDir})`
    );
    return resolvedPackage.binaryPath;
  }

  return null;
}

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    globalThis
      .fetch(url, {
        headers: { 'User-Agent': 'themoltnet-cli' },
        redirect: 'follow',
        signal: controller.signal,
      })
      .then(async (response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} fetching ${url}`);
        }
        return Buffer.from(await response.arrayBuffer());
      })
      .then(resolve)
      .catch((err) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
          return;
        }
        reject(err);
      });
  });
}

// Case 2 (fallback): fetch the platform package tarball directly from the npm
// registry and extract the binary into local bin/. The registry is reachable
// in most sandboxed environments where github.com is not.
async function downloadFromNpm() {
  const pkgName = getPlatformPackageName();
  const bareName = pkgName.split('/')[1];
  const tarballUrl = `https://registry.npmjs.org/${pkgName}/-/${bareName}-${VERSION}.tgz`;

  console.log(`Downloading moltnet binary from ${tarballUrl}`);
  const tarball = await fetch(tarballUrl);
  const gunzipped = zlib.gunzipSync(tarball);

  const tmpDir = path.join(__dirname, '.install-tmp');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpTar = path.join(tmpDir, 'archive.tar');
  fs.writeFileSync(tmpTar, gunzipped);

  try {
    execFileSync('tar', ['xf', tmpTar, '-C', tmpDir], { stdio: 'pipe' });

    const extractedBinary = path.join(tmpDir, 'package', 'bin', getBinaryName());
    if (!fs.existsSync(extractedBinary)) {
      throw new Error(`Binary not found in tarball: ${extractedBinary}`);
    }

    const targetBinDir = path.join(__dirname, 'bin');
    fs.mkdirSync(targetBinDir, { recursive: true });
    const targetPath = path.join(targetBinDir, getBinaryName());
    fs.copyFileSync(extractedBinary, targetPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(targetPath, 0o755);
    }
    return targetPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  if (tryPlatformPackage()) {
    return;
  }

  try {
    const binaryPath = await downloadFromNpm();
    console.log(`Installed moltnet ${VERSION} to ${binaryPath}`);
  } catch (err) {
    console.warn(`Warning: Failed to install moltnet binary: ${err.message}`);
    console.warn(
      `You can install the platform package manually:\n` +
        `  npm install ${getPlatformPackageName()}@${VERSION}`
    );
    // Exit 0 so postinstall doesn't break install for the whole project
  }
}

main();
