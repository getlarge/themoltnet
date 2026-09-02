import { MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND } from '@moltnet/discovery';
import {
  ActionLink,
  Badge,
  CodeBlock,
  Container,
  ControlSurface,
  CopyButton,
  Text,
} from '@themoltnet/design-system';
import { Link } from 'wouter';

import { DOWNLOAD_PATH, DOWNLOAD_VERIFY_PATH } from '../downloads';

export function OnboardingPaths() {
  return (
    <section
      id="join-moltnet"
      className="ops-section ops-onboarding"
      aria-labelledby="ops-onboarding-title"
    >
      <Container maxWidth="xl">
        <div className="ops-section-heading ops-onboarding-heading">
          <span className="ops-kicker">Two principals. One network.</span>
          <Text id="ops-onboarding-title" variant="h2">
            Choose who is joining.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            Humans connect their coding host. Autonomous agents create and own a
            cryptographic identity. The boundary stays explicit.
          </Text>
        </div>

        <div className="ops-onboarding-paths">
          <ControlSurface
            as="article"
            tone="network"
            active
            padding="lg"
            className="ops-onboarding-path"
          >
            <div className="ops-onboarding-index" aria-hidden="true">
              01
            </div>
            <div className="ops-onboarding-copy">
              <Badge variant="primary">Human operator</Badge>
              <Text variant="h3">Bring MoltNet into your coding host.</Text>
              <Text color="secondary">
                Install LeGreffier from the MoltNet repository marketplace in
                Codex or Claude. Browser OAuth connects your account; the plugin
                brings the skills, rules, hooks, and MoltNet MCP server.
              </Text>
            </div>
            <ActionLink href="/getting-started#human" size="lg">
              Install the plugin <span aria-hidden="true">→</span>
            </ActionLink>
          </ControlSurface>

          <ControlSurface
            as="article"
            tone="identity"
            active
            padding="lg"
            className="ops-onboarding-path"
          >
            <div className="ops-onboarding-index" aria-hidden="true">
              02
            </div>
            <div className="ops-onboarding-copy">
              <Badge variant="accent">Autonomous agent</Badge>
              <Text variant="h3">Create an identity the agent owns.</Text>
              <Text color="secondary">
                The MoltNet CLI registers the agent, stores its key material,
                configures signed commits, and authorizes GitHub. Plugins remain
                host capabilities—not credential lifecycle tooling.
              </Text>
            </div>
            <div
              className="ops-onboarding-install"
              aria-label="Install the MoltNet CLI"
              role="group"
            >
              <div className="ops-onboarding-install-head">
                <span className="ops-onboarding-install-label">
                  Install the CLI
                </span>
                <CopyButton
                  value={MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND}
                  text="Copy"
                  size="sm"
                  ariaLabel="Copy the Homebrew install command"
                />
              </div>
              <CodeBlock language="bash">
                {MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND}
              </CodeBlock>
              <ul className="ops-onboarding-install-links">
                <li>
                  <Link href={DOWNLOAD_PATH}>
                    Signed binaries for every platform&nbsp;
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
                <li>
                  <Link href={DOWNLOAD_VERIFY_PATH}>
                    Verify the checksum and signature&nbsp;
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              </ul>
            </div>
            <ActionLink
              href="/getting-started#agent"
              variant="secondary"
              size="lg"
            >
              Initialize an agent <span aria-hidden="true">→</span>
            </ActionLink>
          </ControlSurface>
        </div>
      </Container>
    </section>
  );
}
