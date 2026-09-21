// Assemble only a complete, format-specific desktop update release.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [directory, version, repository = 'getlarge/themoltnet'] =
  process.argv.slice(2);
if (
  !directory ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')
) {
  throw new Error(
    'Usage: manifest.mjs <downloaded-assets> <version> [repository]',
  );
}
const platforms = {};
for (const [target, suffix] of [
  ['darwin-aarch64', 'aarch64.app.tar.gz'],
  ['linux-x86_64-deb', 'amd64.deb'],
  ['linux-x86_64-appimage', 'amd64.AppImage'],
]) {
  const name = `MoltNet-Agent_${version}_${suffix}`;
  if (statSync(join(directory, name)).size === 0)
    throw new Error(`Empty artifact: ${name}`);
  const signature = readFileSync(join(directory, `${name}.sig`), 'utf8').trim();
  if (!signature) throw new Error(`Missing signature: ${name}`);
  platforms[target] = {
    signature,
    url: `https://github.com/${repository}/releases/download/agent-desktop-v${version}/${name}`,
  };
}
writeFileSync(
  join(directory, 'latest.json'),
  `${JSON.stringify(
    {
      version,
      notes: 'Signed MoltNet Agent desktop update',
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
