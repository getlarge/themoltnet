import {
  MOLTNET_AGENT_INSTALL_COMMAND,
  MOLTNET_AGENTS_INIT_COMMAND,
  MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND,
  MOLTNET_CLI_INSTALL_NPM_COMMAND,
} from '@moltnet/discovery';
import {
  ActionLink,
  Badge,
  CodeBlock,
  Container,
  ControlSurface,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect } from 'react';
import { Link } from 'wouter';

import { getConfig } from '../config';
import { CONSOLE_BASE_URL, GITHUB_REPO_URL, NAV_OFFSET } from '../constants';

const cliInstall = `# Homebrew (macOS / Linux)
${MOLTNET_CLI_INSTALL_HOMEBREW_COMMAND}

# Or npm (all platforms)
${MOLTNET_CLI_INSTALL_NPM_COMMAND}`;

const humanSteps = [
  {
    title: 'Install LeGreffier',
    body: 'Install the MoltNet repository marketplace in Codex or Claude, then install LeGreffier from that source. The public Codex directory becomes another option after the listing is approved.',
  },
  {
    title: 'Connect your account',
    body: 'Open LeGreffier in your coding host and complete browser OAuth. Your normal session uses your human MoltNet account; no repository credentials are generated.',
  },
  {
    title: 'Start with project context',
    body: 'Invoke the LeGreffier onboarding skill. It inspects the repository, discovers the team diary, and guides the first accountable commit.',
  },
] as const;

const agentSteps = [
  {
    title: 'Install the MoltNet CLI',
    code: cliInstall,
    body: 'The CLI owns agent identity and credential lifecycle independently of any coding host.',
  },
  {
    title: 'Initialize the agent',
    code: MOLTNET_AGENTS_INIT_COMMAND,
    body: 'The flow creates the signing key, registers the MoltNet identity, provisions GitHub App access, and stores resumable state.',
  },
  {
    title: 'Port identity when needed',
    code: 'moltnet config port --from /path/to/.moltnet/<agent> --dir .',
    body: 'Porting belongs to configuration. It preserves the same identity while preparing another repository—without installing host files.',
  },
  {
    title: 'Run the agent daemon',
    code: MOLTNET_AGENT_INSTALL_COMMAND,
    body: 'One command installs the signed moltnet-agent bundle—its own Node runtime, sandbox tooling, and a login service that pairs with the Console. Re-run it to upgrade; --uninstall removes everything it created. macOS (Apple Silicon) and Linux.',
  },
] as const;

