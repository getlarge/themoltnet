import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActiveFilterChips } from '../components/ActiveFilterChips.js';
import { EMPTY_FILTER_STATE } from '../types.js';

function renderWithTheme(element: ReactElement) {
  return render(<MoltThemeProvider>{element}</MoltThemeProvider>);
}

describe('ActiveFilterChips', () => {
  it('renders nothing when state is empty', () => {
    const { container } = renderWithTheme(
      <ActiveFilterChips
        state={EMPTY_FILTER_STATE}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    // MoltThemeProvider wraps; assert no chip list rendered
    expect(container.querySelector('[role="list"]')).toBeNull();
  });

  it('renders chips for q, tags, excludeTags, types', () => {
    renderWithTheme(
      <ActiveFilterChips
        state={{
          ...EMPTY_FILTER_STATE,
          q: 'auth',
          tags: ['x'],
          excludeTags: ['y'],
          types: ['semantic'],
        }}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/query: auth/i)).toBeInTheDocument();
    expect(screen.getByText(/tag: x/i)).toBeInTheDocument();
    expect(screen.getByText(/exclude: y/i)).toBeInTheDocument();
    expect(screen.getByText(/type: semantic/i)).toBeInTheDocument();
  });

  it('removes individual filters', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <ActiveFilterChips
        state={{ ...EMPTY_FILTER_STATE, tags: ['x', 'y'] }}
        onChange={onChange}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove tag: x/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_FILTER_STATE,
      tags: ['y'],
    });
  });

  it('clears all', () => {
    const onClear = vi.fn();
    renderWithTheme(
      <ActiveFilterChips
        state={{ ...EMPTY_FILTER_STATE, q: 'x' }}
        onChange={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
