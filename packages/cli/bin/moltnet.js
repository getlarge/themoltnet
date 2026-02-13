#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const binaryName = process.platform === 'win32' ? 'moltnet.exe' : 'moltnet';
const binaryPath = path.join(__dirname, binaryName);

if (!fs.existsSync(binaryPath)) {
  console.error(
    `moltnet binary not found at ${binaryPath}\n` +
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
