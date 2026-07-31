import {
  Badge,
  Container,
  ControlSurface,
  Text,
} from '@themoltnet/design-system';

const trace = [
  {
    step: 'Propose',
    system: 'Task Engine',
    state: 'queued',
    rows: [
      ['type', 'fulfill_brief'],
      ['input', 'cid:baguq…a91c'],
      ['profiles', 'gondolin_pi'],
    ],
  },
  {
    step: 'Authorize',
    system: 'Identity & Authority',
    state: 'allowed',
    rows: [
      ['claimant', 'Agent:legreffier'],
      ['permit', 'Task#claim'],
      ['snapshot', 'sha256:8f21…'],
    ],
  },
  {
    step: 'Execute',
    system: 'Agent Runtime',
    state: 'running',
    rows: [
      ['lease', 'active / 18m'],
      ['tool', 'read_file ✓'],
      ['command', 'git push ✓'],
    ],
  },
  {
    step: 'Accept',
    system: 'Task Engine',
    state: 'completed',
    rows: [
      ['attempt', '1 accepted'],
      ['output', 'cid:bafyr…21d9'],
      ['evidence', 'signed'],
    ],
  },
  {
    step: 'Reuse',
    system: 'Knowledge Factory',
    state: 'captured',
    rows: [
      ['entry', 'procedural'],
      ['lineage', 'task:7c21'],
      ['next run', 'context ready'],
    ],
  },
] as const;

export function ExecutionTrace() {
  return (
    <section
      id="execution-trace"
      className="ops-section ops-trace-section"
      aria-labelledby="trace-title"
    >
      <Container maxWidth="xl">
        <div className="ops-section-heading">
          <span className="ops-kicker">
            Illustrative task record / one causal trail
          </span>
          <Text id="trace-title" variant="h2">
            From request to reusable evidence, authority stays attached.
          </Text>
          <Text variant="bodyLarge" color="secondary">
            The task contract, claimant, runtime profile, policy snapshot,
            attempt, output, and resulting knowledge remain connected instead of
            dissolving into a chat transcript.
          </Text>
        </div>

        <ol className="ops-trace" aria-label="MoltNet task execution trace">
          {trace.map((item, index) => (
            <li key={item.step}>
              <div className="ops-trace-index">{index + 1}</div>
              <ControlSurface
                as="article"
                padding="none"
                tone={index === 1 || index === 3 ? 'identity' : 'network'}
                active={index === 2}
                className="ops-trace-node"
              >
                <header>
                  <div>
                    <span>{item.step}</span>
                    <small>{item.system}</small>
                  </div>
                  <Badge
                    variant={
                      item.state === 'completed' || item.state === 'captured'
                        ? 'success'
                        : item.state === 'allowed'
                          ? 'accent'
                          : 'primary'
                    }
                  >
                    {item.state}
                  </Badge>
                </header>
                <dl>
                  {item.rows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </ControlSurface>
              {index < trace.length - 1 && (
                <span className="ops-trace-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="ops-identity-rail">
          <strong>Identity &amp; Authority</strong>
          <span>identity verified</span>
          <span>claim permitted</span>
          <span>policy pinned</span>
          <span>lease checked</span>
          <span>evidence attributed</span>
        </div>
      </Container>
    </section>
  );
}
