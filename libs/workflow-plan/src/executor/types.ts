import type {
  Logger,
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import type { HumanGateNode, WorkflowPlan } from '../plan/schema.js';

/** The exact output revision a decision was made against. */
export interface OutputRevision {
  node: string;
  /** Node run counter: 1 for the first run, +1 per accepted revision. */
  runN: number;
  taskId: string;
  attemptN: number;
  outputCid: string | null;
}

export type DecisionOption = HumanGateNode['options'][number];

/** A persisted human decision. Stored by the surrounding application. */
export interface DecisionRecord {
  planId: string;
  planRevision: number;
  gate: string;
  reviewed: OutputRevision;
  option: DecisionOption;
  note?: string;
  decidedBy: string;
  decidedAt: string;
}

/**
 * Where human decisions live. The executor only reads; the application writes
 * on behalf of an authenticated or attributed person. A decision counts only
 * when its `reviewed` revision matches the revision the executor is gating.
 */
export interface DecisionStore {
  find(args: {
    planId: string;
    gate: string;
    reviewed: OutputRevision;
  }): Promise<DecisionRecord | null>;
}

export type DomainCheck = (
  output: unknown,
  context: { node: string; plan: WorkflowPlan },
) => string[]; // returns problems; empty = pass

export interface PlanExecutorHooks {
  /** Called after a task node's create step completed (crash injection point). */
  afterTaskCreate?(args: {
    node: string;
    taskId: string;
  }): Promise<void> | void;
  /** Called before each poll of a human gate (crash injection point). */
  beforeGatePoll?(args: { gate: string }): Promise<void> | void;
}

export interface PlanExecutorDeps {
  tasks: TaskClient;
  decisions: DecisionStore;
  /** Domain checks addressable from `output.domainChecks`. */
  domainChecks?: Record<string, DomainCheck>;
  /** Output schema validation. Defaults to TypeBox `Value.Check`. */
  validateOutput?: (schema: unknown, output: unknown) => string[];
  /** Resolve the content/body of an `artifact` input binding for the brief. */
  logger?: Logger;
  hooks?: PlanExecutorHooks;
  /** Default poll interval for task waits. */
  pollIntervalSec?: number;
  now?: () => string;
}

export type NodeStatus =
  | 'pending'
  | 'waiting_dependencies'
  | 'task_created'
  | 'accepted'
  | 'awaiting_decision'
  | 'decided'
  | 'invalid_output'
  | 'failed'
  | 'blocked'
  | 'skipped_by_decision'
  | 'invalidated';

export interface NodeState {
  node: string;
  status: NodeStatus;
  runN: number;
  taskId?: string;
  /** Every task created for this node across runs and repairs (for audits). */
  taskIds: string[];
  accepted?: OutputRevision & { output: unknown };
  decision?: DecisionRecord;
  reason?: string;
}

export type ExecutionStatus =
  | 'completed'
  | 'rejected'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface ExecutionResult {
  planId: string;
  planRevision: number;
  status: ExecutionStatus;
  nodes: Record<string, NodeState>;
  /** Total MoltNet tasks created by this execution, including repairs. */
  tasksCreated: number;
  decisions: DecisionRecord[];
  reason?: string;
}

export type { Logger, SdkTask, SdkTaskAttempt, TaskClient, WorkflowContext };
