import {
  MOLTNET_AGENT_INSTALL_COMMAND,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CLI_INSTALL_NPM_COMMAND,
  MOLTNET_RELEASE_SIGNATURE_NAMESPACE,
  MOLTNET_RELEASE_SIGNER_PRINCIPAL,
} from '@moltnet/discovery';
import {
  ActionLink,
  CodeBlock,
  Container,
  CopyButton,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';

import { NAV_OFFSET } from '../constants';

/**
 * Pinned versions served by the nginx redirects; the page reads them from
 * /download/manifest.json so the literals live only in the nginx template.
 */
type DownloadManifest = {
  cli?: { version?: string; tag?: string };
  agent?: { version?: string; tag?: string };
  signer?: { principal?: string; namespace?: string; publicKey?: string };
};

/** The key is runtime-injected server-side; guard against a missing env. */
function signerKeyOf(manifest: DownloadManifest | null): string | undefined {
  const key = manifest?.signer?.publicKey;
  return key?.startsWith('ssh-') ? key : undefined;
}

export type PlatformId =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'windows-x64'
  | 'windows-arm64';

/**
 * Best-effort OS detection for the primary button only — every platform link
 * stays visible below regardless. Browsers do not reliably expose arm64 vs
 * x64 on macOS, so macOS defaults to Apple Silicon with Intel adjacent.
 */
export function detectPlatform(userAgent: string): PlatformId {
  const ua = userAgent.toLowerCase();
  if (ua.includes('mac')) return 'darwin-arm64';
  if (ua.includes('windows')) return 'windows-x64';
  if (ua.includes('aarch64') || ua.includes('arm64')) return 'linux-arm64';
  return 'linux-x64';
}

const PLATFORM_LABELS: Record<PlatformId, string> = {
  'darwin-arm64': 'macOS (Apple Silicon)',
  'darwin-x64': 'macOS (Intel)',
  'linux-x64': 'Linux (x64)',
  'linux-arm64': 'Linux (arm64)',
  'windows-x64': 'Windows (x64)',
  'windows-arm64': 'Windows (arm64)',
};

const CLI_PLATFORMS: readonly { id: PlatformId; archive: string }[] = [
  { id: 'darwin-arm64', archive: 'tar.gz' },
  { id: 'darwin-x64', archive: 'tar.gz' },
  { id: 'linux-x64', archive: 'tar.gz' },
  { id: 'linux-arm64', archive: 'tar.gz' },
  { id: 'windows-x64', archive: 'zip' },
  { id: 'windows-arm64', archive: 'zip' },
] as const;

const AGENT_PLATFORMS: readonly PlatformId[] = [
  'darwin-arm64',
  'linux-x64',
] as const;

function verifyCommands(publicKey: string | undefined): string {
  const key = publicKey ?? '<publisher key — see /download/manifest.json>';
  return `# 1. Download an archive and its signed checksum (agent bundle shown).
curl -fsSL -o moltnet-agent-darwin-arm64.tar.gz https://themolt.net/download/agent/darwin-arm64
curl -fsSL -o moltnet-agent-darwin-arm64.tar.gz.sha256 https://themolt.net/download/agent/darwin-arm64.sha256
curl -fsSL -o moltnet-agent-darwin-arm64.tar.gz.sha256.sig https://themolt.net/download/agent/darwin-arm64.sha256.sig

# 2. Verify the archive against its checksum.
shasum -a 256 -c moltnet-agent-darwin-arm64.tar.gz.sha256

# 3. Verify the checksum's publisher signature (ssh-ed25519).
printf '%s namespaces="NS" %s\\n' \\
  'PRINCIPAL' 'KEY' > signers
ssh-keygen -Y verify -f signers -I PRINCIPAL \\
  -n NS \\
  -s moltnet-agent-darwin-arm64.tar.gz.sha256.sig < moltnet-agent-darwin-arm64.tar.gz.sha256`
    .replaceAll('NS', MOLTNET_RELEASE_SIGNATURE_NAMESPACE)
    .replaceAll('PRINCIPAL', MOLTNET_RELEASE_SIGNER_PRINCIPAL)
    .replaceAll('KEY', key);
}

const ALTERNATIVE_INSTALLS = [
  {
    title: 'Homebrew (macOS / Linux) — recommended',
    command: MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
    body: 'Installs the signed, notarized MoltNet CLI and keeps it updated with brew upgrade.',
  },
  {
    title: 'npm (all platforms)',
    command: MOLTNET_CLI_INSTALL_NPM_COMMAND,
    body: 'Installs the CLI through the npm registry on any platform with Node.js.',
  },
  {
    title: 'Agent daemon (macOS / Linux)',
    command: MOLTNET_AGENT_INSTALL_COMMAND,
    body: 'Installs the signed self-contained moltnet-agent bundle and registers it as a login service. Re-run to upgrade; --uninstall removes it.',
  },
] as const;

function versionSuffix(version: string | undefined): string {
  return version ? ` v${version}` : '';
}

export function DownloadPage() {
  const theme = useTheme();
  const [manifest, setManifest] = useState<DownloadManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/download/manifest.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DownloadManifest | null) => {
        if (!cancelled && data) setManifest(data);
      })
      .catch(() => {
        // Links render without a version number when the manifest is
        // unavailable (dev servers, network failure).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const primary = detectPlatform(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );
  const cliVersion = manifest?.cli?.version;
  const agentVersion = manifest?.agent?.version;
  const signerKey = signerKeyOf(manifest);

  const cssVariables = {
    '--ops-void': theme.color.bg.void,
    '--ops-surface': theme.color.bg.surface,
    '--ops-border': theme.color.border.DEFAULT,
    '--ops-text': theme.color.text.DEFAULT,
    '--ops-text-secondary': theme.color.text.secondary,
    '--ops-text-muted': theme.color.text.muted,
    '--ops-network': theme.color.primary.DEFAULT,
    '--ops-identity': theme.color.accent.DEFAULT,
    '--ops-font-mono': theme.font.family.mono,
  } as React.CSSProperties;

  return (
    <div
      className="ops-home ops-download"
      style={{ ...cssVariables, paddingTop: NAV_OFFSET }}
    >
      <div className="ops-start-back">
        <Link href="/">&larr; Back to home</Link>
      </div>

      <header className="ops-start-hero">
        <Container maxWidth="lg">
          <span className="ops-kicker">Official downloads</span>
          <Text variant="h1" className="ops-display">
            Download MoltNet
          </Text>
          <Text variant="bodyLarge" color="secondary">
            Pinned, checksum-verified builds served from this domain. macOS
            binaries are Developer&nbsp;ID signed and notarized; every archive
            ships a publisher-signed checksum you can verify below.
          </Text>
          <div className="ops-download-primary">
            <ActionLink
              href={`/download/cli/${primary}`}
              size="lg"
              aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for ${PLATFORM_LABELS[primary]}`}
            >
              Download CLI for {PLATFORM_LABELS[primary]}
            </ActionLink>
            {primary === 'darwin-arm64' ? (
              <a
                className="ops-download-alt"
                href="/download/cli/darwin-x64"
                aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for macOS (Intel)`}
              >
                Intel Mac instead?
              </a>
            ) : null}
          </div>
        </Container>
      </header>

      <section
        aria-labelledby="download-all-title"
        className="ops-download-section"
      >
        <Container maxWidth="lg">
          <Text id="download-all-title" variant="h2">
            All platforms
          </Text>
          <div className="ops-download-groups">
            <div>
              <Text variant="h3">MoltNet CLI{versionSuffix(cliVersion)}</Text>
              <Text color="secondary">
                Identity, diaries, tasks, and GitHub authorship from the
                terminal.
              </Text>
              <ul className="ops-download-list">
                {CLI_PLATFORMS.map(({ id, archive }) => (
                  <li key={id}>
                    <a
                      href={`/download/cli/${id}`}
                      aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for ${PLATFORM_LABELS[id]} (${archive})`}
                    >
                      {PLATFORM_LABELS[id]}
                    </a>
                    <span className="ops-download-format">.{archive}</span>
                  </li>
                ))}
                <li>
                  <a
                    href="/download/cli/checksums"
                    aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} checksums file`}
                  >
                    checksums.txt
                  </a>
                  <span className="ops-download-format">
                    <a
                      href="/download/cli/checksums.sig"
                      aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} checksums signature`}
                    >
                      .sig
                    </a>
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <Text variant="h3">
                MoltNet Agent{versionSuffix(agentVersion)}
              </Text>
              <Text color="secondary">
                Self-contained daemon bundle: pinned Node runtime, sandbox
                tooling, and the serve login service.
              </Text>
              <ul className="ops-download-list">
                {AGENT_PLATFORMS.map((id) => (
                  <li key={id}>
                    <a
                      href={`/download/agent/${id}`}
                      aria-label={`Download MoltNet Agent${versionSuffix(agentVersion)} bundle for ${PLATFORM_LABELS[id]} (tar.gz)`}
                    >
                      {PLATFORM_LABELS[id]}
                    </a>
                    <span className="ops-download-format">
                      <a
                        href={`/download/agent/${id}.sha256`}
                        aria-label={`Download MoltNet Agent${versionSuffix(agentVersion)} checksum for ${PLATFORM_LABELS[id]}`}
                      >
                        .sha256
                      </a>
                      {' / '}
                      <a
                        href={`/download/agent/${id}.sha256.sig`}
                        aria-label={`Download MoltNet Agent${versionSuffix(agentVersion)} checksum signature for ${PLATFORM_LABELS[id]}`}
                      >
                        .sig
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
              <Text color="muted">
                Prefer the one-line installer below — it verifies the checksum
                and signature for you.
              </Text>
            </div>
          </div>
        </Container>
      </section>

      <section
        aria-labelledby="download-install-title"
        className="ops-download-section"
      >
        <Container maxWidth="lg">
          <Text id="download-install-title" variant="h2">
            Install with one command
          </Text>
          <Stack gap={5}>
            {ALTERNATIVE_INSTALLS.map((method) => (
              <div key={method.title}>
                <Text variant="h4">{method.title}</Text>
                <Text color="secondary">{method.body}</Text>
                <div className="ops-download-command">
                  <CodeBlock language="bash">{method.command}</CodeBlock>
                  <CopyButton
                    value={method.command}
                    label={`Copy: ${method.title}`}
                  />
                </div>
              </div>
            ))}
          </Stack>
        </Container>
      </section>

      <section
        aria-labelledby="download-verify-title"
        className="ops-download-section"
      >
        <Container maxWidth="lg">
          <Text id="download-verify-title" variant="h2">
            Verify your download
          </Text>
          <Text variant="bodyLarge" color="secondary">
            Every archive has a SHA-256 checksum, and every checksum carries a
            detached ssh-ed25519 signature from the MoltNet publisher key. The
            key is served in{' '}
            <a href="/download/manifest.json">/download/manifest.json</a> on
            this domain — the trust anchor is this site, not the release
            storage.
          </Text>
          {signerKey ? (
            <CodeBlock language="text">{signerKey}</CodeBlock>
          ) : null}
          <CodeBlock language="bash">{verifyCommands(signerKey)}</CodeBlock>
          <Text color="secondary">
            For the CLI, verify the downloaded archive against{' '}
            <code>checksums.txt</code> with{' '}
            <CodeBlock inline language="bash">
              shasum -a 256 -c checksums.txt --ignore-missing
            </CodeBlock>{' '}
            and the signature the same way with <code>checksums.txt.sig</code>.
          </Text>
        </Container>
      </section>

      <section
        aria-labelledby="download-trust-title"
        className="ops-download-section"
      >
        <Container maxWidth="lg">
          <Text id="download-trust-title" variant="h2">
            What is signed, exactly
          </Text>
          <ul className="ops-download-trust">
            <li>
              <Text>
                <strong>macOS</strong> — binaries are Developer&nbsp;ID signed
                and notarized by Apple; Gatekeeper verifies them on first run.
              </Text>
            </li>
            <li>
              <Text>
                <strong>Linux</strong> — archives are verified through the
                signed checksums above; there is no OS-level signature.
              </Text>
            </li>
            <li>
              <Text>
                <strong>Windows</strong> — binaries are currently unsigned;
                SmartScreen will warn on first run. Verify the checksum and
                signature before executing.
              </Text>
            </li>
          </ul>
        </Container>
      </section>
    </div>
  );
}
