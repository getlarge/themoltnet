import { render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it } from 'vitest';

import { TaskExecutionRecord } from '../task-execution-record.js';
import { attemptFixture, taskFixture } from './fixtures.js';

describe('TaskExecutionRecord', () => {
  it('keeps the task contract, authority, result, and knowledge in one trace', () => {
    const task = {
      ...taskFixture,
      acceptedAttemptN: 1,
      diaryId: 'diary-1',
      status: 'completed',
    } as const;
    const attempt = {
      ...attemptFixture,
      attemptN: 1,
      contentSignature: 'signed',
      outputCid: 'bafy-output',
      policySnapshotHash: 'sha256:policy',
      runtimeProfileId: 'profile-1',
      runtimeProfileRevision: 4,
      status: 'completed',
    } as const;

    render(
      <MoltThemeProvider>
        <TaskExecutionRecord
          task={task}
          attempt={attempt}
          knowledge={{ count: 3 }}
        />
      </MoltThemeProvider>,
    );

    const trace = screen.getByRole('list', { name: 'Task execution record' });
    expect(within(trace).getAllByRole('listitem')).toHaveLength(5);
    expect(within(trace).getByText('sha256:policy')).toBeVisible();
    expect(within(trace).getByText('profile-1@4')).toBeVisible();
    expect(within(trace).getByText('Accepted')).toBeVisible();
    expect(within(trace).getByText('3 captured')).toBeVisible();
  });

  it('does not present missing claim or knowledge data as success', () => {
    render(
      <MoltThemeProvider>
        <TaskExecutionRecord
          task={{ ...taskFixture, diaryId: null, status: 'queued' }}
          knowledge={{ count: null, unavailable: true }}
        />
      </MoltThemeProvider>,
    );

    expect(screen.getByText('Awaiting claim')).toBeVisible();
    expect(screen.getAllByText('Not started')).toHaveLength(2);
    expect(screen.getByText('Unavailable')).toBeVisible();
  });

  it('distinguishes stopped attempts from successful results', () => {
    render(
      <MoltThemeProvider>
        <TaskExecutionRecord
          task={{ ...taskFixture, acceptedAttemptN: null }}
          attempt={{ ...attemptFixture, status: 'cancelled', outputCid: null }}
        />
      </MoltThemeProvider>,
    );

    expect(screen.getByText('Stopped')).toBeVisible();
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
  });
});
