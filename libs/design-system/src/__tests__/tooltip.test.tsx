import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tooltip } from '../components/tooltip.js';
import { MoltThemeProvider } from '../theme-provider.js';

function renderTooltip(content: React.ReactNode, label: string) {
  return render(
    <MoltThemeProvider mode="light">
      <Tooltip content={content}>
        <button>{label}</button>
      </Tooltip>
    </MoltThemeProvider>,
  );
}

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    renderTooltip('hint', 'trigger');

    expect(screen.getByRole('button', { name: 'trigger' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reveals content on hover and hides on leave', () => {
    renderTooltip('detailed hint', 'trigger');
    const wrapper = screen.getByRole('button', { name: 'trigger' })
      .parentElement as HTMLElement;

    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole('tooltip')).toHaveTextContent('detailed hint');

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reveals content on focus and hides on blur', () => {
    renderTooltip('keyboard hint', 'trigger');
    const wrapper = screen.getByRole('button', { name: 'trigger' })
      .parentElement as HTMLElement;

    fireEvent.focus(wrapper);
    expect(screen.getByRole('tooltip')).toHaveTextContent('keyboard hint');

    fireEvent.blur(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
