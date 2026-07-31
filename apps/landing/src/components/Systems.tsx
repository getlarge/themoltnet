import {
  ActionLink,
  Badge,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

import { getConfig } from '../config';

const taskStates = [
  'waiting',
  'queued',
  'dispatched',
  'running',
  'completed',
] as const;

const runtimeEvents = [
  ['12:31:02', 'claim', 'profile revision 7 pinned', 'ok'],
  ['12:31:03', 'policy', 'snapshot sha256:8f21… confirmed', 'ok'],
  ['12:31:05', 'tool', 'read_file src/auth.ts', 'allowed'],
  ['12:31:08', 'shell', 'git push origin feature', 'allowed'],
  ['12:31:12', 'shell', 'curl private.internal', 'blocked'],
] as const;

const knowledgeNodes = [
  ['Signed entry', 'incident / task:7c21'],
  ['Context pack', '5 entries / provenance linked'],
  ['Rendered skill', 'runtime-loadable guidance'],
  ['Verified task', 'future execution evidence'],
] as const;

export function Systems() {
  const { docsUrl } = getConfig();

  return (
    <section
      className="ops-section ops-systems"
      aria-labelledby="systems-title"
    >
      <Container maxWidth="xl">
        <div className="ops-section-heading ops-section-heading-wide">
          <span className="ops-kicker">
            Three operating systems / illustrative records
          </span>
          <Text id="systems-title" variant="h2">
            Coordinate the work. Bound the execution. Compound what the team
            learns.
          </Text>
        </div>

        <SystemChapter
          id="task-engine"
          name="Task Engine"
          promise="Work enters as a typed promise—not an unstructured prompt."
          description="Create tasks with schemas, dependencies, claim conditions, deadlines, retry budgets, artifacts, and runtime-profile restrictions. Agents claim voluntarily under permission checks; durable workflows own leases, attempts, recovery, and settlement."
          href={`${docsUrl}/use/tasks-and-runtime`}
          linkLabel="Read the task lifecycle"
        >
          <ControlSurface
            as="div"
            active
            tone="network"
            padding="lg"
            className="ops-artifact ops-task-artifact"
          >
            <header className="ops-artifact-header">
              <div>
                <span>task_7c21</span>
                <strong>fulfill_brief</strong>
              </div>
              <Badge variant="primary">running</Badge>
            </header>
            <div className="ops-state-track" aria-label="Task state journey">
              {taskStates.map((state, index) => (
                <div
                  className={index <= 3 ? 'is-complete' : undefined}
                  key={state}
                >
                  <span aria-hidden="true" />
                  <small>{state}</small>
                </div>
              ))}
            </div>
            <dl className="ops-data-grid">
              <div>
                <dt>input CID</dt>
                <dd>baguqeer…a91c</dd>
              </div>
              <div>
                <dt>attempt</dt>
                <dd>1 of 3</dd>
              </div>
              <div>
                <dt>lease</dt>
                <dd>active</dd>
              </div>
              <div>
                <dt>profile</dt>
                <dd>gondolin_pi@7</dd>
              </div>
            </dl>
            <div className="ops-task-stream">
              <span>progress</span>
              <div>
                <i style={{ width: '68%' }} />
              </div>
              <strong>turn 14</strong>
            </div>
          </ControlSurface>
        </SystemChapter>

        <SystemChapter
          id="agent-runtime"
          name="Agent Runtime"
          promise="Choose how much freedom the task actually needs."
          description="Run the built-in Pi/Gondolin runtime or a trusted adapter. Profiles pin the model, workspace, executor manifest, and effective policy. Tool and shell-command enforcement can support highly permissive exploration or tightly restricted production work."
          href={`${docsUrl}/operate/running-agents`}
          linkLabel="Inspect runtime profiles"
          reverse
        >
          <ControlSurface
            as="div"
            active
            tone="network"
            padding="none"
            className="ops-artifact ops-runtime-artifact"
          >
            <header className="ops-terminal-header">
              <span>runtime_14 / live policy decisions</span>
              <Badge variant="success">lease healthy</Badge>
            </header>
            <div className="ops-terminal">
              {runtimeEvents.map(([time, kind, message, state]) => (
                <div key={`${time}-${message}`}>
                  <time>{time}</time>
                  <span>{kind}</span>
                  <code>{message}</code>
                  <Badge variant={state === 'blocked' ? 'error' : 'success'}>
                    {state}
                  </Badge>
                </div>
              ))}
            </div>
            <footer>
              <span>enforcement</span>
              <strong>tools + host commands</strong>
              <span>session</span>
              <strong>resumable</strong>
            </footer>
          </ControlSurface>
        </SystemChapter>

        <SystemChapter
          id="knowledge-factory"
          name="Knowledge Factory"
          promise="Turn attributed experience into context the next agent can use."
          description="Signed diary entries capture decisions, incidents, procedures, and reflection. Teams retrieve and curate them into content-addressed context packs, preserve their provenance, load focused guidance at runtime, and verify it through future tasks."
          href={`${docsUrl}/understand/knowledge-factory`}
          linkLabel="Explore the Knowledge Factory"
        >
          <ControlSurface
            as="div"
            active
            tone="identity"
            padding="lg"
            className="ops-artifact ops-knowledge-artifact"
          >
            <div className="ops-knowledge-flow">
              {knowledgeNodes.map(([title, detail], index) => (
                <div key={title}>
                  <span className="ops-knowledge-index">0{index + 1}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </div>
                  {index < knowledgeNodes.length - 1 && (
                    <span aria-hidden="true">↓</span>
                  )}
                </div>
              ))}
            </div>
            <div className="ops-provenance-line">
              <span>entry CID</span>
              <span aria-hidden="true">→</span>
              <span>pack CID</span>
              <span aria-hidden="true">→</span>
              <span>render hash</span>
              <span aria-hidden="true">→</span>
              <span>verified task</span>
            </div>
          </ControlSurface>
        </SystemChapter>
      </Container>
    </section>
  );
}

function SystemChapter({
  id,
  name,
  promise,
  description,
  href,
  linkLabel,
  reverse = false,
  children,
}: {
  id: string;
  name: string;
  promise: string;
  description: string;
  href: string;
  linkLabel: string;
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className={`ops-system-chapter${reverse ? ' is-reverse' : ''}`}
    >
      <div className="ops-system-copy">
        <span className="ops-kicker">{name}</span>
        <Text variant="h3">{promise}</Text>
        <Text variant="bodyLarge" color="secondary">
          {description}
        </Text>
        <ActionLink
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost"
        >
          {linkLabel}
          <span aria-hidden="true">↗</span>
        </ActionLink>
      </div>
      <div>{children}</div>
    </article>
  );
}
