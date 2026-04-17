#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const binaryName = process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';

function findBinary() {
  const localPath = path.join(__dirname, binaryName);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

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

  return null;
}

const binaryPath = findBinary();

if (!binaryPath) {
  console.error(
    `moltnet binary not found for ${process.platform}-${process.arch}\n` +
      'Run "node install.js" in the package directory, or download manually from:\n' +
      '  https://github.com/getlarge/themoltnet/releases'
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
