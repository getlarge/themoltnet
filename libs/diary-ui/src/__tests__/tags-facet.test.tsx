import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TagsFacet } from '../components/TagsFacet.js';

const TAGS = [
  { tag: 'auth', count: 5 },
  { tag: 'database', count: 3 },
  { tag: 'ui', count: 2 },
];

function renderWithTheme(element: ReactElement) {
  return render(<MoltThemeProvider>{element}</MoltThemeProvider>);
}

describe('TagsFacet', () => {
  it('renders trigger with active count badge', () => {
    renderWithTheme(
      <TagsFacet
        tags={TAGS}
        selected={['auth']}
        excluded={['database']}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /tags filter/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('toggles include on click and exclude via toggle button', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <TagsFacet
        tags={TAGS}
        selected={[]}
        excluded={[]}
        onChange={onChange}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /tags filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /include tag: auth/i }));
    expect(onChange).toHaveBeenCalledWith({
      selected: ['auth'],
      excluded: [],
    });

    fireEvent.click(
      screen.getByRole('button', { name: /exclude tag: database/i }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      selected: [],
      excluded: ['database'],
    });
  });

  it('filters by typeahead', () => {
    renderWithTheme(
      <TagsFacet
        tags={TAGS}
        selected={[]}
        excluded={[]}
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /tags filter/i }));
    const input = screen.getByRole('searchbox', { name: /filter tags/i });
    fireEvent.change(input, { target: { value: 'data' } });
    expect(
      screen.getByRole('button', { name: /include tag: database/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /include tag: auth/i }),
    ).not.toBeInTheDocument();
  });

  it('calls onClear from footer', () => {
    const onClear = vi.fn();
    renderWithTheme(
      <TagsFacet
        tags={TAGS}
        selected={['auth']}
        excluded={[]}
        onChange={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /tags filter/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear tags/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
