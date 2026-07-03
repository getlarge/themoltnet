import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { makeEmptyMetrics, makeMetrics } from '../fixtures.js';
import { HurdlesPanel } from '../hurdles-panel.js';
import { KnowledgeUsagePanel } from '../knowledge-usage-panel.js';

function renderWithTheme(ui: React.ReactElement) {
  return render(<MoltThemeProvider mode="light">{ui}</MoltThemeProvider>);
}

describe('HurdlesPanel', () => {
  it('renders the failed tool-call rate with counts', () => {
    const m = makeMetrics();
    renderWithTheme(
      <HurdlesPanel hurdles={m.hurdles} toolCallCount={m.raw.toolCallCount} />,
    );
    // 37 / 512 ≈ 7.2%
    expect(screen.getByText(/7\.2% \(37\/512\)/)).toBeInTheDocument();
  });

  it('renders each attempt outcome with its count', () => {
    const m = makeMetrics();
    renderWithTheme(
      <HurdlesPanel hurdles={m.hurdles} toolCallCount={m.raw.toolCallCount} />,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Timed out')).toBeInTheDocument();
    expect(screen.getByText('Aborted')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows an empty note when there are no adverse outcomes', () => {
    const m = makeEmptyMetrics();
    renderWithTheme(
      <HurdlesPanel hurdles={m.hurdles} toolCallCount={m.raw.toolCallCount} />,
    );
    expect(
      screen.getByText(/no failed, timed-out, aborted or cancelled/i),
    ).toBeInTheDocument();
  });
});

describe('KnowledgeUsagePanel', () => {
  it('renders the per-accepted-task leverage and counters', () => {
    renderWithTheme(<KnowledgeUsagePanel knowledge={makeMetrics().knowledge} />);
    expect(
      screen.getByText('Knowledge calls per accepted task'),
    ).toBeInTheDocument();
    // 210 / 104 ≈ 2.02
    expect(screen.getByText('2.02')).toBeInTheDocument();
    expect(screen.getByText('Diary searches')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
  });

  it('renders "—" for leverage when there are no accepted tasks', () => {
    renderWithTheme(
      <KnowledgeUsagePanel knowledge={makeEmptyMetrics().knowledge} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
