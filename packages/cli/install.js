#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const VERSION = require('./package.json').version;
const REPO = 'getlarge/themoltnet';
const TAG = `cli-v${VERSION}`;
const BASE_URL = `https://github.com/${REPO}/releases/download/${TAG}`;

const PLATFORM_MAP = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_MAP = {
  x64: 'amd64',
  arm64: 'arm64',
};

function getBinaryName() {
  return process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';
}

function getBinaryPath() {
  return path.join(__dirname, 'bin', getBinaryName());
}

function getArchiveName() {
  const os = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    throw new Error(
      `Unsupported platform: ${process.platform}-${process.arch}`
    );
  }
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return `moltnet_${VERSION}_${os}_${arch}.${ext}`;
}

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }
    https
      .get(url, { headers: { 'User-Agent': 'themoltnet-cli' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetch(res.headers.location, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          return reject(
            new Error(`HTTP ${res.statusCode} fetching ${url}`)
          );
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function verifyChecksum(archiveBuffer, archiveName) {
  const checksumsUrl = `${BASE_URL}/checksums.txt`;
  const checksumsBuffer = await fetch(checksumsUrl);
  const checksums = checksumsBuffer.toString('utf8');

  const line = checksums.split('\n').find((l) => l.includes(archiveName));
  if (!line) {
    throw new Error(
      `Checksum not found for ${archiveName} in checksums.txt`
    );
  }

  const expectedHash = line.split(/\s+/)[0];
  const actualHash = crypto
    .createHash('sha256')
    .update(archiveBuffer)
    .digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${archiveName}:\n  expected: ${expectedHash}\n  actual:   ${actualHash}`
    );
  }
}

function extractTarGz(buffer, destDir) {
  const tmpDir = path.join(__dirname, '.tmp');
  const tmpFile = path.join(tmpDir, 'archive.tar.gz');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpFile, buffer);
  try {
    execFileSync('tar', ['xzf', tmpFile, '-C', destDir], {
      stdio: 'pipe',
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractZip(buffer, destDir) {
  const tmpDir = path.join(__dirname, '.tmp');
  const tmpFile = path.join(tmpDir, 'archive.zip');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpFile, buffer);
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${tmpFile}' -DestinationPath '${destDir}' -Force`,
      ],
      { stdio: 'pipe' }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const binaryPath = getBinaryPath();

  if (fs.existsSync(binaryPath)) {
    console.log(`moltnet binary already exists at ${binaryPath}, skipping download.`);
    return;
  }

  const archiveName = getArchiveName();
  const archiveUrl = `${BASE_URL}/${archiveName}`;

  console.log(`Downloading moltnet ${VERSION} for ${process.platform}-${process.arch}...`);
  console.log(`  ${archiveUrl}`);

  const archiveBuffer = await fetch(archiveUrl);

  console.log('Verifying checksum...');
  await verifyChecksum(archiveBuffer, archiveName);

  const binDir = path.join(__dirname, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  console.log('Extracting...');
  if (process.platform === 'win32') {
    extractZip(archiveBuffer, binDir);
  } else {
    extractTarGz(archiveBuffer, binDir);
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(binaryPath, 0o755);
  }

  console.log(`Installed moltnet ${VERSION} to ${binaryPath}`);
}

main().catch((err) => {
  console.warn(`Warning: Failed to install moltnet binary: ${err.message}`);
  console.warn(
    `\nYou can download it manually from:\n  ${BASE_URL}/`
  );
  // Exit 0 so postinstall doesn't break `pnpm install` for the whole monorepo
  process.exit(0);
});
