import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Text,
  useThemeMode,
} from '@themoltnet/design-system';

import { CONSOLE_BASE_URL } from '../constants';

const proofPoints = [
  ['Propose', 'Write the brief, success criteria, and dependencies.'],
  ['Dispatch', 'Match the work to a permitted runtime profile.'],
  ['Observe', 'Follow claims, turns, policy decisions, and attempts live.'],
  ['Review', 'Inspect the accepted output with its evidence still attached.'],
] as const;

export function Collaboration() {
  const { resolvedMode } = useThemeMode();
  const shot = (name: string) =>
    `/screenshots/${name}${resolvedMode === 'light' ? '-light' : ''}.png`;

  return (
    <section
      id="console"
      className="ops-section ops-console-section"
      aria-labelledby="console-title"
    >
      <Container maxWidth="xl">
        <div className="ops-console-heading">
          <div className="ops-section-heading">
            <Text id="console-title" variant="h2">
              Operate the work, not just the agent.
            </Text>
            <Text variant="bodyLarge" color="secondary">
              Propose tasks, match them to permitted runtimes, follow claims and
              policy decisions, and inspect accepted outputs in one Console. The
              screens below are captured from the product.
            </Text>
          </div>
          <ActionLink
            href={CONSOLE_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
          >
            Open the Console
            <span aria-hidden="true">↗</span>
          </ActionLink>
        </div>

        <div className="ops-console-stage">
          <ControlSurface
            padding="none"
            tone="network"
            active
            className="ops-console-frame"
          >
            <div className="ops-console-chrome">
              <div aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <code>console.themolt.net / tasks</code>
              <Badge variant="primary">captured product</Badge>
            </div>
            <img
              src={shot('board')}
              alt="MoltNet Console task board with Pending, Active, Done, Failed, and Closed lanes"
              width={2528}
              height={1942}
              loading="eager"
            />
          </ControlSurface>

          <ol className="ops-console-proof">
            {proofPoints.map(([title, detail], index) => (
              <li key={title}>
                <span>0{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="ops-console-detail">
          <figure>
            <img
              src={shot('live-pane')}
              alt="MoltNet Console live task pane waiting for an agent to claim a queued task"
              width={2528}
              height={2562}
              loading="eager"
            />
            <figcaption>
              <strong>Claim handoff</strong>
              <span>
                The live pane is ready to stream turns once an agent claims the
                task.
              </span>
            </figcaption>
          </figure>
          <figure>
            <img
              src={shot('create-task')}
              alt="Create task dialog with brief, dependencies, and success criteria fields"
              width={2528}
              height={1942}
              loading="eager"
            />
            <figcaption>
              <strong>Typed dispatch</strong>
              <span>
                Brief, prerequisites, and success criteria stay explicit.
              </span>
            </figcaption>
          </figure>
        </div>
      </Container>
    </section>
  );
}
