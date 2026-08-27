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
  }): Promise<DockerEngineRetirement>;
}

interface EngineResponse {
  body: string;
  statusCode: number;
}

function engineRequest(
  socketPath: string,
  method: string,
  requestPath: string,
): Promise<EngineResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = request(
      { method, path: requestPath, socketPath },
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
    clientRequest.once('error', reject);
    clientRequest.end();
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
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
  async retireSandbox({ sandboxName, socketPath, workspacePath }) {
    const listed = await engineRequest(
      socketPath,
      'GET',
      '/v1.55/containers/json?all=1',
    );
    if (listed.statusCode !== 200) {
      return failedRetirement({ killStatus: listed.statusCode });
    }
    const matches = (JSON.parse(listed.body) as ContainerSummary[]).filter(
      (container) => hasExpectedIdentity(container, sandboxName, workspacePath),
    );
    if (matches.length !== 1 || !matches[0]?.Id) return failedRetirement();

    const containerId = matches[0].Id;
    const before = await engineRequest(
      socketPath,
      'GET',
      `/v1.55/containers/${encodeURIComponent(containerId)}/json`,
    );
    if (before.statusCode !== 200) return failedRetirement();
    const inspectedBefore = JSON.parse(before.body) as ContainerInspect;
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
      `/v1.55/containers/${encodeURIComponent(containerId)}/kill?signal=KILL`,
    );
    if (killed.statusCode !== 204) {
      return failedRetirement({
        identityConfirmed: true,
        killStatus: killed.statusCode,
      });
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const inspected = await engineRequest(
        socketPath,
        'GET',
        `/v1.55/containers/${encodeURIComponent(containerId)}/json`,
      );
      if (inspected.statusCode === 200) {
        const state = (JSON.parse(inspected.body) as ContainerInspect).State;
        if (state?.Running === false) {
          return {
            confirmed: true,
            exitCode: state.ExitCode ?? null,
            identityConfirmed: true,
            killStatus: killed.statusCode,
          };
        }
      }
      await delay(100);
    }
    return failedRetirement({
      identityConfirmed: true,
      killStatus: killed.statusCode,
    });
  },
};
