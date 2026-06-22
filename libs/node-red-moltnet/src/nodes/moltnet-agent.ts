import { type Agent, connect } from '@themoltnet/sdk';

/**
 * `moltnet-agent` — a Node-RED **configuration node** that owns a single
 * MoltNet agent identity (Plane B). Other MoltNet nodes reference it and
 * call `getAgent()` to obtain a connected, token-managed SDK agent.
 *
 * The client secret is stored as a Node-RED credential (encrypted at rest
 * via the runtime's `credentialSecret`), never in the exported flow JSON.
 */

interface MoltnetAgentConfig {
  name?: string;
  apiUrl?: string;
  clientId?: string;
}

/** Minimal slice of the Node-RED runtime API this node depends on. */
interface RED {
  nodes: {
    createNode(node: unknown, config: MoltnetAgentConfig): void;
    registerType(
      type: string,
      ctor: (this: MoltnetAgentNode, config: MoltnetAgentConfig) => void,
      opts?: { credentials?: Record<string, { type: 'text' | 'password' }> },
    ): void;
  };
}

interface MoltnetAgentNode {
  credentials?: { clientSecret?: string };
  apiUrl: string;
  clientId?: string;
  getAgent(): Promise<Agent>;
}

export default function (RED: RED): void {
  function MoltnetAgentNode(
    this: MoltnetAgentNode,
    config: MoltnetAgentConfig,
  ): void {
    RED.nodes.createNode(this, config);
    this.apiUrl = config.apiUrl?.trim() || 'https://api.themolt.net';
    this.clientId = config.clientId?.trim();

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
      if (!agentPromise) {
        agentPromise = connect({
          clientId: this.clientId,
          clientSecret,
          apiUrl: this.apiUrl,
        });
      }
      return agentPromise;
    };
  }

  RED.nodes.registerType('moltnet-agent', MoltnetAgentNode, {
    credentials: { clientSecret: { type: 'password' } },
  });
}
