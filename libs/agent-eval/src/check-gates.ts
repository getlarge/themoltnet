/**
 * Stage-1 deterministic gate evaluator. Reads an attempt's message stream and
 * accepted output and asserts the `GateExpectations` — with NO LLM involved.
 *
 * This is the load-bearing anti-"inception" layer: because gates are code, they
 * cannot co-regress with the runtime prompt under test. An attempt that fails
 * any gate is scored composite 0 and never reaches the LLM judge.
 *
 * The evaluator depends only on the narrow `GateAgent` interface below, not the
 * full `@themoltnet/sdk` `Agent`, so it is unit-testable with a fake and the
 * lib carries no runtime SDK dependency. The real `Agent` structurally
 * satisfies `GateAgent`.
 */
import { RunEvalOutput, validateRunEvalOutput } from '@moltnet/tasks';
import { Value } from 'typebox/value';

import type { GateExpectations } from './scenario.js';

/** Minimal shape of a task message (a structural subset of the SDK's
 * `TaskMessage`). */
export interface GateTaskMessage {
  kind: string;
  payload: { [key: string]: unknown };
}

/** Minimal shape of a task attempt (a structural subset of `TaskAttempt`). */
export interface GateTaskAttempt {
  attemptN: number;
  status: string;
  output: { [key: string]: unknown } | null;
}

/** Minimal shape of a task artifact (a structural subset of `TaskArtifact`). */
export interface GateTaskArtifact {
  cid: string;
  attemptN: number | null;
  title: string;
}

/** Minimal shape of an artifact download (a structural subset of
 * `TaskArtifactDownload`). */
export interface GateArtifactDownload {
  stream: AsyncIterable<Uint8Array>;
}

/**
 * The narrow slice of the SDK `Agent` that `checkGates` needs. The real
 * `agent.tasks` satisfies this structurally. The `artifacts` slice is only
 * exercised when a scenario sets `forbidArtifactContentMatching`.
 */
export interface GateAgent {
  tasks: {
    listMessages(taskId: string, attemptN: number): Promise<GateTaskMessage[]>;
    listAttempts(taskId: string): Promise<GateTaskAttempt[]>;
    artifacts: {
      list(
        taskId: string,
        options: { teamId: string },
        query?: unknown,
      ): Promise<GateTaskArtifact[]>;
      download(
        path: { taskId: string; cid: string },
        options: { teamId: string },
      ): Promise<GateArtifactDownload>;
    };
  };
}

/** One failed gate expectation. */
export interface GateFailure {
  /** Stable identifier for the gate that failed. */
  gate: string;
  /** Human-readable reason. */
  detail: string;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

interface ExecuteStartPayload {
  event: 'execute_start';
  model: string;
  provider: string;
  workspaceMode: string;
}

function infoEvent(
  messages: GateTaskMessage[],
  event: string,
): { [key: string]: unknown } | undefined {
  return messages.find((m) => m.kind === 'info' && m.payload.event === event)
    ?.payload;
}

function toolNames(messages: GateTaskMessage[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.kind === 'tool_call_start') {
      const name = m.payload.tool_name;
      if (typeof name === 'string') {
        names.add(name);
      }
    }
  }
  return names;
}

/** Decode an artifact byte stream to text, capped so a hostile large upload
 * cannot exhaust memory during a content scan. */
async function readStreamText(
  stream: AsyncIterable<Uint8Array>,
  capBytes = 1_000_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    total += chunk.length;
    if (total >= capBytes) break;
  }
  text += decoder.decode();
  return text;
}

/**
 * Evaluate the deterministic gates for one attempt.
 *
 * @param agent - Narrow agent slice (see `GateAgent`).
 * @param taskId - The producer `run_eval` task id.
 * @param attemptN - The accepted attempt number.
 * @param gates - Scenario gate expectations.
 * @param expected - Expected runtime facts to cross-check against
 *   `execute_start` (the model the profile pinned, and the eval's declared
 *   workspace mode).
 */
