import { createHash } from 'node:crypto';

/** Stable identity for complete workflow consumers. */
export function executionCorrelation(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function actionReviewCorrelation(source: NodeJS.ProcessEnv): string {
  if (!source.ADAPTIVE_REPOSITORY || !source.GITHUB_RUN_ID)
    throw new Error('Actions repository and run ID required');
  const attempt =
    source.ADAPTIVE_EXECUTION_MODE === 'ephemeral'
      ? `:attempt:${source.GITHUB_RUN_ATTEMPT}`
      : '';
  if (attempt && !/^[1-9]\d*$/.test(source.GITHUB_RUN_ATTEMPT ?? ''))
    throw new Error('Actions run attempt required');
  return executionCorrelation(
    `${source.ADAPTIVE_REPOSITORY}:${source.GITHUB_RUN_ID}${attempt}`,
  );
}
