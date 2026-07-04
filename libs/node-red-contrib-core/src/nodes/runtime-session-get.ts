import type {
  Node,
  NodeDef,
  NodeInitializer,
  NodeMessageInFlow,
} from 'node-red';

import type { MoltnetAgentNode } from './agent.js';
import { withAgent } from './agent-call.js';
import { bool } from './query-utils.js';
import { requireAttemptContext } from './task-artifact-utils.js';

interface RuntimeSessionGetDef extends NodeDef {
  agent?: string;
  taskId?: string;
  teamId?: string;
  allowMsgTeamOverride?: boolean | string;
  attemptN?: number | string;
}

const init: NodeInitializer = (RED): void => {
  function RuntimeSessionGetNode(this: Node, def: RuntimeSessionGetDef): void {
    RED.nodes.createNode(this, def);
    const agentNode = def.agent
      ? (RED.nodes.getNode(def.agent) as MoltnetAgentNode | null)
      : null;

    this.on('input', (msg: NodeMessageInFlow, send, done) => {
      const run = async (): Promise<void> => {
        try {
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            throw new Error('runtime-session-get: no moltnet-agent configured');
          }
          const { taskId, teamId, attemptN } = requireAttemptContext(
            'runtime-session-get',
            msg,
            def.taskId,
            def.teamId,
            def.attemptN,
            agentNode,
            bool(def.allowMsgTeamOverride) ?? false,
          );

          this.status({ fill: 'blue', shape: 'dot', text: 'loading…' });
          const session = await withAgent(agentNode, (agent) =>
            agent.runtimeSessions.getForAttempt(
              { taskId, attemptN },
              { teamId },
            ),
          );

          const out = RED.util.cloneMessage(msg);
          out.payload = session;
          out.taskId = taskId;
          out.runtimeSession = { taskId, teamId, attemptN, session };
          this.status({
            fill: session ? 'green' : 'yellow',
            shape: session ? 'dot' : 'ring',
            text: session ? 'found' : 'not found',
          });
          send(out);
          done();
        } catch (err) {
          this.status({ fill: 'red', shape: 'ring', text: 'error' });
          done(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void run();
    });
  }

  RED.nodes.registerType('moltnet-runtime-session-get', RuntimeSessionGetNode);
};

export default init;
