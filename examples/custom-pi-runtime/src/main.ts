import { defineTool } from '@earendil-works/pi-coding-agent';
import { runAgentDaemonCli } from '@themoltnet/agent-daemon';
import { createPiDaemonAdapter } from '@themoltnet/agent-daemon/pi';
import {
  defineGondolinTemplate,
  definePiRuntime,
  definePiTool,
} from '@themoltnet/pi-runtime';
import { Type } from 'typebox';

const hello = definePiTool(
  defineTool({
    name: 'hello',
    label: 'Hello',
    description: 'Return a greeting from the custom runtime.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1 }),
    }),
    async execute(_id, { name }) {
      return {
        content: [{ type: 'text', text: `Hello, ${name}!` }],
        details: {},
      };
    },
  }),
);

const runtime = definePiRuntime({
  id: 'example-custom-pi',
  version: '1',
  runtimeKind: 'example_pi',
  vm: defineGondolinTemplate({
    id: 'example-node-git',
    version: '1',
    snapshot: {
      setupCommands: ['apk add --no-cache git nodejs npm'],
      allowedHosts: ['dl-cdn.alpinelinux.org'],
    },
    executables: ['git', 'node', 'npm'],
  }),
  tools: [hello],
});

process.exitCode = await runAgentDaemonCli({
  runtime: createPiDaemonAdapter(runtime),
});
