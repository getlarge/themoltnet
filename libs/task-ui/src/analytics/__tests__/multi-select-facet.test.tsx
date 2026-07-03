import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { MultiSelectFacet } from '../multi-select-facet.js';

function renderFacet(
  props?: Partial<React.ComponentProps<typeof MultiSelectFacet>>,
) {
  const onChange = props?.onChange ?? vi.fn();
  render(
    <MoltThemeProvider mode="light">
      <MultiSelectFacet
        label="Tags"
        options={[
          { value: 'ui', label: 'ui' },
          { value: 'backend', label: 'backend' },
        ]}
        selected={props?.selected ?? []}
        onChange={onChange}
      />
    </MoltThemeProvider>,
  );
  return { onChange };
}

describe('MultiSelectFacet', () => {
  it('opens the listbox and lists options', () => {
    renderFacet();
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    expect(screen.getByRole('option', { name: 'ui' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'backend' })).toBeInTheDocument();
  });

  it('adds an option on click', () => {
    const { onChange } = renderFacet({ selected: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('option', { name: 'backend' }));
    expect(onChange).toHaveBeenCalledWith(['backend']);
  });

  it('removes an already-selected option on click', () => {
    const { onChange } = renderFacet({ selected: ['ui'] });
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(screen.getByRole('option', { name: 'ui' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows a selected-count badge on the trigger', () => {
    renderFacet({ selected: ['ui', 'backend'] });
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('2');
  });

  it('closes the listbox on an outside click', () => {
    renderFacet();
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
