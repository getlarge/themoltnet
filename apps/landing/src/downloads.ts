import {
  MOLTNET_DOWNLOAD_MANIFEST_URL,
  MOLTNET_DOWNLOAD_URL,
  MOLTNET_RELEASE_SIGNATURE_NAMESPACE,
  MOLTNET_RELEASE_SIGNER_PRINCIPAL,
} from '@moltnet/discovery';

/**
 * Official download surface shared by the Download page, the agent onboarding
 * path, and the agent beacon. Paths are relative so the SPA links stay on this
 * domain; the absolute forms feed shell snippets and machine-readable data.
 *
 * The nginx template (apps/landing/nginx/default.conf.template) owns the
 * version pins and the redirect targets; nothing here embeds a version.
 */

export type PlatformId =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'windows-x64'
  | 'windows-arm64';

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  'darwin-arm64': 'macOS (Apple Silicon)',
  'darwin-x64': 'macOS (Intel)',
  'linux-x64': 'Linux (x64)',
  'linux-arm64': 'Linux (arm64)',
  'windows-x64': 'Windows (x64)',
  'windows-arm64': 'Windows (arm64)',
};

export const CLI_PLATFORMS: readonly { id: PlatformId; archive: string }[] = [
  { id: 'darwin-arm64', archive: 'tar.gz' },
  { id: 'darwin-x64', archive: 'tar.gz' },
  { id: 'linux-x64', archive: 'tar.gz' },
  { id: 'linux-arm64', archive: 'tar.gz' },
  { id: 'windows-x64', archive: 'zip' },
  { id: 'windows-arm64', archive: 'zip' },
] as const;

export const AGENT_PLATFORMS: readonly PlatformId[] = [
  'darwin-arm64',
  'linux-x64',
] as const;

export const DOWNLOAD_PATH = '/download';
export const DOWNLOAD_VERIFY_PATH = `${DOWNLOAD_PATH}#verify`;
export const CLI_CHECKSUMS_PATH = `${DOWNLOAD_PATH}/cli/checksums`;
export const CLI_CHECKSUMS_SIGNATURE_PATH = `${DOWNLOAD_PATH}/cli/checksums.sig`;

export function cliDownloadPath(platform: PlatformId): string {
  return `${DOWNLOAD_PATH}/cli/${platform}`;
}

export function agentDownloadPath(platform: PlatformId): string {
  return `${DOWNLOAD_PATH}/agent/${platform}`;
}

const ORIGIN = MOLTNET_DOWNLOAD_URL.slice(
  0,
  MOLTNET_DOWNLOAD_URL.length - DOWNLOAD_PATH.length,
);

/** Absolute form of a download path, for shell snippets and the beacon. */
export function absoluteDownloadUrl(path: string): string {
  return `${ORIGIN}${path}`;
}

/**
 * Shell steps that verify a CLI archive by hand. Verified end to end against a
 * real release: `-J` keeps the versioned file name that checksums.txt refers
 * to, and the signers line is exactly what `ssh-keygen -Y verify` expects.
 */
export function cliVerifyCommands(
  platform: PlatformId = 'darwin-arm64',
): string {
  // Lines stay within ~62 columns so the block reads without horizontal
  // scroll in the narrowest place it is shown (the getting-started steps).
  return [
    `# 1. Download the ${PLATFORM_LABELS[platform]} archive, the`,
    '#    checksum list, and its signature. -J keeps the versioned',
    '#    file name that checksums.txt refers to.',
    `curl -fsSLOJ ${absoluteDownloadUrl(cliDownloadPath(platform))}`,
    `curl -fsSLOJ ${absoluteDownloadUrl(CLI_CHECKSUMS_PATH)}`,
    `curl -fsSLOJ ${absoluteDownloadUrl(CLI_CHECKSUMS_SIGNATURE_PATH)}`,
    '',
    '# 2. Verify the archive against the checksum list.',
    'shasum -a 256 -c checksums.txt --ignore-missing',
    '',
    "# 3. Verify the list's publisher signature. The key is served",
    '#    by this domain, not by the release storage.',
    `KEY=$(curl -fsSL ${MOLTNET_DOWNLOAD_MANIFEST_URL} \\`,
    '  | jq -r .signer.publicKey)',
    `printf '%s namespaces="%s" %s\\n' \\`,
    `  ${MOLTNET_RELEASE_SIGNER_PRINCIPAL} ${MOLTNET_RELEASE_SIGNATURE_NAMESPACE} "$KEY" > signers`,
    `ssh-keygen -Y verify -f signers -I ${MOLTNET_RELEASE_SIGNER_PRINCIPAL} \\`,
    `  -n ${MOLTNET_RELEASE_SIGNATURE_NAMESPACE} -s checksums.txt.sig < checksums.txt`,
  ].join('\n');
}

