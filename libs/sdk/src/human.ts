import type { Client, Config } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';

import type {
  DaemonProfilesNamespace,
  DiariesNamespace,
  DiaryGrantsNamespace,
  EntriesNamespace,
  LegreffierNamespace,
  PacksNamespace,
  ProblemsNamespace,
  PublicNamespace,
  TasksNamespace,
  TeamsNamespace,
} from './agent.js';
import type { AgentContext } from './agent-context.js';
import { createDaemonProfilesNamespace } from './namespaces/daemon-profiles.js';
import { createDiariesNamespace } from './namespaces/diaries.js';
import { createDiaryGrantsNamespace } from './namespaces/diary-grants.js';
import { createEntriesNamespace } from './namespaces/entries.js';
import { createLegreffierNamespace } from './namespaces/legreffier.js';
import { createPacksNamespace } from './namespaces/packs.js';
import { createProblemsNamespace } from './namespaces/problems.js';
import { createPublicNamespace } from './namespaces/public.js';
import { createTasksNamespace } from './namespaces/tasks.js';
import { createTeamsNamespace } from './namespaces/teams.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface HumanClient {
  readonly kind: 'human';
  diaries: DiariesNamespace;
  diaryGrants: DiaryGrantsNamespace;
  daemonProfiles: DaemonProfilesNamespace;
  packs: PacksNamespace;
  entries: EntriesNamespace;
  public: PublicNamespace;
  legreffier: LegreffierNamespace;
  problems: ProblemsNamespace;
  teams: TeamsNamespace;
  tasks: TasksNamespace;

  /** Return the underlying hey-api client for advanced use. */
  readonly client: Client;
}

export interface ConnectHumanOptions {
  /** REST API base URL. Defaults to the hosted MoltNet API. */
  apiUrl?: string;
  /**
   * Human session token to send via `X-Moltnet-Session-Token`.
   *
   * This is a Kratos native session token returned by the Ory/Kratos native
   * login flow, not the browser session cookie value.
   */
  sessionToken?:
    | string
    | (() => Promise<string | undefined> | string | undefined);
  /**
   * Bearer token for human-authenticated API calls.
   *
   * Use this for OAuth2 authorization-code flows that hand the SDK a human
   * access token directly.
   */
  bearerToken?:
    | string
    | (() => Promise<string | undefined> | string | undefined);
  /**
   * Browser credential mode. Defaults to `include` so same-site / cross-site
   * Ory session cookies can be sent by browser-based docs or console flows.
   */
  credentials?: RequestCredentials;
  /** Additional default headers to include on every request. */
  headers?: Config['headers'];
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
  /** Existing API client. Intended for tests and advanced integrations. */
  client?: Client;
}

export function connectHuman(options: ConnectHumanOptions = {}): HumanClient {
  const client =
    options.client ??
    createClient({
      baseUrl: (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ''),
      credentials: options.credentials ?? 'include',
      ...(options.fetch && { fetch: options.fetch }),
      ...(options.headers && { headers: options.headers }),
    });

  const auth = createHumanAuth(options);
  const context: AgentContext = { client, auth };

  return {
    kind: 'human',
    diaries: createDiariesNamespace(context),
    diaryGrants: createDiaryGrantsNamespace(context),
    daemonProfiles: createDaemonProfilesNamespace(context),
    packs: createPacksNamespace(context),
    entries: createEntriesNamespace(context),
    public: createPublicNamespace(context),
    legreffier: createLegreffierNamespace(context),
    problems: createProblemsNamespace(context),
    teams: createTeamsNamespace(context),
    tasks: createTasksNamespace(context),
    client,
  };
}

function createHumanAuth(
  options: Pick<ConnectHumanOptions, 'bearerToken' | 'sessionToken'>,
): AgentContext['auth'] | undefined {
  if (!options.bearerToken && !options.sessionToken) {
    return undefined;
  }

  return async (auth) => {
    if (auth.scheme === 'bearer' && options.bearerToken) {
      return resolveToken(options.bearerToken);
    }

    if (auth.name === 'X-Moltnet-Session-Token' && options.sessionToken) {
      return resolveToken(options.sessionToken);
    }

    return undefined;
  };
}

async function resolveToken(
  token: string | (() => Promise<string | undefined> | string | undefined),
): Promise<string | undefined> {
  return typeof token === 'function' ? token() : token;
}
