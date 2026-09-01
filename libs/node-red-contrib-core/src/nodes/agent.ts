import { type Agent, connect } from '@themoltnet/sdk';
import type { Node, NodeDef, NodeInitializer } from 'node-red';

/**
 * `moltnet-agent` — a Node-RED **configuration node** that owns a single
 * MoltNet agent identity (Plane B). Other MoltNet nodes reference it and call
 * `getAgent()` to obtain a connected, token-managed SDK agent.
 *
 * The agent key or OAuth2 client secret is stored as a Node-RED credential
 * (encrypted at rest via the runtime's `credentialSecret`), never in the
 * exported flow JSON.
 */

interface MoltnetAgentCredentials {
  agentKey?: string;
  clientSecret?: string;
}

interface MoltnetAgentDef extends NodeDef {
  apiUrl?: string;
  authType?: 'agentKey' | 'oauth2';
  clientId?: string;
  teamId?: string;
  diaryId?: string;
}

export interface MoltnetAgentNode extends Node<MoltnetAgentCredentials> {
  apiUrl: string;
  authType: 'agentKey' | 'oauth2';
  clientId?: string;
  /** Default team context for tasks created via this agent. */
  teamId?: string;
  /** Default diary context for tasks created via this agent. */
  diaryId?: string;
  getAgent(): Promise<Agent>;
  resetAgent(): void;
}

const init: NodeInitializer = (RED): void => {
  function MoltnetAgentNode(
    this: MoltnetAgentNode,
    def: MoltnetAgentDef,
  ): void {
    RED.nodes.createNode(this, def);
    this.apiUrl = def.apiUrl?.trim() || 'https://api.themolt.net';
    this.clientId = def.clientId?.trim();
    // Flows exported before authType existed used OAuth2 and carried clientId.
    this.authType =
      def.authType === 'agentKey' || def.authType === 'oauth2'
        ? def.authType
        : this.clientId
          ? 'oauth2'
          : 'agentKey';
    this.teamId = def.teamId?.trim() || undefined;
    this.diaryId = def.diaryId?.trim() || undefined;

    // Lazily connect once and reuse. OAuth2 tokens refresh under the hood;
    // agent-key connections reuse the same static bearer.
    let agentPromise: Promise<Agent> | null = null;
    this.resetAgent = function resetAgent(): void {
      agentPromise = null;
    };
    this.getAgent = function getAgent(this: MoltnetAgentNode): Promise<Agent> {
      const authType = this.authType;
      const agentKey = this.credentials?.agentKey?.trim();
      const clientId = this.clientId;
      const clientSecret = this.credentials?.clientSecret;
      let createConnection: () => Promise<Agent>;
      if (authType === 'agentKey') {
        if (!agentKey) {
          return Promise.reject(
            new Error('moltnet-agent: agentKey is required'),
          );
        }
        createConnection = () =>
          connect({
            agentKey,
            apiUrl: this.apiUrl,
          });
      } else {
        if (!clientId || !clientSecret) {
          return Promise.reject(
            new Error(
              'moltnet-agent: clientId and clientSecret are required for OAuth2',
            ),
          );
        }
        createConnection = () =>
          connect({
            clientId,
            clientSecret,
            apiUrl: this.apiUrl,
          });
      }
      // Don't cache a rejected connect — a fixed credential should retry.
      if (!agentPromise) {
        agentPromise = createConnection().catch((err) => {
          agentPromise = null;
          throw err;
        });
      }
      return agentPromise;
    };
  }

  RED.nodes.registerType<
    MoltnetAgentNode,
    MoltnetAgentDef,
    Record<string, never>,
    MoltnetAgentCredentials
  >('moltnet-agent', MoltnetAgentNode, {
    credentials: {
      agentKey: { type: 'password' },
      clientSecret: { type: 'password' },
    },
  });
};

export default init;
