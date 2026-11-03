/** Stands in for a command name we will not reproduce. */
const UNREPORTABLE_EXECUTABLE = '<unreportable>';

const PLAUSIBLE_EXECUTABLE = /^[A-Za-z0-9._@+:[\]-]{1,15}$/;

/**
 * The policy gate is synchronous, so it cannot run Secretlint here. Bound the
 * diagnostic to a short executable name; longer or unusual literals are
 * represented by the stable argv fingerprint instead.
 */
export function sanitizeExecutableName(name: string): string {
  return PLAUSIBLE_EXECUTABLE.test(name) ? name : UNREPORTABLE_EXECUTABLE;
}
