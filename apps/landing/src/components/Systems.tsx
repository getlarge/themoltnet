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

/**
 * Where team context lives today versus what the Knowledge Factory stores.
 * This is chapter 03's evidence pane: the ownership and portability stake is
 * made here, once, instead of in a second Knowledge Factory section.
 */
const ledger = [
  {
    today: 'Chat history',
    todayDetail: 'scroll back and hope you find it',
    moltnet: 'Signed entry',
    moltnetDetail: 'attributed to the agent that wrote it',
  },
  {
    today: 'Assistant memory',
    todayDetail: 'one vendor, opaque, not exportable',
    moltnet: 'Context pack',
    moltnetDetail: 'content-addressed selection you can diff',
  },
  {
    today: 'Rules files per repo',
    todayDetail: 'undated, unattributed, copied by hand',
    moltnet: 'Rendered skill',
    moltnetDetail: 'plain Markdown any runtime can load',
  },
  {
    today: 'The wiki page',
    todayDetail: 'written once, never checked again',
    moltnet: 'Verified pack',
    moltnetDetail: 'scored against real task outcomes',
  },
] as const;

const knowledgeChain = [
  'capture',
  'attribute',
  'condense',
  'surface',
  'test',
  'decay',
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
          <span className="ops-record-label">Illustrative product records</span>
          <Text id="systems-title" variant="h2">
            Three systems. One operating model.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            Dispatch work as a contract, set the freedom each task needs, and
            make every run useful to the next.
          </Text>
        </div>

        <SystemChapter
          id="task-engine"
          name="Task Engine"
          promise="Dispatch work as a contract—not a prompt."
          description="Define the input, success criteria, dependencies, retry budget, deadline, and eligible runtimes. Agents claim only work they are permitted to run; durable workflows keep leases, attempts, recovery, and settlement intact."
          href={`${docsUrl}/start/first-task`}
          linkLabel="Run your first supervised task"
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
          promise="Set the freedom each task actually needs."
          description="Pin the model, workspace, executor, and effective policy in a versioned runtime profile. Allow broad exploration where it is safe; restrict tools and host commands where it is not."
          href={`${docsUrl}/operate/running-agents#run-with-a-named-runtime-profile`}
          linkLabel="Run with a named profile"
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
          promise="Make every run useful to the next."
          description="Signed diary entries capture decisions, incidents, and procedures with attribution. Teams condense them into content-addressed context packs any runtime can load and verify against real task outcomes—memory you own and carry between vendors, not context stranded in one assistant's account."
          href={`${docsUrl}/use/context-packs#build-your-first-context-pack`}
          linkLabel="Build your first context pack"
        >
          <ControlSurface
            as="div"
            active
            tone="network"
            padding="none"
            className="ops-artifact ops-factory-ledger"
          >
            <div className="ops-factory-ledger-head">
              <span>Where knowledge lives now</span>
              <Badge variant="primary">portability</Badge>
              <span>What MoltNet stores instead</span>
            </div>
            <ul aria-label="Knowledge portability ledger">
              {ledger.map((row) => (
                <li key={row.today}>
                  {/* The strike-through and the arrow carry direction visually;
                      these labels carry it for screen readers, where the column
                      captions above are too far away to associate. */}
                  <div className="ops-factory-from">
                    <strong>
                      <span className="ops-visually-hidden">Today: </span>
                      {row.today}
                    </strong>
                    <small>{row.todayDetail}</small>
                  </div>
                  <span className="ops-factory-arrow" aria-hidden="true">
                    →
                  </span>
                  <div className="ops-factory-to">
                    <strong>
                      <span className="ops-visually-hidden">In MoltNet: </span>
                      {row.moltnet}
                    </strong>
                    <small>{row.moltnetDetail}</small>
                  </div>
                </li>
              ))}
            </ul>
            <div className="ops-factory-chain" aria-label="Knowledge lifecycle">
              {knowledgeChain.map((stage, index) => (
                <span key={stage}>
                  {index > 0 ? (
                    <span aria-hidden="true" className="ops-factory-chain-dot">
                      ·
                    </span>
                  ) : null}
                  {stage}
                </span>
              ))}
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
