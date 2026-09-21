/** Production CLI lifecycle with a deterministic catalogue port. */
import { fileURLToPath } from 'node:url';

import {
  captureTeamCredential,
  loadAgentActivation,
  runAgentServer,
} from '@themoltnet/agent-daemon/testing';
import type { Agent } from '@themoltnet/sdk';

const project = {
  id: 'project',
  teamId: 'team',
  name: 'Fixture project',
  description: null,
  defaultDiaryId: '00000000-0000-4000-8000-000000000001',
  archived: false,
};

const [command, ...args] = process.argv.slice(2);
if (command !== 'server') throw new Error('Expected the server command');
process.exitCode = await runAgentServer(args, {
  configure(store) {
    if (!store.readActivation('desktop-fixture')) {
      store.writeAgentConfig('desktop-fixture', {
        subject_id: 'desktop-fixture',
        subject_type: 'agent',
        registered_at: '2026-09-20T12:00:00Z',
        agent_key_ref: { provider: 'file', key: 'fixture-agent-key' },
        keys: {
          public_key: 'fixture',
          fingerprint: 'fixture',
          private_key_ref: { provider: 'file', key: 'fixture' },
        },
        endpoints: { api: 'http://127.0.0.1:1', mcp: 'http://127.0.0.1:1/mcp' },
      });
      store.writeActivation({
        source: 'managed',
        alias: 'desktop-fixture',
        subjectId: 'desktop-fixture',
        publicKey: 'fixture',
        fingerprint: 'fixture',
        createdAt: '2026-09-20T12:00:00Z',
        apiUrl: 'http://127.0.0.1:1',
      });
    }
    return {
      runOptions: {
        entrypoint: {
          execPath: process.execPath,
          execArgv: ['--import', import.meta.resolve('tsx')],
          scriptPath: fileURLToPath(
            new URL('./desktop-worker.ts', import.meta.url),
          ),
        },
        verifyActivationImpl: async (
          selectedStore,
          alias,
          _managed,
          _external,
          _connect,
          _signal,
          teamId,
        ) => {
          if (alias !== 'desktop-fixture' || teamId !== 'team')
            throw new Error('Unknown fixture identity/team');
          return captureTeamCredential(
            await loadAgentActivation(selectedStore, alias),
            {
              agentKey: 'fixture-only-agent-key',
              metadata: {
                keyId: 'fixture',
                verifiedAt: '2026-09-20T12:00:00Z',
                scopes: ['team:read'],
              },
              client: {
                projects: {
                  get: async (id: string) => ({
                    id,
                    teamId: 'team',
                    archived: false,
                    defaultDiaryId: '00000000-0000-4000-8000-000000000001',
                  }),
                },
                diaries: {
                  get: async (id: string) => ({ id, teamId: 'team' }),
                },
              } as unknown as Agent,
            },
          );
        },
        resolveRuntimeModule: async () => undefined,
      },
      catalogueAgentFor: async () => ({
        teamIds: ['team'],
        lastVerified: () => undefined,
        readTeam: async () => ({
          team: { id: 'team', name: 'Fixture team' },
          diaries: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              teamId: 'team',
              name: 'Fixture diary',
            },
          ],
          profiles: [],
          credential: {
            keyId: 'fixture',
            verifiedAt: '2026-09-20T12:00:00Z',
            scopes: ['team:read'],
          },
        }),
        readProjects: async () => ({ items: [project], truncated: false }),
        readProject: async (_teamId, projectId) =>
          projectId === project.id ? project : null,
      }),
    };
  },
});
