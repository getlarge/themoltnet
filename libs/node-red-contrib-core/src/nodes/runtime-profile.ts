import type { Node, NodeDef, NodeInitializer } from 'node-red';

import type { MoltnetAgentNode } from './agent.js';

/**
 * `moltnet-runtime-profile` — a Node-RED **configuration node** that names one
 * MoltNet runtime profile by `profileId`. `tasks: create` references it to set
 * the task's `allowedProfiles`, routing the task to a daemon serving that
 * profile.
 *
 * Important: `allowedProfiles` is a routing **gate**, not a model selector. A
 * daemon runs exactly one profile (`--profile <id>`) and only claims tasks
 * whose `allowedProfiles` include it (an empty list = unrestricted). Selecting a
 * profile here does not, by itself, run a different model — it requires a daemon
 * serving that profile to be running.
 *
 * The node references a `moltnet-agent` (for team context) and registers an
 * admin HTTP endpoint the editor calls to populate a dropdown of the team's
 * profiles via `agent.runtimeProfiles.list()`. The endpoint resolves the agent
 * by id, so it only works once that agent config node is **deployed** — the
 * editor falls back to a manual profileId input otherwise.
 */

interface MoltnetRuntimeProfileDef extends NodeDef {
  agent?: string; // id of the referenced moltnet-agent config node
  profileId?: string;
  profileName?: string;
}

export interface MoltnetRuntimeProfileNode extends Node {
  agent?: string;
  profileId?: string;
  profileName?: string;
}

const init: NodeInitializer = (RED): void => {
  function MoltnetRuntimeProfileNode(
    this: MoltnetRuntimeProfileNode,
    def: MoltnetRuntimeProfileDef,
  ): void {
    RED.nodes.createNode(this, def);
    this.agent = def.agent || undefined;
    this.profileId = def.profileId?.trim() || undefined;
    this.profileName = def.profileName?.trim() || undefined;
  }

  RED.nodes.registerType('moltnet-runtime-profile', MoltnetRuntimeProfileNode);

  // Editor dropdown source: list the team's runtime profiles for a deployed
  // agent. Guarded with the editor's own auth. Returns 200 with `{profiles,
  // error}` even on failure so the editor degrades to the manual field instead
  // of surfacing a 500. Guarded against runtimes without httpAdmin (unit tests).
  RED.httpAdmin?.get(
    '/moltnet-runtime-profiles/:agentId',
    RED.auth.needsPermission('moltnet-runtime-profile.read'),
    (req, res) => {
      const run = async (): Promise<void> => {
        try {
          const agentId = String(req.params.agentId);
          const agentNode = RED.nodes.getNode(
            agentId,
          ) as MoltnetAgentNode | null;
          if (!agentNode || typeof agentNode.getAgent !== 'function') {
            res.json({ profiles: [], error: 'agent-not-deployed' });
            return;
          }
          const agent = await agentNode.getAgent();
          const { items } = await agent.runtimeProfiles.list(
            agentNode.teamId ? { teamId: agentNode.teamId } : undefined,
          );
          res.json({
            profiles: items.map((p) => ({
              id: p.id,
              name: p.name,
              model: p.model,
              provider: p.provider,
            })),
          });
        } catch (err) {
          res.json({
            profiles: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      void run();
    },
  );
};

export default init;
