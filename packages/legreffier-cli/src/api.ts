import {
  createClient,
  getLegreffierOnboardingStatus,
  type ProblemDetails,
  startLegreffierOnboarding,
  type ValidationProblemDetails,
} from '@moltnet/api-client';
import { problemToError } from '@themoltnet/sdk';

const POLL_INTERVAL_MS = 5000;

function isProblemDetails(err: unknown): err is ProblemDetails {
  return (
    typeof err === 'object' &&
    err !== null &&
    'title' in err &&
    typeof (err as ProblemDetails).title === 'string' &&
    'status' in err &&
    typeof (err as ProblemDetails).status === 'number'
  );
}

function isValidationProblemDetails(
  err: unknown,
): err is ValidationProblemDetails {
  return (
    isProblemDetails(err) &&
    'errors' in err &&
    Array.isArray((err as ValidationProblemDetails).errors)
  );
}

/**
 * Converts any thrown value to a human-readable string.
 * Handles ProblemDetails and ValidationProblemDetails objects thrown by
 * @hey-api on HTTP errors, then falls back to Error.message, then
 * JSON.stringify.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (isValidationProblemDetails(err)) {
    const base = problemToError(err, err.status).message;
    const fieldErrors = err.errors
      .map((e) => `  ${e.field}: ${e.message}`)
      .join('\n');
    return fieldErrors ? `${base}\n${fieldErrors}` : base;
  }
  if (isProblemDetails(err)) {
    return problemToError(err, err.status).message;
  }
  return JSON.stringify(err);
}
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface OnboardingStart {
  workflowId: string;
  manifestFormUrl: string;
}

export type OnboardingStatus =
  | 'awaiting_github'
  | 'github_code_ready'
  | 'awaiting_installation'
  | 'completed'
  | 'failed';

export interface OnboardingStatusResult {
  status: OnboardingStatus;
  githubCode?: string;
  identityId?: string;
  clientId?: string;
  clientSecret?: string;
}

export function makeClient(baseUrl: string) {
  return createClient({ baseUrl });
}

export async function startOnboarding(
  baseUrl: string,
  body: { publicKey: string; fingerprint: string; agentName: string },
): Promise<OnboardingStart> {
  const client = makeClient(baseUrl);
  const res = await startLegreffierOnboarding({
    client,
    body,
    throwOnError: true,
  });
  return res.data as OnboardingStart;
}

/**
 * Returns true if the workflow exists and is not in a terminal failed state.
 * Returns false if the workflow is unknown (404) or the request errors out.
 */
export async function checkWorkflowLive(
  baseUrl: string,
  workflowId: string,
): Promise<boolean> {
  try {
    const result = await pollStatus(baseUrl, workflowId);
    return result.status !== 'failed';
  } catch {
    return false;
  }
}

export async function pollStatus(
  baseUrl: string,
  workflowId: string,
): Promise<OnboardingStatusResult> {
  const client = makeClient(baseUrl);
  const res = await getLegreffierOnboardingStatus({
    client,
    path: { workflowId },
    throwOnError: true,
  });
  return res.data as OnboardingStatusResult;
}

export async function pollUntil(
  baseUrl: string,
  workflowId: string,
  targetStatuses: OnboardingStatus[],
  onTick?: (status: OnboardingStatus) => void,
): Promise<OnboardingStatusResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await pollStatus(baseUrl, workflowId);
    onTick?.(result.status);
    if (targetStatuses.includes(result.status)) {
      return result;
    }
    if (result.status === 'failed') {
      throw new Error('Onboarding workflow failed');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
  throw new Error(
    `Timed out waiting for status: ${targetStatuses.join(' or ')}`,
  );
}
