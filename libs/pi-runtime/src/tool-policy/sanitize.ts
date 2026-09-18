import { redactKnownSecretShapes } from '../redact.js';

/**
 * What a plausible executable name looks like once the analyzer has stripped
 * any directory: a bounded token of portable filename characters, plus the
 * punctuation that names real shell builtins (`:`, `[`).
 */
const PLAUSIBLE_EXECUTABLE = /^[A-Za-z0-9._@+:[\]-]{1,64}$/;

/** Stands in for a command name we will not reproduce. */
export const UNREPORTABLE_EXECUTABLE = '<unreportable>';

/**
 * Bound a command name before it reaches a durable sink.
 *
 * The executable name is model-controlled: whatever the model writes in
 * command position becomes the "executable" the gate reports, and refusals are
 * persisted to the task record, the daemon log and the trace. Without this, a
 * secret written in command position is copied verbatim into all three, which
 * is exactly the content those records are supposed not to carry.
 *
 * Two bounds, in order:
 *
 * 1. Known credential shapes are redacted outright.
 * 2. Anything that does not look like an executable name — too long, or
 *    outside portable filename characters — is replaced wholesale.
 *
 * Limits, stated plainly: this bounds the *shape* of what is reported. A short
 * secret made only of filename characters and matching no known token shape
 * still passes, and the {@link MissingShellCommand} fingerprint remains the
 * reliable identifier. Narrowing further would mean refusing to name the
 * program an operator needs to see, so this is the deliberate stopping point
 * until #1294's content-aware processing can be applied here too.
 */
export function sanitizeExecutableName(name: string): string {
  if (redactKnownSecretShapes(name) !== name) {
    return UNREPORTABLE_EXECUTABLE;
  }
  return PLAUSIBLE_EXECUTABLE.test(name) ? name : UNREPORTABLE_EXECUTABLE;
}
