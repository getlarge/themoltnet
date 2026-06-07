import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input, MoltThemeProvider } from '../src/index.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider>{ui}</MoltThemeProvider>);
}

describe('Input', () => {
  it('links label and hint text to the input', () => {
    renderWithTheme(<Input label="Agent name" hint="Visible to teammates" />);

    const input = screen.getByLabelText('Agent name');
    const hint = screen.getByText('Visible to teammates');

    expect(input).toHaveAccessibleDescription('Visible to teammates');
    expect(input).toHaveAttribute('aria-describedby', hint.id);
  });

  it('marks invalid inputs and describes them with the error text', () => {
    renderWithTheme(<Input label="Invite code" error="Code is required" />);

    const input = screen.getByLabelText('Invite code');

    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('Code is required');
  });

  it('preserves consumer-provided descriptions', () => {
    renderWithTheme(
      <>
        <p id="external-help">External help</p>
        <Input
          label="Fingerprint"
          hint="Paste the public key fingerprint"
          aria-describedby="external-help"
        />
      </>,
    );

    const input = screen.getByLabelText('Fingerprint');

    expect(input).toHaveAccessibleDescription(
      'External help Paste the public key fingerprint',
    );
  });
});
