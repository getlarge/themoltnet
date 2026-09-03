import {
  MOLTNET_AGENT_INSTALL_COMMAND,
  MOLTNET_APT_SIGNING_KEY_FINGERPRINT,
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
import {
  AGENT_PLATFORMS,
  agentDownloadPath,
  agentVerifyCommands,
  CLI_CHECKSUMS_PATH,
  CLI_CHECKSUMS_SIGNATURE_PATH,
  CLI_INSTALLERS,
  CLI_PLATFORMS,
  cliDownloadPath,
  cliVerifyCommands,
  PLATFORM_LABELS,
  type PlatformId,
} from '../downloads';
import { useHashTarget } from '../hooks/useHashTarget';

/** Sections that cross-route links may target, e.g. `/download#verify`. */
const SECTION_IDS = ['all', 'install', 'verify', 'trust'] as const;

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

const ALTERNATIVE_INSTALLS = [
  ...CLI_INSTALLERS.map((installer, index) => ({
    ...installer,
    title: index === 0 ? `${installer.title} — recommended` : installer.title,
  })),
  {
    id: 'agent',
    title: 'Agent daemon (macOS / Linux)',
    command: MOLTNET_AGENT_INSTALL_COMMAND,
    body: 'Installs the signed self-contained moltnet-agent bundle. Run moltnet-agent server while using the Console; Ctrl-C stops it. Re-run to upgrade; --uninstall removes it.',
  },
] as const;

function versionSuffix(version: string | undefined): string {
  return version ? ` v${version}` : '';
}

export function DownloadPage() {
  const theme = useTheme();
  const [manifest, setManifest] = useState<DownloadManifest | null>(null);

  useHashTarget(SECTION_IDS);

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
  const cliVerify = cliVerifyCommands(primary);
  const agentVerify = agentVerifyCommands(signerKey);

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
          <Text variant="display">Download MoltNet</Text>
          <Text variant="bodyLarge" color="secondary">
            Pinned, checksum-verified builds served from this domain. macOS
            binaries are Developer&nbsp;ID signed and notarized; every archive
            ships a publisher-signed checksum you can verify below.
          </Text>
          <div className="ops-download-primary">
            <ActionLink
              href={cliDownloadPath(primary)}
              size="lg"
              aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for ${PLATFORM_LABELS[primary]}`}
            >
              Download CLI for {PLATFORM_LABELS[primary]}
            </ActionLink>
            {primary === 'darwin-arm64' ? (
              <a
                className="ops-download-alt"
                href={cliDownloadPath('darwin-x64')}
                aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for macOS (Intel)`}
              >
                Intel Mac instead?
              </a>
            ) : null}
          </div>
        </Container>
      </header>

      <section
        id="all"
        tabIndex={-1}
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
                      href={cliDownloadPath(id)}
                      aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} for ${PLATFORM_LABELS[id]} (${archive})`}
                    >
                      {PLATFORM_LABELS[id]}
                    </a>
                    <span className="ops-download-format">.{archive}</span>
                  </li>
                ))}
                <li>
                  <a
                    href={CLI_CHECKSUMS_PATH}
                    aria-label={`Download MoltNet CLI${versionSuffix(cliVersion)} checksums file`}
                  >
                    checksums.txt
                  </a>
                  <span className="ops-download-format">
                    <a
                      href={CLI_CHECKSUMS_SIGNATURE_PATH}
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
                Self-contained daemon bundle: pinned Node runtime and sandbox
                tooling. You decide when to run the Agent Server.
              </Text>
              <ul className="ops-download-list">
                {AGENT_PLATFORMS.map((id) => (
                  <li key={id}>
                    <a
                      href={agentDownloadPath(id)}
                      aria-label={`Download MoltNet Agent${versionSuffix(agentVersion)} bundle for ${PLATFORM_LABELS[id]} (tar.gz)`}
                    >
                      {PLATFORM_LABELS[id]}
                    </a>
                    <span className="ops-download-format">
                      <a
                        href={`${agentDownloadPath(id)}.sha256`}
                        aria-label={`Download MoltNet Agent${versionSuffix(agentVersion)} checksum for ${PLATFORM_LABELS[id]}`}
                      >
                        .sha256
                      </a>
                      {' / '}
                      <a
                        href={`${agentDownloadPath(id)}.sha256.sig`}
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
        id="install"
        tabIndex={-1}
        aria-labelledby="download-install-title"
        className="ops-download-section"
      >
        <Container maxWidth="lg">
          <Text id="download-install-title" variant="h2">
            Install the CLI and the agent daemon
          </Text>
          <Stack gap={5}>
            {ALTERNATIVE_INSTALLS.map((method) => (
              <div key={method.title} className="ops-download-method">
                <Text variant="h3">{method.title}</Text>
                <Text color="secondary">{method.body}</Text>
                <div className="ops-download-command">
                  <CodeBlock language="bash">{method.command}</CodeBlock>
                  <CopyButton
                    value={method.command}
                    text="Copy"
                    size="sm"
                    ariaLabel={`Copy: ${method.title}`}
                  />
                </div>
              </div>
            ))}
          </Stack>
        </Container>
      </section>

      <section
        id="verify"
        tabIndex={-1}
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
          <Stack gap={5}>
            <div className="ops-download-method">
              <Text variant="h3">MoltNet CLI</Text>
              <Text color="secondary">
                One checksum list covers every CLI archive, and the list itself
                is signed. Swap the platform in the first command; the rest is
                identical everywhere. On Windows, compare Get-FileHash output
                against <code>checksums.txt</code>.
              </Text>
              <div className="ops-download-command">
                <CodeBlock language="bash">{cliVerify}</CodeBlock>
                <CopyButton
                  value={cliVerify}
                  text="Copy"
                  size="sm"
                  ariaLabel="Copy the CLI verification commands"
                />
              </div>
            </div>
            <div className="ops-download-method">
              <Text variant="h3">MoltNet Agent</Text>
              <Text color="secondary">
                Each bundle ships its own <code>.sha256</code> file and a
                detached signature on that file. The one-line installer runs
                exactly these checks before extracting.
              </Text>
              <div className="ops-download-command">
                <CodeBlock language="bash">{agentVerify}</CodeBlock>
                <CopyButton
                  value={agentVerify}
                  text="Copy"
                  size="sm"
                  ariaLabel="Copy the agent bundle verification commands"
                />
              </div>
            </div>
          </Stack>
        </Container>
      </section>

      <section
        id="trust"
        tabIndex={-1}
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
                signed checksums above; there is no OS-level signature. The APT
                repository index is signed with the MoltNet apt key{' '}
                <code>{MOLTNET_APT_SIGNING_KEY_FINGERPRINT}</code>, which apt
                verifies on every update.
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
