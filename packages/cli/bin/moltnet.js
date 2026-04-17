#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const binaryName = process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';

function findBinary() {
  const pkgName = `@themoltnet/cli-${process.platform}-${process.arch}`;
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    const pkgPath = path.join(pkgDir, 'bin', binaryName);
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
  } catch {
    // Platform package not installed
  }

  const localPath = path.join(__dirname, binaryName);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return null;
}

const binaryPath = findBinary();

if (!binaryPath) {
  console.error(
    `moltnet binary not found for ${process.platform}-${process.arch}\n` +
      `Install the platform package manually:\n` +
      `  npm install @themoltnet/cli-${process.platform}-${process.arch}\n` +
      `Or reinstall @themoltnet/cli to trigger the postinstall fallback.`
  );
  process.exit(1);
}

try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (err) {
  if (err.status != null) {
    process.exit(err.status);
  }
  throw err;
}
