import { type Agent, connect } from '@themoltnet/sdk';
import type { Node, NodeDef, NodeInitializer } from 'node-red';

/**
 * `moltnet-agent` — a Node-RED **configuration node** that owns a single
 * MoltNet agent identity (Plane B). Other MoltNet nodes reference it and call
 * `getAgent()` to obtain a connected, token-managed SDK agent.
 *
 * The client secret is stored as a Node-RED credential (encrypted at rest via
 * the runtime's `credentialSecret`), never in the exported flow JSON.
 */

interface MoltnetAgentCredentials {
  clientSecret: string;
}

interface MoltnetAgentDef extends NodeDef {
  apiUrl?: string;
  clientId?: string;
}

export interface MoltnetAgentNode extends Node<MoltnetAgentCredentials> {
  apiUrl: string;
  clientId?: string;
  getAgent(): Promise<Agent>;
}

const init: NodeInitializer = (RED): void => {
  function MoltnetAgentNode(
    this: MoltnetAgentNode,
    def: MoltnetAgentDef,
  ): void {
    RED.nodes.createNode(this, def);
    this.apiUrl = def.apiUrl?.trim() || 'https://api.themolt.net';
    this.clientId = def.clientId?.trim();

    // Lazily connect once and reuse; the SDK's TokenManager refreshes the
    // OAuth2 token under the hood, so one Agent per config node is correct.
    let agentPromise: Promise<Agent> | null = null;
    this.getAgent = function getAgent(this: MoltnetAgentNode): Promise<Agent> {
      const clientSecret = this.credentials?.clientSecret;
      if (!this.clientId || !clientSecret) {
        return Promise.reject(
          new Error('moltnet-agent: clientId and clientSecret are required'),
        );
      }
      agentPromise ??= connect({
        clientId: this.clientId,
        clientSecret,
        apiUrl: this.apiUrl,
      });
      return agentPromise;
    };
  }

  RED.nodes.registerType('moltnet-agent', MoltnetAgentNode, {
    credentials: { clientSecret: { type: 'password' } },
  });
};

export default init;
