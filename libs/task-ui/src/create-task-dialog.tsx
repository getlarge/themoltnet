import {
  Button,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { buildClaimCondition, type DependsRow } from './claim-condition.js';
import { DependsOnBuilder } from './depends-on-builder.js';
import {
  type AssertionRow,
  buildSuccessCriteria,
  type BuiltSuccessCriteria,
  EMPTY_SIDE_EFFECTS,
  type SideEffectsForm,
} from './success-criteria.js';
import { SuccessCriteriaEditor } from './success-criteria-editor.js';
import type { ClaimCondition, TaskSummary } from './types.js';

export interface DiaryOption {
  id: string;
  name: string;
}

/**
 * Workspace mode the proposer wants the daemon to mount for this freeform
 * task. Mirrors the `input.execution.workspace` surface declared on
 * `FreeformInput` in `@moltnet/tasks` — recognized values are `'none'`
 * (scratch mount, no repo), `'shared_mount'` (host workspace, read-only
 * exploration), and `'dedicated_worktree'` (isolated worktree branched off
 * main, safe for file mutation). Absent means "use the registry default",
 * which is `shared_mount` for freeform.
 */
export type FreeformWorkspaceMode =
  | 'none'
  | 'shared_mount'
  | 'dedicated_worktree';

/**
 * The create-task request assembled by the dialog. Presentation-only: the
 * consumer (app) turns this into the actual API call. Kept independent of
 * `@moltnet/api-client` so `task-ui` stays free of API/runtime dependencies.
 */
export interface CreateTaskRequest {
  teamId: string;
  diaryId: string;
  taskType: 'freeform';
  title?: string;
  tags?: string[];
  correlationId?: string;
  input: {
    brief: string;
    expectedOutput?: string;
    successCriteria?: BuiltSuccessCriteria;
    execution?: { workspace: FreeformWorkspaceMode };
    continueFrom?: { taskId: string; attemptN: number };
  };
  claimCondition?: ClaimCondition;
}

/**
 * Identifies the source attempt for a warm-resume continuation. When set,
 * the dialog drops the workspace + depends-on fields (workspace is inherited
 * from the parent slot; the parent-completed claim condition is auto-injected
 * and would conflict with caller-supplied gates), pre-populates the title,
 * and packs `input.continueFrom` + the `task_status:completed` claim condition
 * on submit. Matches the wire contract enforced by the MCP `tasks_continue`
 * tool and the Go CLI `task continue` subcommand (#1287, #1307, #1308).
 */
export interface ContinueFromSource {
  taskId: string;
  attemptN: number;
  sourceTitle?: string;
  /**
   * Optional source-task properties to inherit on the continuation. The
   * server inherits these automatically from the source on the equivalent
   * MCP/CLI surfaces, but the dialog still needs to pass them through so
   * the constructed CreateTaskRequest matches what the consumer's onSubmit
   * forwards to POST /tasks.
   */
  correlationId?: string | null;
}

export interface CreateTaskDialogProps {
  open: boolean;
  teamId: string;
  diaries: DiaryOption[];
  candidateTasks: TaskSummary[];
  /** Registered task-type names, forwarded to the depends-on type filter. */
  availableTypes: string[];
  onClose: () => void;
  /**
   * Perform the create. Resolves with the new task id on success; rejects (or
   * throws) with an Error whose message is shown inline on failure. The app
   * owns the actual API call — this component never fetches.
   */
  onSubmit: (request: CreateTaskRequest) => Promise<string>;
  /** Called with the new task id after a successful create. */
  onCreated: (taskId: string) => void;
  /**
   * When set, the dialog enters "continuation" mode: workspace and depends-on
   * fields are dropped, the source title is pre-filled, and the submit payload
   * includes `input.continueFrom` plus a `task_status:completed` claim
   * condition on the parent.
   */
  continueFrom?: ContinueFromSource;
}

export function CreateTaskDialog({
  open,
  teamId,
  diaries,
  candidateTasks,
  availableTypes,
  onClose,
  onSubmit,
  onCreated,
  continueFrom,
}: CreateTaskDialogProps) {
  const theme = useTheme();
  const isContinuation = continueFrom !== undefined;
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState(continueFrom?.sourceTitle ?? '');
  const [tags, setTags] = useState('');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [diaryId, setDiaryId] = useState(diaries[0]?.id ?? '');
  // Empty string = "use registry default". Any other value gets sent through
  // input.execution.workspace; the daemon resolves it via the same data-driven
  // path as run_eval.
  const [workspaceMode, setWorkspaceMode] = useState<
    '' | FreeformWorkspaceMode
  >('');
  const [dependsRows, setDependsRows] = useState<DependsRow[]>([]);
  const [assertions, setAssertions] = useState<AssertionRow[]>([]);
  const [sideEffects, setSideEffects] =
    useState<SideEffectsForm>(EMPTY_SIDE_EFFECTS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Diaries may arrive after first render (they load async), and the initial
  // useState only captures the first render's value. Default the selection to
  // the first diary once one is available and nothing valid is selected yet.
  useEffect(() => {
    if (diaries.length === 0) return;
    if (!diaries.some((diary) => diary.id === diaryId)) {
      setDiaryId(diaries[0].id);
    }
  }, [diaries, diaryId]);

  // The dialog instance may be reused across continuations (different
  // source attempts). useState only captures the initial sourceTitle; reset
  // when the source changes so the prefilled title tracks the new parent.
  useEffect(() => {
    setTitle(continueFrom?.sourceTitle ?? '');
  }, [continueFrom?.taskId, continueFrom?.attemptN, continueFrom?.sourceTitle]);

  const canSubmit = Boolean(brief.trim() && diaryId);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const successCriteria = buildSuccessCriteria(assertions, sideEffects);
      const normalizedTags = normalizeTagsInput(tags);
      // Continuations: drop workspace (server rejects on input.continueFrom)
      // and depends-on (the auto-injected task_status:completed gate on the
      // parent is the only claim condition that makes sense here; allowing
      // both would conflict).
      const claimCondition: ClaimCondition | undefined = isContinuation
        ? {
            op: 'task_status',
            taskId: continueFrom.taskId,
            statuses: ['completed'],
          }
        : buildClaimCondition(dependsRows);
      const taskId = await onSubmit({
        teamId,
        diaryId,
        taskType: 'freeform',
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(normalizedTags.length > 0 ? { tags: normalizedTags } : {}),
        ...(isContinuation && continueFrom.correlationId
          ? { correlationId: continueFrom.correlationId }
          : {}),
        input: {
          brief: brief.trim(),
          ...(expectedOutput.trim()
            ? { expectedOutput: expectedOutput.trim() }
            : {}),
          ...(successCriteria ? { successCriteria } : {}),
          ...(!isContinuation && workspaceMode
            ? { execution: { workspace: workspaceMode } }
            : {}),
          ...(isContinuation
            ? {
                continueFrom: {
                  taskId: continueFrom.taskId,
                  attemptN: continueFrom.attemptN,
                },
              }
            : {}),
        },
        ...(claimCondition ? { claimCondition } : {}),
      });
      setBrief('');
      setTitle('');
      setTags('');
      setExpectedOutput('');
      setWorkspaceMode('');
      setDependsRows([]);
      setAssertions([]);
      setSideEffects(EMPTY_SIDE_EFFECTS);
      onCreated(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing[3]} ${theme.spacing[4]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontFamily: theme.font.family.sans,
    fontSize: theme.font.size.sm,
    minHeight: 80,
    resize: 'vertical',
  };
  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
    borderRadius: theme.radius.md,
    border: `1px solid ${theme.color.border.DEFAULT}`,
    background: theme.color.bg.surface,
    color: theme.color.text.DEFAULT,
    fontSize: theme.font.size.sm,
  };
  const labelCaption = (text: string, required = false): React.ReactNode => (
    <Text variant="caption" color="muted">
      {text}
      {required ? (
        <span style={{ color: theme.color.accent.DEFAULT }}> *</span>
      ) : null}
    </Text>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isContinuation ? 'Continue task' : 'New task'}
      width="520px"
    >
      <Stack gap={4}>
        {isContinuation ? (
          <Text variant="caption" color="muted">
            Continuing attempt {continueFrom.attemptN} of task{' '}
            {continueFrom.sourceTitle ?? continueFrom.taskId}. The new task will
            inherit workspace mode and executor pinning from the parent slot.
          </Text>
        ) : null}
        <Stack gap={1}>
          {labelCaption('Brief', true)}
          <textarea
            aria-label="Brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder={
              isContinuation
                ? 'What should the continuation do next?'
                : 'Describe the work to be done…'
            }
            style={textareaStyle}
          />
        </Stack>

        <Input
          label="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Short label"
        />

        <Input
          label="Tags (optional)"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="Comma-separated labels"
        />

        <Stack gap={1}>
          {labelCaption('Expected output (optional)')}
          <textarea
            aria-label="Expected output"
            value={expectedOutput}
            onChange={(event) => setExpectedOutput(event.target.value)}
            placeholder="What should the result look like?"
            style={textareaStyle}
          />
        </Stack>

        {isContinuation ? null : (
          <Stack gap={1}>
            {labelCaption('Workspace mode (optional)')}
            <select
              aria-label="Workspace mode"
              value={workspaceMode}
              onChange={(event) =>
                setWorkspaceMode(
                  event.target.value as '' | FreeformWorkspaceMode,
                )
              }
              style={selectStyle}
            >
              <option value="">Default (shared mount)</option>
              <option value="shared_mount">
                shared_mount — read-only exploration
              </option>
              <option value="dedicated_worktree">
                dedicated_worktree — isolated branch, safe to mutate
              </option>
              <option value="none">none — scratch mount, no repo access</option>
            </select>
          </Stack>
        )}

        <Stack gap={1}>
          {labelCaption('Diary', true)}
          <select
            aria-label="Diary"
            value={diaryId}
            onChange={(event) => setDiaryId(event.target.value)}
            style={selectStyle}
          >
            {diaries.length === 0 ? (
              <option value="">No diaries in this team</option>
            ) : (
              diaries.map((diary) => (
                <option key={diary.id} value={diary.id}>
                  {diary.name}
                </option>
              ))
            )}
          </select>
        </Stack>

        {isContinuation ? null : (
          <DependsOnBuilder
            candidates={candidateTasks}
            availableTypes={availableTypes}
            rows={dependsRows}
            onChange={setDependsRows}
          />
        )}

        <Stack gap={2}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((open) => !open)}
            style={{ alignSelf: 'flex-start' }}
          >
            {showAdvanced ? '▾ Success criteria' : '▸ Success criteria'}
          </Button>
          {showAdvanced ? (
            <SuccessCriteriaEditor
              assertions={assertions}
              onAssertionsChange={setAssertions}
              sideEffects={sideEffects}
              onSideEffectsChange={setSideEffects}
            />
          ) : null}
        </Stack>

        {error ? (
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {error}
          </Text>
        ) : null}

        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting
              ? isContinuation
                ? 'Continuing…'
                : 'Creating…'
              : isContinuation
                ? 'Continue task'
                : 'Create task'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function normalizeTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(',')) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}
