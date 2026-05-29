import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { FreeformArtifactsCard } from '../freeform-artifacts-card.js';

function renderWithTheme(node: React.ReactNode) {
  render(<MoltThemeProvider mode="light">{node}</MoltThemeProvider>);
}

describe('FreeformArtifactsCard', () => {
  it('renders nothing when the output is null', () => {
    renderWithTheme(<FreeformArtifactsCard output={null} />);
    expect(screen.queryByText(/artifacts/i)).not.toBeInTheDocument();
  });

  it('renders nothing when output has no artifacts', () => {
    renderWithTheme(<FreeformArtifactsCard output={{ summary: 'done' }} />);
    expect(screen.queryByText(/artifacts/i)).not.toBeInTheDocument();
  });

  it('renders artifact title, kind, and inline body when present', () => {
    renderWithTheme(
      <FreeformArtifactsCard
        output={{
          summary: 'done',
          artifacts: [
            {
              kind: 'markdown',
              title: 'Field report',
              body: '# heading\n\nbody text',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Field report')).toBeInTheDocument();
    expect(screen.getByText('markdown')).toBeInTheDocument();
    expect(screen.getByText(/body text/)).toBeInTheDocument();
  });

  it('flags path as ephemeral when no body is present', () => {
    renderWithTheme(
      <FreeformArtifactsCard
        output={{
          summary: 'done',
          artifacts: [
            {
              kind: 'markdown',
              title: 'Large report',
              path: 'report.md',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Large report')).toBeInTheDocument();
    expect(screen.getByText(/report\.md/)).toBeInTheDocument();
    expect(screen.getByText(/ephemeral/i)).toBeInTheDocument();
  });

  it('shows a url link when present', () => {
    renderWithTheme(
      <FreeformArtifactsCard
        output={{
          summary: 'done',
          artifacts: [
            {
              kind: 'pr',
              title: 'PR #42',
              url: 'https://example.test/pulls/42',
            },
          ],
        }}
      />,
    );
    const link = screen.getByRole('link', { name: /https:\/\/example/ });
    expect(link).toHaveAttribute('href', 'https://example.test/pulls/42');
  });
});
