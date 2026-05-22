import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FilterBar } from '../components/FilterBar.js';
import { EMPTY_FILTER_STATE } from '../types.js';

const TAGS = [
  { tag: 'auth', count: 3 },
  { tag: 'db', count: 2 },
];

function renderWithTheme(element: ReactElement) {
  return render(<MoltThemeProvider>{element}</MoltThemeProvider>);
}

describe('FilterBar', () => {
  it('reports query changes', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <FilterBar
        state={EMPTY_FILTER_STATE}
        tags={TAGS}
        resultCount={10}
        onChange={onChange}
        onExplore={() => {}}
      />,
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: /search entries/i }),
      { target: { value: 'auth' } },
    );
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER_STATE, q: 'auth' });
  });

  it('announces result count via aria-live', () => {
    renderWithTheme(
      <FilterBar
        state={EMPTY_FILTER_STATE}
        tags={TAGS}
        resultCount={42}
        onChange={() => {}}
        onExplore={() => {}}
      />,
    );
    const live = screen.getByText(/42 results?/i);
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('triggers onExplore from the Explore link', () => {
    const onExplore = vi.fn();
    renderWithTheme(
      <FilterBar
        state={EMPTY_FILTER_STATE}
        tags={TAGS}
        resultCount={0}
        onChange={() => {}}
        onExplore={onExplore}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /explore tags/i }));
    expect(onExplore).toHaveBeenCalledOnce();
  });

  it('focuses search when "/" is pressed', () => {
    renderWithTheme(
      <FilterBar
        state={EMPTY_FILTER_STATE}
        tags={TAGS}
        resultCount={0}
        onChange={() => {}}
        onExplore={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: '/' });
    expect(
      screen.getByRole('searchbox', { name: /search entries/i }),
    ).toHaveFocus();
  });
});