export async function checkGates(
  agent: GateAgent,
  taskId: string,
  attemptN: number,
  gates: GateExpectations,
  expected: { model: string; workspace: string; teamId?: string },
): Promise<GateResult> {
  const failures: GateFailure[] = [];
  const messages = await agent.tasks.listMessages(taskId, attemptN);

  // Gate: a prompt_build_failure short-circuits everything else.
  const buildError = messages.find(
    (m) => m.kind === 'error' && m.payload.phase === 'prompt_build',
  );
  if (buildError) {
    const reason =
      typeof buildError.payload.message === 'string'
        ? buildError.payload.message
        : 'unknown';
    failures.push({
      gate: 'prompt_build',
      detail: `prompt build failed: ${reason}`,
    });
  }

  // Gate: execute_start present with the expected model + workspace mode.
  const start = infoEvent(messages, 'execute_start') as
    | ExecuteStartPayload
    | undefined;
  if (!start) {
    failures.push({
      gate: 'execute_start',
      detail: 'no execute_start event in attempt message stream',
    });
  } else {
    if (start.model !== expected.model) {
      failures.push({
        gate: 'model',
        detail: `execute_start.model=${start.model}, expected ${expected.model}`,
      });
    }
    const wantWorkspace = gates.expectWorkspaceMode ?? expected.workspace;
    if (start.workspaceMode !== wantWorkspace) {
      failures.push({
        gate: 'workspace_mode',
        detail: `execute_start.workspaceMode=${start.workspaceMode}, expected ${wantWorkspace}`,
      });
    }
  }

  // Gate: prompt_assembled present with all required sections.
  const assembled = infoEvent(messages, 'prompt_assembled');
  if (!assembled) {
    failures.push({
      gate: 'prompt_assembled',
      detail: 'no prompt_assembled event in attempt message stream',
    });
  } else if (gates.requirePromptSections?.length) {
    const sections = Array.isArray(assembled.sections)
      ? (assembled.sections as Array<{ id?: unknown }>)
      : [];
    const present = new Set(
      sections
        .map((s) => (typeof s.id === 'string' ? s.id : undefined))
        .filter((id): id is string => id !== undefined),
    );
    for (const required of gates.requirePromptSections) {
      if (!present.has(required)) {
        failures.push({
          gate: 'prompt_section',
          detail: `required prompt section "${required}" not present`,
        });
      }
    }
  }

  // Gate: required / forbidden tool calls.
  if (gates.requireToolCalls?.length || gates.forbidToolCalls?.length) {
    const called = toolNames(messages);
    for (const tool of gates.requireToolCalls ?? []) {
      if (!called.has(tool)) {
        failures.push({
          gate: 'tool_required',
          detail: `required tool "${tool}" was not called`,
        });
      }
    }
    for (const tool of gates.forbidToolCalls ?? []) {
      if (called.has(tool)) {
        failures.push({
          gate: 'tool_forbidden',
          detail: `forbidden tool "${tool}" was called`,
        });
      }
    }
  }

  // Gate: a clean submit — the accepted attempt exists and its output is a
  // schema-valid RunEvalOutput. A missing output or a schema failure means the
  // submit tool never captured a valid payload (parse_result != captured_via_tool).
  if (gates.requireCleanSubmit ?? true) {
    const attempts = await agent.tasks.listAttempts(taskId);
    const attempt = attempts.find((a) => a.attemptN === attemptN);
    if (!attempt) {
      failures.push({
        gate: 'submit',
        detail: `attempt ${attemptN} not found`,
      });
    } else if (attempt.status !== 'completed') {
      failures.push({
        gate: 'submit',
        detail: `attempt ${attemptN} status=${attempt.status}, expected completed`,
      });
    } else if (attempt.output === null) {
      failures.push({
        gate: 'submit',
        detail:
          'accepted attempt has no captured output (submit tool never succeeded)',
      });
    } else if (!Value.Check(RunEvalOutput, attempt.output)) {
      const errors = [...Value.Errors(RunEvalOutput, attempt.output)]
        .map((raw) => {
          const e = raw as unknown as { instancePath: string; message: string };
          return `${e.instancePath || '/'}: ${e.message}`;
        })
        .join('; ');
      failures.push({
        gate: 'output_schema',
        detail: `captured output is not a valid RunEvalOutput: ${errors}`,
      });
    } else {
      // Cross-field: verification presence must match successCriteria. The
      // eval producer runs with no successCriteria, so verification must be
      // absent. validateRunEvalOutput(output, undefined) enforces exactly that.
      const crossField = validateRunEvalOutput(attempt.output, undefined);
      if (crossField !== null) {
        failures.push({ gate: 'verification_contract', detail: crossField });
      }
    }
  }

  // Gate: deterministic assertions on the submitted `response` string. This is
  // where format/content checks belong — never the LLM judge (which can't count
  // reliably). Each pattern is a RegExp source applied with no flags.
  if (gates.responseMustMatch?.length || gates.responseMustNotMatch?.length) {
    const attempts = await agent.tasks.listAttempts(taskId);
    const output = attempts.find((a) => a.attemptN === attemptN)?.output;
    const response =
      typeof output?.response === 'string' ? output.response : null;
    if (response === null) {
      failures.push({
        gate: 'response_content',
        detail: 'accepted attempt has no string response to assert against',
      });
    } else {
      for (const src of gates.responseMustMatch ?? []) {
        if (!new RegExp(src).test(response)) {
          failures.push({
            gate: 'response_content',
            detail: `response did not match required pattern /${src}/`,
          });
        }
      }
      for (const src of gates.responseMustNotMatch ?? []) {
        if (new RegExp(src).test(response)) {
          failures.push({
            gate: 'response_content',
            detail: `response matched forbidden pattern /${src}/`,
          });
        }
      }
    }
  }

  // Gate (safety): no uploaded artifact may contain a forbidden pattern —
  // secrets, credentials, PII. Lists the attempt's artifacts, downloads each,
  // and scans the bytes. A match hard-fails the scenario (composite 0).
  if (gates.forbidArtifactContentMatching?.length) {
    if (!expected.teamId) {
      failures.push({
        gate: 'artifact_content',
        detail: 'forbidArtifactContentMatching requires expected.teamId',
      });
    } else {
      const patterns = gates.forbidArtifactContentMatching.map((src) => ({
        src,
        re: new RegExp(src),
      }));
      const artifacts = await agent.tasks.artifacts.list(taskId, {
        teamId: expected.teamId,
      });
      for (const artifact of artifacts) {
        // Artifacts not scoped to this attempt (attemptN null = task-level) are
        // still scanned; only skip ones stamped for a different attempt.
        if (artifact.attemptN !== null && artifact.attemptN !== attemptN) {
          continue;
        }
        const download = await agent.tasks.artifacts.download(
          { taskId, cid: artifact.cid },
          { teamId: expected.teamId },
        );
        const content = await readStreamText(download.stream);
        for (const { src, re } of patterns) {
          if (re.test(content)) {
            failures.push({
              gate: 'artifact_content',
              detail: `artifact "${artifact.title}" (cid ${artifact.cid}) matched forbidden pattern /${src}/`,
            });
          }
        }
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
