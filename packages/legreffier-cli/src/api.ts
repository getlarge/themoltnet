import {
  createClient,
  getLegreffierOnboardingStatus,
  startLegreffierOnboarding,
} from '@moltnet/api-client';

const POLL_INTERVAL_MS = 2000;
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
