#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const VERSION = require('./package.json').version;

function getBinaryName() {
  return process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';
}

function getPlatformPackageName() {
  return `@themoltnet/cli-${process.platform}-${process.arch}`;
}

// Case 1 (happy path): the platform package was installed via
// optionalDependencies. bin/moltnet.js resolves the binary in place at
// runtime, so install.js has nothing to do.
function tryPlatformPackage() {
  const pkgName = getPlatformPackageName();
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    const binaryPath = path.join(pkgDir, 'bin', getBinaryName());
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // Platform package not installed (e.g. --no-optional, yarn v1 optional bug)
  }
  return null;
}

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }
    https
      .get(url, { headers: { 'User-Agent': 'themoltnet-cli' } }, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return resolve(fetch(res.headers.location, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
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