/**
 * Shell steps that verify an agent bundle by hand. Each bundle ships its own
 * `.sha256` and a detached `.sha256.sig`; the publisher key is inlined when
 * the manifest has delivered it, otherwise a placeholder points at it.
 */
export function agentVerifyCommands(publicKey: string | undefined): string {
  const key = publicKey ?? '<publisher key — see /download/manifest.json>';
  const platform: PlatformId = 'darwin-arm64';
  const archive = `moltnet-agent-${platform}.tar.gz`;
  const base = absoluteDownloadUrl(agentDownloadPath(platform));
  return [
    '# 1. Download an archive and its signed checksum (agent bundle shown).',
    `curl -fsSL -o ${archive} ${base}`,
    `curl -fsSL -o ${archive}.sha256 ${base}.sha256`,
    `curl -fsSL -o ${archive}.sha256.sig ${base}.sha256.sig`,
    '',
    '# 2. Verify the archive against its checksum.',
    `shasum -a 256 -c ${archive}.sha256`,
    '',
    '# 3. Verify the checksum’s publisher signature (ssh-ed25519).',
    `printf '%s namespaces="${MOLTNET_RELEASE_SIGNATURE_NAMESPACE}" %s\\n' \\`,
    `  '${MOLTNET_RELEASE_SIGNER_PRINCIPAL}' '${key}' > signers`,
    `ssh-keygen -Y verify -f signers -I ${MOLTNET_RELEASE_SIGNER_PRINCIPAL} \\`,
    `  -n ${MOLTNET_RELEASE_SIGNATURE_NAMESPACE} \\`,
    `  -s ${archive}.sha256.sig < ${archive}.sha256`,
  ].join('\n');
}

/** Machine-readable summary published on the agent beacon. */
export function downloadBeaconData() {
  return {
    page: MOLTNET_DOWNLOAD_URL,
    manifest: MOLTNET_DOWNLOAD_MANIFEST_URL,
    cli: {
      platforms: Object.fromEntries(
        CLI_PLATFORMS.map(({ id }) => [
          id,
          absoluteDownloadUrl(cliDownloadPath(id)),
        ]),
      ),
      checksums: absoluteDownloadUrl(CLI_CHECKSUMS_PATH),
      checksumsSignature: absoluteDownloadUrl(CLI_CHECKSUMS_SIGNATURE_PATH),
    },
    agent: {
      platforms: Object.fromEntries(
        AGENT_PLATFORMS.map((id) => [
          id,
          absoluteDownloadUrl(agentDownloadPath(id)),
        ]),
      ),
      checksumSuffix: '.sha256',
      signatureSuffix: '.sha256.sig',
    },
    verify: {
      checksum: 'sha256',
      signature: 'ssh-ed25519',
      signer: MOLTNET_RELEASE_SIGNER_PRINCIPAL,
      namespace: MOLTNET_RELEASE_SIGNATURE_NAMESPACE,
      publicKey: `${MOLTNET_DOWNLOAD_MANIFEST_URL}#signer.publicKey`,
      guide: absoluteDownloadUrl(DOWNLOAD_VERIFY_PATH),
    },
  };
}
