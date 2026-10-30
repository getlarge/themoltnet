import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from '../src/hooks/useDebouncedValue.js';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 250));
    expect(result.current).toBe('initial');
  });

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(249);
    });

    expect(result.current).toBe('a');
  });

  it('updates to the latest value after the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current).toBe('ab');
  });

  it('collapses rapid changes into a single settled value (no per-keystroke output)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: '' } },
    );

    // Simulate fast typing: each keystroke happens within the debounce window.
    for (const value of ['s', 'su', 'sub', 'subj']) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }

    // Mid-typing the debounced value is still the original (never emitted
    // intermediate keystrokes).
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Only the final value settles.
    expect(result.current).toBe('subj');
  });
});
