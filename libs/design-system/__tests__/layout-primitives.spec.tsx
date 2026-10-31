import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Disclosure,
  MoltThemeProvider,
  Stack,
  VisuallyHidden,
} from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('Disclosure', () => {
  it('starts closed and opens from its summary', () => {
    renderWithTheme(
      <Disclosure summary="Evidence" hint="Output CID and signature">
        <p>Hidden detail</p>
      </Disclosure>,
    );
    const details = screen.getByText('Evidence').closest('details');

    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('Output CID and signature')).toBeVisible();

    fireEvent.click(screen.getByText('Evidence'));

    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Hidden detail')).toBeVisible();
  });
});

describe('VisuallyHidden', () => {
  it('keeps text in the accessibility tree and forwards attributes', () => {
    renderWithTheme(
      <a href="https://example.test">
        Report<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
      </a>,
    );

    expect(
      screen.getByRole('link', { name: 'Report (opens in a new tab)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('(opens in a new tab)')).toHaveStyle({
      position: 'absolute',
      overflow: 'hidden',
    });
  });
});

describe('Stack', () => {
  it('lets a stack shrink inside flex rows only when asked', () => {
    renderWithTheme(
      <>
        <Stack data-testid="default" />
        <Stack data-testid="shrink" shrink />
      </>,
    );

    expect(screen.getByTestId('shrink')).toHaveStyle({ minWidth: '0' });
    expect(screen.getByTestId('default').style.minWidth).toBe('');
  });
});
