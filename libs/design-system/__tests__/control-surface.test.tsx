import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ControlSurface, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('ControlSurface', () => {
  it('supports semantic structural elements', () => {
    renderWithTheme(
      <ControlSurface as="section" aria-label="Runtime policy">
        Policy details
      </ControlSurface>,
    );

    expect(
      screen.getByRole('region', { name: 'Runtime policy' }),
    ).toHaveTextContent('Policy details');
  });

  it('uses identity tone for active identity surfaces', () => {
    renderWithTheme(
      <ControlSurface active tone="identity" data-testid="surface">
        Agent key
      </ControlSurface>,
    );

    expect(getComputedStyle(screen.getByTestId('surface')).borderColor).toBe(
      'rgb(230, 168, 23)',
    );
  });
});
