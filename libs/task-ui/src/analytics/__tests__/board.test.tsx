import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('emits an end-of-day completedBefore when an end date is picked', () => {
    const onChange = vi.fn();
    renderWithTheme(
      <AnalyticsFilters filters={{}} onFiltersChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Completed before'), {
      target: { value: '2026-06-30' },
    });
    expect(onChange).toHaveBeenCalledWith({
      completedBefore: '2026-06-30T23:59:59.999Z',
    });
  });

  it('pre-populates the date inputs from existing ISO filters', () => {
    renderWithTheme(
      <AnalyticsFilters
        filters={{
          completedAfter: '2026-06-01T00:00:00.000Z',
          completedBefore: '2026-06-30T23:59:59.999Z',
        }}
        onFiltersChange={noop}
      />,
    );
    expect(screen.getByLabelText('Completed after')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('Completed before')).toHaveValue('2026-06-30');
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
  /** Build a group whose accepted-output rate is `rate` (0..1). */
  function groupWithRate(
    key: string,
    label: string,
    rate: number,
  ): TaskActivityAnalyticsGroup {
    const base = makeMetrics();
    return {
      key,
      label,
      metrics: makeMetrics({
        success: { ...base.success, acceptedOutputRate: rate },
      }),
    };
  }

  const groups: TaskActivityAnalyticsGroup[] = [
    groupWithRate('a', 'model-a', 0.6),
    groupWithRate('b', 'model-b', 0.9),
    groupWithRate('c', 'model-c', 0.3),
  ];

  /** The cohort labels in rendered row order. */
  function renderedOrder(): string[] {
    const rows = screen.getAllByRole('row').slice(1); // skip header
    return rows.map((row) => within(row).getAllByRole('cell')[0].textContent);
  }

  it('renders an empty note with no groups', () => {
    renderWithTheme(<MetricsTable groups={[]} />);
    expect(screen.getByText(/compare by/i)).toBeInTheDocument();
  });

  it('renders a row per group and fires onSelectGroup', () => {
    const onSelectGroup = vi.fn();
    renderWithTheme(
      <MetricsTable groups={groups} onSelectGroup={onSelectGroup} />,
    );
    fireEvent.click(screen.getByText('model-a'));
    expect(onSelectGroup).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'a' }),
    );
  });

  it('defaults to accepted-output rate, descending (best cohort first)', () => {
    renderWithTheme(<MetricsTable groups={groups} />);
    expect(renderedOrder()).toEqual(['model-b', 'model-a', 'model-c']);
  });

  it('toggles to ascending when the active column header is clicked', () => {
    renderWithTheme(<MetricsTable groups={groups} />);
    fireEvent.click(screen.getByRole('button', { name: /Accepted/i }));
    expect(renderedOrder()).toEqual(['model-c', 'model-a', 'model-b']);
  });

  it('sorts by a different column (descending) when its header is clicked', () => {
    renderWithTheme(<MetricsTable groups={groups} />);
    // Cohort column is a string sort; descending → reverse alphabetical.
    fireEvent.click(screen.getByRole('button', { name: /Cohort/i }));
    expect(renderedOrder()).toEqual(['model-c', 'model-b', 'model-a']);
  });

  it('sorts null ratios last under the default descending order', () => {
    const base = makeMetrics();
    const withNull: TaskActivityAnalyticsGroup = {
      key: 'n',
      label: 'model-null',
      metrics: makeMetrics({
        roi: { ...base.roi, acceptedTasksPerThousandTokens: null },
      }),
    };
    renderWithTheme(
      <MetricsTable groups={[...groups, withNull]} />,
    );
    // Sort by the ROI "Acc./1k tok" column; the null cohort ranks last.
    fireEvent.click(screen.getByRole('button', { name: /Acc\.\/1k tok/i }));
    expect(renderedOrder().at(-1)).toBe('model-null');
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
