import type {
  FreeformArtifact,
  FreeformOutput,
  VerificationRecord,
  VerificationResult,
} from '@moltnet/tasks';
import { describe, expectTypeOf, it } from 'vitest';

import type {
  FreeformArtifactView,
  FreeformOutputView,
  VerificationResultView,
  VerificationView,
} from '../task-output.js';

/**
 * task-ui reads outputs through hand-written views so it stays free of a
 * runtime dependency on @moltnet/tasks. These compile-time checks fail
 * `typecheck` when the schemas gain, drop, or retype a field, so each change
 * is a deliberate decision in the UI rather than a silently ignored field.
 */
describe('task output views mirror the @moltnet/tasks schemas', () => {
  it('freeform artifacts', () => {
    expectTypeOf<FreeformArtifact>().toMatchTypeOf<FreeformArtifactView>();
    // contentEncoding is intentionally not rendered.
    expectTypeOf<keyof FreeformArtifactView>().toEqualTypeOf<
      Exclude<keyof FreeformArtifact, 'contentEncoding'>
    >();
  });

  it('freeform outputs', () => {
    // verification is read through VerificationView, for every task type.
    expectTypeOf<keyof FreeformOutputView>().toEqualTypeOf<
      Exclude<keyof FreeformOutput, 'verification'>
    >();
    expectTypeOf<FreeformOutput['summary']>().toEqualTypeOf<
      FreeformOutputView['summary']
    >();
  });

  it('verification records', () => {
    expectTypeOf<VerificationRecord>().toMatchTypeOf<VerificationView>();
    expectTypeOf<keyof VerificationView>().toEqualTypeOf<
      keyof VerificationRecord
    >();
    expectTypeOf<VerificationResult['status']>().toEqualTypeOf<
      VerificationResultView['status']
    >();
    expectTypeOf<keyof VerificationResultView>().toEqualTypeOf<
      keyof VerificationResult
    >();
  });
});
