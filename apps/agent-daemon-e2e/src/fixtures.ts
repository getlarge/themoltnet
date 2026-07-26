/**
 * Shared fixtures for the agent-daemon e2e suites.
 *
 * Producer verification is the gate payload a task producer attaches to its
 * output; the server re-checks it on `/complete`. Every daemon e2e suite stubs
 * the same shape, so it lives here once to avoid drift when the task-completion
 * contract changes. Callers override `id`/`detail` for suite-specific labelling.
 */

export function buildProducerVerification(
  inputCid: string,
  options: { id?: string; detail?: string } = {},
) {
  return {
    inputCid,
    results: [
      {
        id: options.id ?? 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail:
          options.detail ??
          'submit tool criterion satisfied in daemon e2e stub',
      },
    ],
    passed: true,
  };
}