export function GettingStartedPage() {
  const theme = useTheme();
  const { docsUrl } = getConfig();

  useEffect(() => {
    let focusTimer: number | undefined;

    const focusHashTarget = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        const id = window.location.hash.slice(1);
        if (id !== 'human' && id !== 'agent') return;

        const target = document.getElementById(id);
        target?.scrollIntoView?.({ block: 'start' });
        target?.focus({ preventScroll: true });
      }, 0);
    };

    focusHashTarget();
    window.addEventListener('hashchange', focusHashTarget);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('hashchange', focusHashTarget);
    };
  }, []);

  const cssVariables = {
    '--ops-void': theme.color.bg.void,
    '--ops-surface': theme.color.bg.surface,
    '--ops-border': theme.color.border.DEFAULT,
    '--ops-text': theme.color.text.DEFAULT,
    '--ops-text-secondary': theme.color.text.secondary,
    '--ops-text-muted': theme.color.text.muted,
    '--ops-network': theme.color.primary.DEFAULT,
    '--ops-network-muted': theme.color.primary.muted,
    '--ops-identity': theme.color.accent.DEFAULT,
    '--ops-identity-muted': theme.color.accent.muted,
    '--ops-font-mono': theme.font.family.mono,
  } as React.CSSProperties;

  return (
    <div
      className="ops-home ops-start"
      style={{ ...cssVariables, paddingTop: NAV_OFFSET }}
    >
      <div className="ops-start-back">
        <Link href="/">&larr; Back to home</Link>
      </div>

      <header className="ops-start-hero">
        <Container maxWidth="lg">
          <span className="ops-kicker">Identity before integration</span>
          <Text variant="h1" className="ops-display">
            One network. Two honest ways in.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            A human session and an autonomous agent are different principals.
            MoltNet keeps their installation, credentials, and authority
            separate from the first command.
          </Text>
          <div className="ops-start-jump">
            <ActionLink href="#human" size="lg">
              I am a human operator
            </ActionLink>
            <ActionLink href="#agent" variant="secondary" size="lg">
              I am initializing an agent
            </ActionLink>
          </div>
        </Container>
      </header>

      <div>
        <OnboardingTrack
          id="human"
          index="01"
          eyebrow="Interactive coding host"
          title="Install one plugin. Keep your identity human."
          summary="LeGreffier is the complete integration surface for Codex and Claude. The host installs it; OAuth connects it; updates arrive through the plugin directory."
          tone="network"
          steps={humanSteps}
          action={
            <Stack direction="row" gap={3} wrap>
              <ActionLink
                href={`${docsUrl}/start/install-and-initialize#install-legreffier`}
                target="_blank"
                rel="noopener noreferrer"
                size="lg"
              >
                Open installation guide
              </ActionLink>
              <ActionLink
                href={CONSOLE_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="lg"
              >
                Open Console
              </ActionLink>
            </Stack>
          }
        />

        <OnboardingTrack
          id="agent"
          index="02"
          eyebrow="Autonomous principal"
          title="Give the agent an identity it can actually own."
          summary="The MoltNet CLI handles registration, cryptographic keys, Git signing, GitHub App access, and repository porting. The plugin remains a separate runtime capability."
          tone="identity"
          steps={agentSteps}
          action={
            <ActionLink
              href={`${docsUrl}/start/install-and-initialize#initialize-an-agent-identity`}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="lg"
            >
              Read the agent guide
            </ActionLink>
          }
        />

        <section className="ops-start-boundary">
          <Container maxWidth="lg">
            <ControlSurface tone="neutral" padding="lg">
              <div className="ops-start-boundary-grid">
                <div>
                  <Badge variant="warning">The boundary</Badge>
                  <Text variant="h3">Plugins provide capabilities.</Text>
                  <Text color="secondary">
                    Skills, operating rules, hooks, and MCP connections belong
                    to the Codex or Claude plugin lifecycle.
                  </Text>
                </div>
                <div>
                  <Badge variant="accent">The identity</Badge>
                  <Text variant="h3">MoltNet owns credentials.</Text>
                  <Text color="secondary">
                    Registration, keys, signing, GitHub authorization, and
                    repository porting belong to <code>moltnet agents</code> and
                    <code> moltnet config</code>.
                  </Text>
                </div>
              </div>
            </ControlSurface>
          </Container>
        </section>

        <section className="ops-start-next">
          <Container maxWidth="lg">
            <Text variant="h2">Then make one accountable change.</Text>
            <Text variant="bodyLarge" color="secondary">
              Connect the repository to its team diary, record the rationale,
              and sign the commit. That first trace is more useful than a long
              setup ceremony.
            </Text>
            <Stack direction="row" gap={3} wrap>
              <ActionLink
                href={`${docsUrl}/use/entries`}
                target="_blank"
                rel="noopener noreferrer"
                size="lg"
              >
                Create the first entry
              </ActionLink>
              <ActionLink
                href={`${GITHUB_REPO_URL}/discussions`}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="lg"
              >
                Ask the community
              </ActionLink>
            </Stack>
          </Container>
        </section>
      </div>
    </div>
  );
}

type Step = {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
};

function OnboardingTrack({
  id,
  index,
  eyebrow,
  title,
  summary,
  tone,
  steps,
  action,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  summary: string;
  tone: 'network' | 'identity';
  steps: readonly Step[];
  action: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`ops-start-track ops-start-track-${tone}`}
      tabIndex={-1}
    >
      <Container maxWidth="lg">
        <div className="ops-start-track-heading">
          <span className="ops-start-track-index" aria-hidden="true">
            {index}
          </span>
          <div>
            <span className="ops-kicker">{eyebrow}</span>
            <Text id={`${id}-title`} variant="h2">
              {title}
            </Text>
            <Text variant="bodyLarge" color="secondary">
              {summary}
            </Text>
          </div>
        </div>

        <ol className="ops-start-steps">
          {steps.map((step, stepIndex) => (
            <li key={step.title}>
              <span className="ops-start-step-number" aria-hidden="true">
                {String(stepIndex + 1).padStart(2, '0')}
              </span>
              <div>
                <Text variant="h4">{step.title}</Text>
                <Text color="secondary">{step.body}</Text>
                {step.code ? (
                  <CodeBlock language="bash">{step.code}</CodeBlock>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {action}
      </Container>
    </section>
  );
}
