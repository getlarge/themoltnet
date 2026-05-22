import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActiveFilterChips } from '../src/components/ActiveFilterChips.js';
import { EMPTY_FILTER_STATE } from '../src/types.js';

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
    // Labels and values are rendered in separate spans (label uppercase + mono value)
    expect(screen.getByText(/^query$/i)).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getAllByText(/^tag$/i).length).toBeGreaterThan(0);
    expect(screen.getByText('x')).toBeInTheDocument();
    expect(screen.getByText(/^exclude$/i)).toBeInTheDocument();
    expect(screen.getByText('y')).toBeInTheDocument();
    expect(screen.getByText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByText('semantic')).toBeInTheDocument();
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
