import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { RatioBar } from '../charts/ratio-bar.js';
import { Sparkline } from '../charts/sparkline.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

describe('RatioBar', () => {
  it('fills the track proportionally to the value', () => {
    renderWithTheme(<RatioBar value={0.42} label="Accepted" />);
    const fill = screen.getByTestId('ratio-bar-fill');
    expect(fill).toHaveStyle({ width: '42%' });
  });

  it('shows the percent for a known value', () => {
    renderWithTheme(<RatioBar value={0.42} label="Accepted" />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('renders the unknown marker and a hidden fill for null', () => {
    renderWithTheme(<RatioBar value={null} label="Accepted" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    const fill = screen.getByTestId('ratio-bar-fill');
    expect(fill).toHaveStyle({ opacity: '0' });
  });

  it('honours an explicit valueText (e.g. a count)', () => {
    renderWithTheme(<RatioBar value={0.5} label="Timeout" valueText="3" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders an accessible trend image', () => {
    renderWithTheme(
      <Sparkline
        title="Accepted rate"
        points={[
          { label: 'd1', value: 0.2 },
          { label: 'd2', value: 0.5 },
          { label: 'd3', value: 0.8 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Accepted rate' })).toBeInTheDocument();
  });

  it('breaks the line at null gaps into separate polylines', () => {
    const { container } = renderWithTheme(
      <Sparkline
        points={[
          { label: 'd1', value: 0.2 },
          { label: 'd2', value: 0.5 },
          { label: 'd3', value: null },
          { label: 'd4', value: 0.6 },
          { label: 'd5', value: 0.9 },
        ]}
      />,
    );
    // Two contiguous known segments → two polylines.
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('renders a fallback when there is no known data', () => {
    renderWithTheme(
      <Sparkline
        points={[
          { label: 'd1', value: null },
          { label: 'd2', value: null },
        ]}
      />,
    );
    expect(screen.getByText(/no trend data/i)).toBeInTheDocument();
  });

  it('draws a dot (not a line) for an isolated single known point', () => {
    const { container } = renderWithTheme(
      <Sparkline
        points={[
          { label: 'd1', value: null },
          { label: 'd2', value: 0.5 },
          { label: 'd3', value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });
});
