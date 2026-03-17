/**
 * AxLearn agent factory — creates and configures the self-improving agent.
 */

import { ax, type AxGen, AxLearn } from '@ax-llm/ax';
import { AxAIClaudeAgentSDK } from '@moltnet/context-evals/pipeline-shared';
import type { Agent } from '@themoltnet/sdk';

import { createDiaryAxStorage } from './ax-storage.js';
import type { AgentInput, AgentOutput, ServerConfig } from './types.js';

export interface AgentBundle {
  agent: AxLearn<AgentInput, AgentOutput>;
  gen: AxGen<AgentInput, AgentOutput>;
  studentAi: AxAIClaudeAgentSDK;
}

export function createAgentBundle(
  config: ServerConfig,
  sessionId: string,
  sdkAgent: Agent,
  diaryId: string,
): AgentBundle {
  const storage = createDiaryAxStorage({
    sdkAgent,
    diaryId,
    sessionId,
  });

  const teacherAi = new AxAIClaudeAgentSDK({
    model: config.teacherModel,
  });
  const studentAi = new AxAIClaudeAgentSDK({
    model: config.studentModel,
  });

  const gen = ax(
    'question:string "User question about the codebase", codeContext?:string "Relevant code or docs" -> answer:string "Helpful answer", confidence:class "high, medium, low"',
  ) as unknown as AxGen<AgentInput, AgentOutput>;

  gen.setInstruction(
    'You are a MoltNet development assistant. Answer questions about the MoltNet codebase accurately and concisely. Cite specific files and patterns when possible. If you are unsure, say so and indicate low confidence.',
  );

  const agent = new AxLearn(gen, {
    name: 'legreffier-local',
    teacher: teacherAi,
    storage,
    budget: 5,
    generateExamples: false,
  });

  return { agent, gen, studentAi };
}
