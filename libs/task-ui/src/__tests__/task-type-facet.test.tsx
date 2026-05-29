import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { TaskTypeFacet } from '../task-type-facet.js';

function renderFacet(
  props?: Partial<React.ComponentProps<typeof TaskTypeFacet>>,
) {
  const onChange = props?.onChange ?? vi.fn();
  render(
    <MoltThemeProvider mode="light">
      <TaskTypeFacet
        availableTypes={['fulfill_brief', 'freeform', 'assess_brief']}
        selected={props?.selected ?? []}
        onChange={onChange}
      />
    </MoltThemeProvider>,
  );
  return { onChange };
}

describe('TaskTypeFacet', () => {
  it('shows the facet trigger labelled "Type"', () => {
    renderFacet();
    expect(screen.getByRole('button', { name: /type/i })).toBeInTheDocument();
  });

  it('opens the panel and lists humanized type options', () => {
    renderFacet();
    fireEvent.click(screen.getByRole('button', { name: /type/i }));
    expect(
      screen.getByRole('option', { name: /Fulfill Brief/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Freeform/i }),
    ).toBeInTheDocument();
  });

  it('toggles a type on click, calling onChange with the next array', () => {
    const { onChange } = renderFacet({ selected: [] });
    fireEvent.click(screen.getByRole('button', { name: /type/i }));
    fireEvent.click(screen.getByRole('option', { name: /Freeform/i }));
    expect(onChange).toHaveBeenCalledWith(['freeform']);
  });

  it('deselects an already-selected type', () => {
    const { onChange } = renderFacet({ selected: ['freeform'] });
    fireEvent.click(screen.getByRole('button', { name: /type/i }));
    fireEvent.click(screen.getByRole('option', { name: /Freeform/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows a count badge of selected types on the trigger', () => {
    renderFacet({ selected: ['freeform', 'fulfill_brief'] });
    expect(screen.getByRole('button', { name: /type/i })).toHaveTextContent(
      '2',
    );
  });
});
