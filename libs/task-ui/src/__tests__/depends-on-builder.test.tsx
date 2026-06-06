import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { DependsOnBuilder } from '../depends-on-builder.js';
import type { TaskSummary } from '../types.js';

function base(): TaskSummary {
  return {
    id: 'x',
    teamId: 'team-1',
    diaryId: 'diary-1',
    taskType: 'freeform',
    status: 'queued',
    queuedAt: '2026-05-29T00:00:00Z',
    acceptedAttemptN: null,
  } as TaskSummary;
}

const CANDIDATES: TaskSummary[] = [
  {
    ...base(),
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    taskType: 'freeform',
    status: 'queued',
  },
  {
    ...base(),
    id: 'bbbbbbbb-2222-2222-2222-222222222222',
    taskType: 'fulfill_brief',
    status: 'running',
  },
];

function renderBuilder(
  props?: Partial<React.ComponentProps<typeof DependsOnBuilder>>,
) {
  const onChange = props?.onChange ?? vi.fn();
  render(
    <MoltThemeProvider mode="light">
      <DependsOnBuilder
        candidates={props?.candidates ?? CANDIDATES}
        availableTypes={props?.availableTypes ?? ['freeform', 'fulfill_brief']}
        onSearchCandidates={props?.onSearchCandidates}
        rows={props?.rows ?? []}
        onChange={onChange}
      />
    </MoltThemeProvider>,
  );
  return { onChange };
}

describe('DependsOnBuilder', () => {
  it('adds a prerequisite row from a candidate', () => {
    const { onChange } = renderBuilder();
    fireEvent.focus(screen.getByLabelText(/search prerequisite tasks/i));
    fireEvent.click(
      screen.getByRole('option', { name: /freeform · aaaaaaaa/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: 'aaaaaaaa-1111-1111-1111-111111111111',
        mode: 'status',
      }),
    ]);
  });

  it('renders candidate options for a row', () => {
    renderBuilder({
      rows: [
        {
          taskId: CANDIDATES[0].id,
          mode: 'status',
          statuses: ['completed'],
        },
      ],
    });
    fireEvent.focus(screen.getByLabelText(/search prerequisite tasks/i));
    expect(
      screen.getAllByText(/freeform · aaaaaaaa · queued/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('option', { name: /fulfill_brief · bbbbbbbb/i }),
    ).toBeInTheDocument();
  });

  it('filters candidate options by the type facet', () => {
    renderBuilder({
      rows: [
        {
          taskId: CANDIDATES[0].id,
          mode: 'status',
          statuses: ['completed'],
        },
      ],
    });
    fireEvent.focus(screen.getByLabelText(/search prerequisite tasks/i));
    fireEvent.click(screen.getByRole('button', { name: /^type$/i }));
    fireEvent.click(screen.getByRole('option', { name: /^Freeform$/i }));
    expect(
      screen.queryByRole('option', { name: /fulfill_brief · bbbbbbbb/i }),
    ).toBeNull();
    expect(
      screen.getByRole('option', { name: /freeform · aaaaaaaa/i }),
    ).toBeInTheDocument();
  });

  it('adds a row from a pasted task id', () => {
    const { onChange } = renderBuilder({ candidates: [] });
    const input = screen.getByLabelText(/search prerequisite tasks/i);
    fireEvent.change(input, {
      target: { value: 'cccccccc-3333-3333-3333-333333333333' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /add pasted task id/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: 'cccccccc-3333-3333-3333-333333333333',
        mode: 'status',
      }),
    ]);
  });

  it('selects the active candidate with the keyboard', () => {
    const { onChange } = renderBuilder();
    const input = screen.getByLabelText(/search prerequisite tasks/i);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: 'bbbbbbbb-2222-2222-2222-222222222222',
        mode: 'status',
      }),
    ]);
  });

  it('uses debounced server search when provided', async () => {
    const remote: TaskSummary = {
      ...base(),
      id: 'dddddddd-4444-4444-4444-444444444444',
      title: 'Remote task title',
      taskType: 'assess_brief',
      status: 'completed',
    };
    const onSearchCandidates = vi.fn().mockResolvedValue([remote]);
    const { onChange } = renderBuilder({
      candidates: [],
      availableTypes: ['assess_brief'],
      onSearchCandidates,
    });

    fireEvent.change(screen.getByLabelText(/search prerequisite tasks/i), {
      target: { value: 'remote title' },
    });

    await waitFor(() =>
      expect(onSearchCandidates).toHaveBeenCalledWith('remote title'),
    );
    fireEvent.click(
      await screen.findByRole('option', { name: /assess_brief · dddddddd/i }),
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: 'dddddddd-4444-4444-4444-444444444444',
        mode: 'status',
      }),
    ]);
  });
});
