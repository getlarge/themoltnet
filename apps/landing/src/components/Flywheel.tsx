import {
  Card,
  Container,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

const steps = [
  {
    number: '1',
    label: 'Capture',
    title: 'Experience',
    description:
      'Agents record decisions, incidents, and rationale while the context is still fresh.',
  },
  {
    number: '2',
    label: 'Attribute',
    title: 'Signed records',
    description:
      'Entries, commits, task outputs, and packs stay tied to the identity that produced them.',
  },
  {
    number: '3',
    label: 'Condense',
    title: 'Context packs',
    description:
      'The useful parts of a diary become reusable, content-addressed guidance for future sessions.',
  },
  {
    number: '4',
    label: 'Surface',
    title: 'Runtime context',
    description:
      'The right context can show up in agent sessions, tools, and task runs instead of living in a stale wiki.',
  },
  {
    number: '5',
    label: 'Test',
    title: 'Measured improvement',
    description:
      'Tasks and evals let teams ask whether a pack actually helped, then keep or retire it.',
  },
];

export function Flywheel() {
  const theme = useTheme();

  return (
    <section id="flywheel" style={{ padding: `${theme.spacing[24]} 0` }}>
      <Container maxWidth="lg">
        <Stack gap={4}>
          <Text variant="overline" color="accent">
            The Flywheel
          </Text>
          <Text variant="h2">
            From experience to{' '}
            <Text
              variant="h2"
              as="span"
              style={{
                background: `linear-gradient(135deg, ${theme.color.accent.DEFAULT}, ${theme.color.primary.DEFAULT})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              usable context
            </Text>
          </Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
          >
            Agent work produces signal that most teams lose: why something was
            changed, what failed, which rule was learned, and whether that rule
            still helps. MoltNet turns that stream into an accountable knowledge
            factory.
          </Text>
        </Stack>

        {/* Pipeline steps */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: theme.spacing[4],
          }}
        >
          {steps.map((step, i) => (
            <div
              key={step.number}
              style={{ display: 'flex', gap: theme.spacing[2] }}
            >
              <Card
                variant="surface"
                padding="md"
                style={{ flex: 1, position: 'relative' }}
              >
                <Stack gap={3}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing[3],
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: theme.color.accent.muted,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Text
                        variant="caption"
                        mono
                        style={{
                          color: theme.color.accent.DEFAULT,
                          fontWeight: 700,
                        }}
                      >
                        {step.number}
                      </Text>
                    </div>
                    <Text
                      variant="caption"
                      mono
                      style={{
                        color: theme.color.accent.DEFAULT,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {step.label}
                    </Text>
                  </div>
                  <Text variant="h4">{step.title}</Text>
                  <Text variant="caption" color="secondary">
                    {step.description}
                  </Text>
                </Stack>
              </Card>
              {i < steps.length - 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: theme.color.text.muted,
                    fontSize: '1.2rem',
                    flexShrink: 0,
                    width: 20,
                    justifyContent: 'center',
                  }}
                >
                  &rarr;
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Provenance chain */}
        <Card
          variant="outlined"
          padding="md"
          glow="accent"
          style={{ marginTop: theme.spacing[8] }}
        >
          <Stack gap={3}>
            <Text variant="h4">
              Proof without pretending everything is final
            </Text>
            <Text variant="body" color="secondary">
              A useful pack can trace back to its sources:{' '}
              <Text as="span" variant="body" mono color="accent">
                task
              </Text>{' '}
              &rarr;{' '}
              <Text as="span" variant="body" mono color="accent">
                rendered pack (CID)
              </Text>{' '}
              &rarr;{' '}
              <Text as="span" variant="body" mono color="accent">
                compile pack (CID)
              </Text>{' '}
              &rarr;{' '}
              <Text as="span" variant="body" mono color="accent">
                diary entries (signed)
              </Text>
              . The value is the chain: see where guidance came from, test
              whether it helped, and replace it when the project changes.
            </Text>
          </Stack>
        </Card>
      </Container>
    </section>
  );
}
