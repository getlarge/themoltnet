import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUDGETS,
  DEFAULT_DOCS_RESERVE_SHARE,
  resolveBudgets,
} from './budgets.js';

describe('resolveBudgets', () => {
  it('reserves a share of the diff for docs unless configured', () => {
    // Act
    const defaults = resolveBudgets();
    const smallTotal = resolveBudgets({ diffTotalBytes: 8_000 });
    const configured = resolveBudgets({
      diffTotalBytes: 8_000,
      diffDocsReserveBytes: 0,
    });

    // Assert
    expect(defaults.diffDocsReserveBytes).toBe(
      DEFAULT_BUDGETS.diffTotalBytes * DEFAULT_DOCS_RESERVE_SHARE,
    );
    expect(smallTotal.diffDocsReserveBytes).toBe(2_000);
    expect(configured.diffDocsReserveBytes).toBe(0);
  });

  it('keeps a default when a key is set to undefined', () => {
    // Act
    const budgets = resolveBudgets({
      diffTotalBytes: undefined,
      stageRunningTimeoutSec: undefined,
    });

    // Assert
    expect(budgets.diffTotalBytes).toBe(DEFAULT_BUDGETS.diffTotalBytes);
    expect(budgets.stageRunningTimeoutSec).toBe(
      DEFAULT_BUDGETS.stageRunningTimeoutSec,
    );
  });
});
