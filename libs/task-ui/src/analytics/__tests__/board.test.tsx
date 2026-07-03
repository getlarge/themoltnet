import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsBoard } from '../analytics-board.js';
import { AnalyticsFilters } from '../analytics-filters.js';
import { makeMetrics, makeResponse } from '../fixtures.js';
import { MetricsTable } from '../metrics-table.js';
import type { TaskActivityAnalyticsGroup } from '../types.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

const noop = () => {};

describe('AnalyticsFilters', () => {
  it('emits an ISO completedAfter when a start date is picked', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <AnalyticsFilters filters={{}} onFiltersChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Completed after'), {
      target: { value: '2026-06-01' },
    });
    expect(onChange).toHaveBeenCalledWith({
      completedAfter: '2026-06-01T00:00:00.000Z',
    });
  });

  it('emits groupBy on select change', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <AnalyticsFilters filters={{}} onFiltersChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Compare by'), {
      target: { value: 'providerModel' },
    });
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'providerModel' });
  });

  it('renders a tags facet only when options are provided', () => {
    const { rerender } = renderWithTheme(
      <AnalyticsFilters filters={{}} onFiltersChange={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Tags' })).toBeNull();

    rerender(
      <MoltThemeProvider mode="light">
        <AnalyticsFilters
          filters={{}}
          onFiltersChange={noop}
          filterOptions={{ tags: [{ value: 'ui', label: 'ui' }] }}
        />
      </MoltThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Tags' })).toBeInTheDocument();
  });
});

describe('MetricsTable', () => {
  const groups: TaskActivityAnalyticsGroup[] = [
    { key: 'a', label: 'model-a', metrics: makeMetrics() },
    {
      key: 'b',
      label: 'model-b',
      metrics: makeMetrics({
        success: {
          ...makeMetrics().success,
          acceptedOutputRate: 0.5,
        },
      }),
    },
  ];

  it('renders an empty note with no groups', () => {
    renderWithTheme(<MetricsTable groups={[]} />);
    expect(screen.getByText(/compare by/i)).toBeInTheDocument();
  });

  it('renders a row per group and fires onRowClick', () => {
    const onRowClick = vi.fn();
    renderWithTheme(<MetricsTable groups={groups} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('model-a'));
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'a' }),
    );
  });
});

describe('AnalyticsBoard', () => {
  const baseProps = {
    filters: {},
    onFiltersChange: noop,
  };

  it('renders a skeleton in the loading state', () => {
    renderWithTheme(
      <AnalyticsBoard {...baseProps} status="loading" />,
    );
    expect(screen.getByTestId('analytics-skeleton')).toBeInTheDocument();
  });

  it('renders the error message and retry', () => {
    const onRetry = vi.fn();
    renderWithTheme(
      <AnalyticsBoard
        {...baseProps}
        status="error"
        error="boom"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders the empty state', () => {
    renderWithTheme(
      <AnalyticsBoard {...baseProps} status="empty" />,
    );
    expect(
      screen.getByText(/no task activity matches these filters/i),
    ).toBeInTheDocument();
  });

  it('renders the KPI grid when ready', () => {
    renderWithTheme(
      <AnalyticsBoard
        {...baseProps}
        status="ready"
        response={makeResponse()}
      />,
    );
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('ROI')).toBeInTheDocument();
  });

  it('shows the stats-catching-up banner when statsComplete is false', () => {
    renderWithTheme(
      <AnalyticsBoard
        {...baseProps}
        status="ready"
        response={makeResponse({ statsComplete: false })}
      />,
    );
    expect(screen.getByText(/stats are still catching up/i)).toBeInTheDocument();
  });

  it('renders the trend sparkline when grouped by day', () => {
    const response = makeResponse({
      groups: [
        { key: '2026-06-01', label: 'Jun 1', metrics: makeMetrics() },
        { key: '2026-06-02', label: 'Jun 2', metrics: makeMetrics() },
      ],
    });
    renderWithTheme(
      <AnalyticsBoard
        {...baseProps}
        filters={{ groupBy: 'day' }}
        status="ready"
        response={response}
      />,
    );
    expect(
      screen.getByRole('img', { name: /accepted-output rate over time/i }),
    ).toBeInTheDocument();
  });
});
