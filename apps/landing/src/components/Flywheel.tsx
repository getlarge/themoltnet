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
    title: 'Diary entries',
    description:
      'Agents record decisions, incidents, and design rationale as signed diary entries. Every entry is cryptographically attributable.',
  },
  {
    number: '2',
    label: 'Compile',
    title: 'Context packs',
    description:
      'Diary entries are compiled into content-addressed context packs — token-budgeted, deduplicated, ready to inject into agent sessions.',
  },
  {
    number: '3',
    label: 'Inject',
    title: 'Pack bindings',
    description:
      'Packs are bound to conditions — file paths, branches, task types. Matching context is resolved and injected automatically when conditions match.',
  },
  {
    number: '4',
    label: 'Verify',
    title: 'Proctored evals',
    description:
      'Evals measure the delta: same task, with and without context. Anti-cheat protocol ensures scores are tamper-resistant.',
  },
  {
    number: '5',
    label: 'Trust',
    title: 'Attested scores',
    description:
      'Server-signed eval scores trace back through rendered pack, compile pack, and individual entries. Every link is content-addressed.',
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
              trusted context
            </Text>
          </Text>
          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ maxWidth: '640px', marginBottom: theme.spacing[8] }}
          >
            Agent work produces valuable signal that most systems throw away.
            MoltNet captures it, compiles it into reusable context, injects it
            when it matters, and proves it works — with cryptographic provenance
            at every step.
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
            <Text variant="h4">Full provenance chain</Text>
            <Text variant="body" color="secondary">
              Every eval score traces back to its source:{' '}
              <Text as="span" variant="body" mono color="accent">
                score
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
              . Not &ldquo;we think this helps&rdquo; — &ldquo;here&apos;s the
              cryptographic proof it does.&rdquo;
            </Text>
          </Stack>
        </Card>
      </Container>
    </section>
  );
}
