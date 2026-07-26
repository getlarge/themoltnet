export {
  createParallelBriefsAbsurdApp,
  PARALLEL_BRIEFS_TASK,
} from './absurd.js';
export type {
  BriefResult,
  BriefState,
  ParallelBriefsDeps,
  ParallelBriefsInput,
  ParallelBriefsOutput,
} from './types.js';
export { normalizeParallelBriefsInput, runParallelBriefs } from './workflow.js';
