import { reportStageFailure, runAdaptiveStage } from './cli.js';
import { env } from './config.js';
import { createReviewCliDeps } from './host-deps.js';

async function main(): Promise<void> {
  const stage = env().ADAPTIVE_STAGE;
  try {
    process.exitCode = await runAdaptiveStage(
      stage ?? '',
      createReviewCliDeps(),
    );
  } catch (error) {
    process.exitCode = reportStageFailure(stage, error, {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
  }
}

void main();
