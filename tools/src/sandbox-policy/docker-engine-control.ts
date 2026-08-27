import { request } from 'node:http';

interface ContainerSummary {
  Id?: string;
  Labels?: Record<string, string>;
  Names?: string[];
}

interface ContainerInspect {
  Config?: { Labels?: Record<string, string> };
  Id?: string;
  Name?: string;
  State?: { ExitCode?: number; Running?: boolean };
}

export interface DockerEngineRetirement {
  confirmed: boolean;
  exitCode: number | null;
  identityConfirmed: boolean;
  killStatus: number | null;
}

export interface DockerEngineControl {
  retireSandbox(options: {
    sandboxName: string;
    socketPath: string;
    workspacePath: string;
    signal?: AbortSignal;
  }): Promise<DockerEngineRetirement>;
}

interface EngineResponse {
  body: string;
  statusCode: number;
}

export const DOCKER_ENGINE_API = '/v1.55';
export const DOCKER_ENGINE_REQUEST_TIMEOUT_MS = 5_000;
export const DOCKER_RETIREMENT_POLL_ATTEMPTS = 50;
export const DOCKER_RETIREMENT_POLL_DELAY_MS = 100;

function engineRequest(
  socketPath: string,
  method: string,
  requestPath: string,
  signal?: AbortSignal,
): Promise<EngineResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      {
        method,
        path: requestPath,
        socketPath,
        signal,
        timeout: DOCKER_ENGINE_REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            statusCode: response.statusCode ?? 0,
          }),
        );
      },
    );
    clientRequest.once('error', (error) =>
      reject(
        new Error(
          `Docker Engine ${method} ${requestPath} via ${socketPath} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
    );
    clientRequest.once('timeout', () =>
      clientRequest.destroy(
        new Error(`Docker Engine ${method} ${requestPath} timed out`),
      ),
    );
    clientRequest.end();
  });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('operation aborted'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('operation aborted'));
      },
      { once: true },
    );
  });
}

function labelsOf(
  container: ContainerSummary | ContainerInspect,
): Record<string, string> | undefined {
  const inspect = container as ContainerInspect;
  return inspect.Config?.Labels ?? (container as ContainerSummary).Labels;
}

function nameOf(
  container: ContainerSummary | ContainerInspect,
): string | undefined {
  const summary = container as ContainerSummary;
  return summary.Names?.[0] ?? (container as ContainerInspect).Name;
}

function hasExpectedIdentity(
  container: ContainerSummary | ContainerInspect,
  sandboxName: string,
  workspacePath: string,
): boolean {
  const labels = labelsOf(container);
  return (
    nameOf(container)?.replace(/^\/+/, '') === sandboxName &&
    labels?.['docker/sandbox'] === 'true' &&
    labels?.['com.docker.sandbox.name'] === sandboxName &&
    labels?.['com.docker.sandbox.workingDirectory'] === workspacePath
  );
}

function failedRetirement(
  overrides: Partial<DockerEngineRetirement> = {},
): DockerEngineRetirement {
  return {
    confirmed: false,
    exitCode: null,
    identityConfirmed: false,
    killStatus: null,
    ...overrides,
  };
}

export const dockerEngineControl: DockerEngineControl = {
  async retireSandbox({ sandboxName, socketPath, workspacePath, signal }) {
    const listed = await engineRequest(
      socketPath,
      'GET',
      `${DOCKER_ENGINE_API}/containers/json?all=1`,
      signal,
    );
    if (listed.statusCode !== 200) {
      return failedRetirement();
    }
    let matches: ContainerSummary[];
    try {
      matches = (JSON.parse(listed.body) as ContainerSummary[]).filter(
        (container) =>
          hasExpectedIdentity(container, sandboxName, workspacePath),
      );
    } catch {
      return failedRetirement();
    }
    if (matches.length !== 1 || !matches[0]?.Id) return failedRetirement();

    const containerId = matches[0].Id;
    const before = await engineRequest(
      socketPath,
      'GET',
      `${DOCKER_ENGINE_API}/containers/${encodeURIComponent(containerId)}/json`,
      signal,
    );
    if (before.statusCode !== 200) return failedRetirement();
    let inspectedBefore: ContainerInspect;
    try {
      inspectedBefore = JSON.parse(before.body) as ContainerInspect;
    } catch {
      return failedRetirement();
    }
    const identityConfirmed =
      inspectedBefore.Id === containerId &&
      inspectedBefore.State?.Running === true &&
      hasExpectedIdentity(inspectedBefore, sandboxName, workspacePath);
    if (!identityConfirmed) return failedRetirement();

    // The immutable container ID was resolved from an adapter-dedicated daemon
    // and independently matched to the exact sandbox and workspace above.
    const killed = await engineRequest(
      socketPath,
      'POST',
      `${DOCKER_ENGINE_API}/containers/${encodeURIComponent(containerId)}/kill?signal=KILL`,
      signal,
    );
    if (killed.statusCode !== 204) {
      return failedRetirement({
        identityConfirmed: true,
        killStatus: killed.statusCode,
      });
    }
    for (
      let attempt = 0;
      attempt < DOCKER_RETIREMENT_POLL_ATTEMPTS;
      attempt += 1
    ) {
      const inspected = await engineRequest(
        socketPath,
        'GET',
        `${DOCKER_ENGINE_API}/containers/${encodeURIComponent(containerId)}/json`,
        signal,
      );
      if (inspected.statusCode === 200) {
        try {
          const state = (JSON.parse(inspected.body) as ContainerInspect).State;
          if (state?.Running === false) {
            return {
              confirmed: true,
              exitCode: state.ExitCode ?? null,
              identityConfirmed: true,
              killStatus: killed.statusCode,
            };
          }
        } catch {
          return failedRetirement({
            identityConfirmed: true,
            killStatus: killed.statusCode,
          });
        }
      }
      await delay(DOCKER_RETIREMENT_POLL_DELAY_MS, signal);
    }
    return failedRetirement({
      identityConfirmed: true,
      killStatus: killed.statusCode,
    });
  },
};
