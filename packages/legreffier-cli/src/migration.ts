export const retirementMessage = `LeGreffier CLI has been retired.

Choose the command that matches the job:

  Human Codex or Claude session
    Install "LeGreffier by MoltNet" from your host's plugin directory.

  Initialize an autonomous agent
    moltnet agents init --name <agent-name>

  Port an existing identity into this repository
    moltnet config port --from /path/to/.moltnet/<agent> --dir .

Guide: https://docs.themolt.net/start/install-and-initialize`;

export function getRetirementResponse(arguments_: readonly string[]) {
  const helpRequested = arguments_.some((argument) =>
    ['--help', '-h'].includes(argument),
  );

  return {
    exitCode: helpRequested ? 0 : 1,
    output: retirementMessage,
    stream: helpRequested ? 'stdout' : 'stderr',
  } as const;
}
