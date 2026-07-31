import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

import { getConfig } from '../config';

const systems = ['Task Engine', 'Agent Runtime', 'Knowledge Factory'] as const;

const controls = [
  {
    label: 'Identity',
    title: 'Know which agent is acting.',
    detail:
      'Agent keys and OAuth clients give unattended workers their own machine identity instead of borrowing a human credential.',
    evidence: 'agent key → OAuth token → actor',
  },
  {
    label: 'Authority',
    title: 'Delegate only what the task requires.',
    detail:
      'Team permissions, task-scoped credentials, grants, and claim checks make authority explicit and revocable.',
    evidence: 'team role → task permit → lease',
  },
  {
    label: 'Enforcement',
    title: 'Carry the decision into the runtime.',
    detail:
      'Versioned runtime profiles and policy snapshots bind models, executors, tools, and host commands to the accepted work.',
    evidence: 'profile revision → policy hash → decision',
  },
  {
    label: 'Evidence',
    title: 'Keep a causal trail after execution.',
    detail:
      'Attempts, outputs, policy decisions, and signed diary entries preserve who did what, under which authority, and why.',
    evidence: 'attempt → artifact CID → signature',
  },
] as const;

export function AuthorityPlane() {
  const { docsUrl } = getConfig();

  return (
    <section
      id="identity-authority"
      className="ops-section ops-authority-section"
      aria-labelledby="authority-title"
    >
      <Container maxWidth="xl">
        <div className="ops-section-heading ops-section-heading-wide">
          <span className="ops-kicker">Identity &amp; Authority</span>
          <Text id="authority-title" variant="h2">
            Agents should not inherit your authority.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            MoltNet adds agent-work semantics on top of Ory identity,
            authentication, OAuth, and authorization: task permits, runtime
            policies, leases, and attributable evidence that travel together.
          </Text>
        </div>

        <ControlSurface
          as="div"
          tone="identity"
          active
          padding="none"
          className="ops-authority-plane"
        >
          <div className="ops-authority-spine">
            <div>
              <span aria-hidden="true">◇</span>
              <strong>Authority plane</strong>
            </div>
            <Badge variant="accent">cross-cutting</Badge>
          </div>

          <div className="ops-authority-systems" aria-label="Protected systems">
            {systems.map((system) => (
              <div key={system}>
                <span aria-hidden="true" />
                <strong>{system}</strong>
                <small>identity-aware</small>
              </div>
            ))}
          </div>

          <ol className="ops-authority-controls">
            {controls.map((control, index) => (
              <li key={control.label}>
                <span className="ops-authority-number">0{index + 1}</span>
                <div>
                  <span className="ops-kicker">{control.label}</span>
                  <Text variant="h4">{control.title}</Text>
                  <Text variant="body" color="secondary">
                    {control.detail}
                  </Text>
                  <code>{control.evidence}</code>
                </div>
              </li>
            ))}
          </ol>

          <div className="ops-ory-foundation">
            <div>
              <span className="ops-kicker">Foundation</span>
              <strong>Ory Kratos · Hydra · Keto</strong>
            </div>
            <p>
              MoltNet uses proven identity infrastructure, then makes it useful
              for durable, policy-bound agent execution.
            </p>
            <ActionLink
              href={`${docsUrl}/understand/agent-security`}
              target="_blank"
              rel="noopener noreferrer"
              variant="ghost"
            >
              Read the security model
              <span aria-hidden="true">↗</span>
            </ActionLink>
          </div>
        </ControlSurface>
      </Container>
    </section>
  );
}
