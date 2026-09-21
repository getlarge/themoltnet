import { fireEvent, render, screen, within } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { parseReadableBlocks, readJsonList } from '../artifact-body.js';
import {
  projectBriefAttempt,
  projectBriefKnowledge,
  projectBriefOutput,
  projectBriefTask,
  taskDetailScenarios,
} from '../fixtures/task-detail.js';
import { FreeformArtifactList } from '../freeform-artifact-list.js';
import { TaskDetailHeader } from '../task-detail-header.js';
import { TaskDetailView } from '../task-detail-view.js';
import { readEntryAttempt, TaskKnowledgeList } from '../task-knowledge-list.js';
import { readFreeformOutput, readVerification } from '../task-output.js';
import {
  resolveTaskOutputRenderer,
  type TaskOutputRenderer,
} from '../task-output-renderers.js';
import { getTaskResultState, TaskResultPanel } from '../task-result-panel.js';
import { TaskVerificationSummary } from '../task-verification-summary.js';

function renderWithTheme(node: ReactNode) {
  return render(<MoltThemeProvider mode="dark">{node}</MoltThemeProvider>);
}

function resultSection() {
  return screen.getByRole('region', { name: 'Result' });
}

describe('TaskResultPanel — accepted freeform result', () => {
  it('leads with the accepted summary, artifacts, and a route to the attempt', () => {
    // Arrange
    const onOpenAttempt = vi.fn();

    // Act
    renderWithTheme(
      <TaskResultPanel
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
        onOpenAttempt={onOpenAttempt}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open full attempt' }));

    // Assert
    const section = resultSection();
    expect(within(section).getByText('Accepted')).toBeVisible();
    expect(within(section).getByText(projectBriefOutput.summary)).toBeVisible();
    expect(
      within(section).getByRole('heading', { name: 'Extracted requirements' }),
    ).toBeVisible();
    expect(within(section).getByText(/Attempt #1 · completed/)).toBeVisible();
    expect(onOpenAttempt).toHaveBeenCalledWith(1);
  });

  it('renders the requirements artifact as a readable ordered list', () => {
    renderWithTheme(
      <TaskResultPanel
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
      />,
    );

    const findings = within(resultSection())
      .getAllByRole('list')
      .find((list) => list.tagName === 'OL');
    expect(findings).toBeDefined();
    const items = within(findings!).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      'Preserve the mature trees and existing stone wall.',
    );
    expect(items[1]).toHaveTextContent(
      'Separate the quiet workspace from shared family areas.',
    );
    expect(items[2]).toHaveTextContent(
      'Resolve the conflict between west-facing glazing and summer heat.',
    );
  });

  it('keeps identifiers and raw output behind the evidence disclosure', () => {
    renderWithTheme(
      <TaskResultPanel
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
      />,
    );

    const evidence = screen.getByText('Evidence').closest('details');
    expect(evidence).not.toBeNull();
    expect(evidence).not.toHaveAttribute('open');
    expect(
      within(evidence!).getByText(projectBriefAttempt.outputCid!),
    ).not.toBeVisible();

    fireEvent.click(screen.getByText('Evidence'));

    expect(evidence).toHaveAttribute('open');
    expect(within(evidence!).getByText('Raw output')).toBeVisible();
  });

  it('shortens identifiers in presentation mode while keeping the full value copyable', () => {
    renderWithTheme(
      <TaskResultPanel
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
        compactIdentifiers
      />,
    );

    expect(screen.getByText('bafyreiz…srn5dr')).toHaveAttribute(
      'title',
      projectBriefAttempt.outputCid,
    );
    expect(
      screen.getByRole('button', { name: 'Copy output CID' }),
    ).toBeInTheDocument();
  });
});

describe('TaskResultPanel — states without an accepted result', () => {
  it('explains a queued task that no agent has claimed', () => {
    const { task, attempts } = taskDetailScenarios.queued;

    renderWithTheme(<TaskResultPanel task={task} attempts={attempts} />);

    expect(within(resultSection()).getByText('Queued')).toBeVisible();
    expect(screen.getByText(/no agent has claimed it/)).toBeVisible();
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
  });

  it('points a running task at its live attempt', () => {
    const { task, attempts } = taskDetailScenarios.running;
    const onOpenAttempt = vi.fn();

    renderWithTheme(
      <TaskResultPanel
        task={task}
        attempts={attempts}
        onOpenAttempt={onOpenAttempt}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Watch attempt #1' }));

    expect(screen.getByText(/has been running since/)).toBeVisible();
    expect(onOpenAttempt).toHaveBeenCalledWith(1);
  });

  it('shows the failure and whether the task will retry', () => {
    const { task, attempts } = taskDetailScenarios.failed;

    renderWithTheme(<TaskResultPanel task={task} attempts={attempts} />);

    expect(
      screen.getByText('Attempt #1 failed without an accepted result.'),
    ).toBeVisible();
    expect(screen.getByText('OUTPUT_SCHEMA_INVALID')).toBeVisible();
    expect(
      screen.getByText('The task is queued for another attempt (1 of 2 used).'),
    ).toBeVisible();
  });

  it('states a terminal failure when no attempts remain', () => {
    const { attempts } = taskDetailScenarios.failed;

    renderWithTheme(
      <TaskResultPanel
        task={{
          ...taskDetailScenarios.failed.task,
          status: 'failed',
          maxAttempts: 1,
        }}
        attempts={attempts}
      />,
    );

    expect(
      screen.getByText('No attempts remain: 1 of 1 used. The task failed.'),
    ).toBeVisible();
  });

  it('derives the result state from the accepted attempt first', () => {
    const running = {
      ...projectBriefAttempt,
      attemptN: 2,
      status: 'running' as const,
    };

    expect(
      getTaskResultState(projectBriefTask, [projectBriefAttempt, running]).kind,
    ).toBe('accepted');
    expect(
      getTaskResultState(
        { ...projectBriefTask, acceptedAttemptN: null, status: 'cancelled' },
        [],
      ).kind,
    ).toBe('closed');
  });
});

describe('Task output renderers', () => {
  it('falls back to a generic view for an unfamiliar output type', () => {
    const { task, attempts } = taskDetailScenarios['unknown-output'];

    renderWithTheme(<TaskResultPanel task={task} attempts={attempts} />);

    const section = resultSection();
    expect(within(section).getByText('site_survey_digest')).toBeVisible();
    expect(
      within(section).getByText(/Survey measurements were grouped by room/),
    ).toBeVisible();
    expect(within(section).getByText('discrepancies')).toBeVisible();
    expect(within(section).getByText('2 items')).toBeVisible();
    expect(within(section).getByText('rev-C')).toBeVisible();
  });

  it('lets a host register a renderer ahead of the defaults', () => {
    const custom: TaskOutputRenderer = {
      id: 'survey',
      matches: ({ task }) => task.taskType === 'site_survey_digest',
      summary: () => 'Custom lead',
      Body: () => <p>Custom body</p>,
    };
    const { task, attempts } = taskDetailScenarios['unknown-output'];

    renderWithTheme(
      <TaskResultPanel task={task} attempts={attempts} renderers={[custom]} />,
    );

    expect(screen.getByText('Custom lead')).toBeVisible();
    expect(screen.getByText('Custom body')).toBeVisible();
  });

  it('resolves freeform only when the output carries a summary', () => {
    const context = {
      task: projectBriefTask,
      attempt: projectBriefAttempt,
      compactIdentifiers: false,
    };

    expect(
      resolveTaskOutputRenderer({ ...context, output: projectBriefOutput }).id,
    ).toBe('freeform');
    expect(
      resolveTaskOutputRenderer({ ...context, output: { artifacts: [] } }).id,
    ).toBe('generic');
  });
});

describe('Structured artifacts', () => {
  it('renders JSON lists, code, stored and sparse artifacts', () => {
    renderWithTheme(
      <FreeformArtifactList
        artifacts={[
          {
            kind: 'requirements',
            title: 'JSON requirements',
            contentType: 'application/json',
            body: JSON.stringify({
              requirements: [
                { statement: 'Keep the wall', rationale: 'Named as fixed' },
                { statement: 'Quiet workspace' },
              ],
            }),
          },
          {
            kind: 'diff',
            title: 'Patch',
            body: '--- a\n+++ b',
          },
          {
            kind: 'drawing',
            title: 'Site plan',
            cid: 'bafyreid6mc7maao6t5lyv2qwdkcsjnonupj6smlj4l74j7j5z464scujnc',
          },
          { kind: 'note', title: 'Open questions' },
        ]}
      />,
    );

    expect(screen.getByText('Keep the wall')).toBeVisible();
    expect(screen.getByText('Named as fixed')).toBeVisible();
    expect(screen.getByText(/\+\+\+ b/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Copy artifact CID' }),
    ).toBeVisible();
    expect(
      screen.getByText('No content or location was attached to this artifact.'),
    ).toBeVisible();
  });

  it('collapses long artifact content behind an accessible toggle', () => {
    const scenario = taskDetailScenarios['long-content'];
    const output = readFreeformOutput(scenario.attempts[0].output);

    renderWithTheme(<FreeformArtifactList artifacts={output!.artifacts} />);
    const toggle = screen.getByRole('button', {
      name: 'Show the full artifact',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('parses markdown lists with continuation lines and JSON string lists', () => {
    const blocks = parseReadableBlocks(
      '# Heading\n\n1. First\n   detail\n2. Second\n\nClosing line.',
    );

    expect(blocks).toEqual([
      { type: 'heading', text: 'Heading' },
      {
        type: 'ordered',
        items: [
          { primary: 'First', secondary: 'detail' },
          { primary: 'Second' },
        ],
      },
      { type: 'paragraph', text: 'Closing line.' },
    ]);
    expect(readJsonList('["a","b"]')).toEqual([
      { primary: 'a' },
      { primary: 'b' },
    ]);
    expect(readJsonList('{"n": 1}')).toBeNull();
  });
});

describe('TaskVerificationSummary', () => {
  it('reports passed checks as the agent’s advisory self-check', () => {
    renderWithTheme(
      <TaskVerificationSummary
        verification={readVerification(projectBriefOutput)}
        criteriaDeclared
      />,
    );

    expect(screen.getByText('4 of 4 checks passed')).toBeVisible();
    expect(
      screen.getByText(/Advisory: it does not decide acceptance/),
    ).toBeVisible();
  });

  it('reports failures and skips', () => {
    renderWithTheme(
      <TaskVerificationSummary
        verification={{
          passed: false,
          results: [
            { id: 'a', kind: 'gate', status: 'pass' },
            { id: 'b', kind: 'assertion', status: 'fail' },
            { id: 'c', kind: 'rubric', status: 'skip' },
          ],
        }}
        criteriaDeclared
      />,
    );

    expect(screen.getByText('1 of 3 check failed')).toBeVisible();
  });

  it('says when the task declared no criteria', () => {
    renderWithTheme(
      <TaskVerificationSummary verification={null} criteriaDeclared={false} />,
    );

    expect(
      screen.getByText(
        'None: the task set no success criteria to check against.',
      ),
    ).toBeVisible();
  });
});

describe('Retained knowledge', () => {
  it('lists task-tagged entries apart from the result and marks cited ones', () => {
    renderWithTheme(
      <TaskDetailView
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
        knowledge={{
          entries: projectBriefKnowledge,
          total: projectBriefKnowledge.length,
          status: 'ready',
        }}
      />,
    );

    const knowledge = screen.getByRole('region', {
      name: 'Knowledge retained',
    });
    const result = resultSection();
    for (const entry of projectBriefKnowledge) {
      expect(within(knowledge).getByText(entry.title!)).toBeVisible();
      expect(within(result).queryByText(entry.title!)).not.toBeInTheDocument();
    }
    expect(within(knowledge).getAllByText('Cited in the result')).toHaveLength(
      1,
    );
  });

  it('covers empty, missing-diary, error, and partial states', () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithTheme(
      <TaskKnowledgeList
        entries={[]}
        total={0}
        status="ready"
        diaryConfigured
      />,
    );
    expect(
      screen.getByText(/No diary entries are tagged to this task/),
    ).toBeVisible();

    rerender(
      <MoltThemeProvider mode="dark">
        <TaskKnowledgeList
          entries={[]}
          total={null}
          status="ready"
          diaryConfigured={false}
        />
      </MoltThemeProvider>,
    );
    expect(screen.getByText(/has no diary/)).toBeVisible();

    rerender(
      <MoltThemeProvider mode="dark">
        <TaskKnowledgeList
          entries={[]}
          total={null}
          status="error"
          diaryConfigured
          onRetry={onRetry}
        />
      </MoltThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <MoltThemeProvider mode="dark">
        <TaskKnowledgeList
          entries={projectBriefKnowledge.slice(0, 1)}
          total={3}
          status="ready"
          diaryConfigured
        />
      </MoltThemeProvider>,
    );
    expect(
      screen.getByText('Showing 1 of 3. The rest are in the diary.'),
    ).toBeVisible();
  });
});

describe('TaskDetailView', () => {
  it('keeps the five-stage execution record and hides operator panels in presentation mode', () => {
    const view = (presentation: boolean) => (
      <MoltThemeProvider mode="dark">
        <TaskDetailView
          task={projectBriefTask}
          attempts={[projectBriefAttempt]}
          knowledge={{ entries: [], total: 0, status: 'ready' }}
          presentation={presentation}
        />
      </MoltThemeProvider>
    );
    const { rerender } = render(view(false));
    expect(screen.getByText('Agent actions')).toBeInTheDocument();

    rerender(view(true));

    expect(screen.queryByText('Agent actions')).not.toBeInTheDocument();
    const trace = screen.getByRole('list', { name: 'Task execution record' });
    expect(within(trace).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows what the task asked for in the header', () => {
    renderWithTheme(
      <TaskDetailView
        task={projectBriefTask}
        attempts={[projectBriefAttempt]}
        knowledge={{ entries: [], total: 0, status: 'ready' }}
      />,
    );

    expect(screen.getByText('Asked')).toBeVisible();
    expect(
      screen.getByText(projectBriefTask.input.brief as string),
    ).toBeVisible();
  });

  it('holds the result back while attempt evidence is unavailable', () => {
    const onRetryAttempts = vi.fn();
    renderWithTheme(
      <TaskDetailView
        task={projectBriefTask}
        attempts={[]}
        attemptsStatus="error"
        knowledge={{ entries: [], total: 0, status: 'ready' }}
        onRetryAttempts={onRetryAttempts}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry attempt evidence' }),
    );

    expect(screen.queryByRole('region', { name: 'Result' })).toBeNull();
    expect(onRetryAttempts).toHaveBeenCalledOnce();
  });
});

describe('Retained knowledge — attempt provenance tags', () => {
  it('reads the attempt from current and legacy provenance tags', () => {
    const entry = projectBriefKnowledge[0];

    expect(readEntryAttempt(entry)).toBe(1);
    expect(readEntryAttempt({ ...entry, tags: ['task_attempt:3'] })).toBe(3);
    expect(readEntryAttempt({ ...entry, tags: ['task:id:x'] })).toBeNull();
    expect(readEntryAttempt({ ...entry, tags: null })).toBeNull();
  });

  it('labels each entry with its attempt and lists the accepted attempt first', () => {
    const fromRetry = {
      ...projectBriefKnowledge[1],
      id: 'retry-entry',
      title: 'Written by the accepted retry',
      tags: ['task:attempt:2'],
    };
    const fromFailure = {
      ...projectBriefKnowledge[0],
      id: 'failed-entry',
      title: 'Written by the failed first attempt',
      tags: ['task:attempt:1'],
    };

    renderWithTheme(
      <TaskKnowledgeList
        entries={[fromFailure, fromRetry]}
        total={2}
        status="ready"
        diaryConfigured
        acceptedAttemptN={2}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Written by the accepted retry');
    expect(within(items[0]).getByText('Accepted attempt #2')).toBeVisible();
    expect(within(items[1]).getByText('Attempt #1')).toBeVisible();
    expect(
      within(items[1]).queryByText(/Accepted attempt/),
    ).not.toBeInTheDocument();
  });

  it('never presents a failed attempt’s entries as accepted knowledge', () => {
    const { task, attempts, knowledge } = taskDetailScenarios.failed;

    renderWithTheme(
      <TaskDetailView
        task={task}
        attempts={attempts}
        knowledge={{
          entries: knowledge,
          total: knowledge.length,
          status: 'ready',
        }}
      />,
    );

    const section = screen.getByRole('region', { name: 'Knowledge retained' });
    expect(within(section).getByText('Attempt #1')).toBeVisible();
    expect(within(section).queryByText(/Accepted attempt/)).toBeNull();
    expect(within(section).queryByText('Cited in the result')).toBeNull();
  });
});

describe('TaskDetailHeader — long briefs', () => {
  it('clamps a long brief behind an accessible toggle', () => {
    const { task } = taskDetailScenarios['long-content'];

    renderWithTheme(<TaskDetailHeader task={task} />);
    const toggle = screen.getByRole('button', { name: 'Show the full brief' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a short brief in full without a toggle', () => {
    renderWithTheme(<TaskDetailHeader task={projectBriefTask} />);

    expect(
      screen.queryByRole('button', { name: 'Show the full brief' }),
    ).toBeNull();
  });
});
