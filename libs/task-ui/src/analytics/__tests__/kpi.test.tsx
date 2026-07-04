import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { makeEmptyMetrics, makeMetrics } from '../fixtures.js';
import { MetricKpiCard } from '../metric-kpi-card.js';
import { MetricKpiGrid } from '../metric-kpi-grid.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

describe('MetricKpiCard', () => {
  it('renders label, value and caption', () => {
    renderWithTheme(
      <MetricKpiCard
        label="Accepted output rate"
        value="82%"
        caption="41/50"
      />,
    );
    expect(screen.getByText('Accepted output rate')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('41/50')).toBeInTheDocument();
  });

  it('marks an unknown value accessibly', () => {
    renderWithTheme(<MetricKpiCard label="Tokens / accepted" value="—" />);
    expect(
      screen.getByLabelText('Tokens / accepted: unknown'),
    ).toBeInTheDocument();
  });
});

describe('MetricKpiGrid', () => {
  it('renders all four pillars', () => {
    renderWithTheme(<MetricKpiGrid metrics={makeMetrics()} />);
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Productivity')).toBeInTheDocument();
    expect(screen.getByText('Hurdles')).toBeInTheDocument();
    expect(screen.getByText('ROI')).toBeInTheDocument();
  });

  it('renders the accepted-output rate with its counts', () => {
    renderWithTheme(<MetricKpiGrid metrics={makeMetrics()} />);
    expect(screen.getByText('Accepted output rate')).toBeInTheDocument();
    // 104/128 → 81.3%
    expect(screen.getByText('81.3%')).toBeInTheDocument();
    expect(screen.getByText('104/128')).toBeInTheDocument();
  });

  it('shows "—" for null ratios in an empty cohort, and 0% for real zero rates', () => {
    renderWithTheme(<MetricKpiGrid metrics={makeEmptyMetrics()} />);
    // Real zero rate renders as a percent, never as unknown.
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
    // Null ratios (tokens/accepted etc.) render as the unknown marker.
    expect(
      screen.getByLabelText('Tokens / accepted: unknown'),
    ).toBeInTheDocument();
  });
});
