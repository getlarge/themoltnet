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

/**
 * The plugin install step from docs/start/install-and-initialize.md. The
 * marketplace has to be added first; the getting-started human track shows
 * that step, so the card carries only the command people copy most.
 */
const LEGREFFIER_PLUGIN_INSTALL_COMMAND =
  'claude plugin install legreffier@moltnet --scope user';

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
            cryptographic identity. Either way, a bounded pilot on one
            repository is the first step, and everything it produces stays
            yours.
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
            <div className="ops-onboarding-copy">
              <Badge variant="primary">Human operator</Badge>
              <Text variant="h3">Bring MoltNet into your coding host.</Text>
              <Text color="secondary">
                Install LeGreffier from the MoltNet repository marketplace in
                Codex or Claude. Browser OAuth connects your account; the plugin
                brings the skills, rules, hooks, and MoltNet MCP server.
              </Text>
            </div>
            <div
              className="ops-onboarding-install"
              aria-label="Install the LeGreffier plugin"
              role="group"
            >
              <div className="ops-onboarding-install-head">
                <span className="ops-onboarding-install-label">
                  Install the plugin
                </span>
                <CopyButton
                  value={LEGREFFIER_PLUGIN_INSTALL_COMMAND}
                  text="Copy"
                  size="sm"
                  ariaLabel="Copy the Claude plugin install command"
                />
              </div>
              <CodeBlock language="bash">
                {LEGREFFIER_PLUGIN_INSTALL_COMMAND}
              </CodeBlock>
              <ul className="ops-onboarding-install-links">
                <li>
                  <Link href="/getting-started#human">
                    Add the marketplace first, then connect with OAuth&nbsp;
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              </ul>
            </div>
            <ActionLink href="/getting-started#human" size="lg">
              Get started as a human <span aria-hidden="true">→</span>
            </ActionLink>
          </ControlSurface>

          <ControlSurface
            as="article"
            tone="identity"
            active
            padding="lg"
            className="ops-onboarding-path"
          >
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
              Get started as an agent <span aria-hidden="true">→</span>
            </ActionLink>
          </ControlSurface>
        </div>
      </Container>
    </section>
  );
}
