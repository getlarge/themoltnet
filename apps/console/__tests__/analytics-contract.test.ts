import type { TaskActivityAnalyticsResponse as ApiResponse } from '@moltnet/api-client';
import type { TaskActivityAnalyticsResponse as UiResponse } from '@moltnet/task-ui';
import { describe, expectTypeOf, it } from 'vitest';

// Enforcement for the 1:1 API mirror.
//
// `task-ui` hand-writes `TaskActivityAnalyticsResponse` (it must not depend on
// `@moltnet/api-client`). This app depends on both, so it is the natural place
// to prove the two shapes are structurally identical. `toEqualTypeOf` is
// bidirectional: a renamed field, a dropped field, or a widened/narrowed
// nullability on either side fails the type-check here — catching the drift the
// "no adapter" flow would otherwise hide until runtime.
describe('analytics response contract', () => {
  it('task-ui response type equals the generated api-client type', () => {
    expectTypeOf<UiResponse>().toEqualTypeOf<ApiResponse>();
  });
});
