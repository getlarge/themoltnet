/**
 * Subscription-provider OAuth brokering for Agent Server (#2061 slice 4).
 *
 * The console clicks "Connect"; agent server runs the Pi OAuth flow host-side via
 * `ModelRuntime.login()` (which owns persistence into the shared
 * `pi/auth.json` and token rotation thereafter). The browser only ever sees
 * the provider's authorize URL or device code — never tokens.
 *
 * Provider ids come from Pi's model runtime, so Agent Server stays in lockstep
 * with supported subscription providers. GitHub Copilot is intentionally
 * excluded: MoltNet does not broker editor-seat subscription credentials.
 */
// TODO(upstream): Anthropic logins end on pi's own callback server with a
// Pi-branded success page (`oauthSuccessHtml` in pi-ai's anthropic flow;
// redirect_uri is hardcoded to localhost:53692). A `successRedirectUrl`
// option upstream would let us bounce the tab back to the Console like the
// Codex device-code flow does. Tracked here instead of vendoring the PKCE
// flow into Agent Server.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  ModelRuntime,
  readStoredCredential,
} from '@earendil-works/pi-coding-agent';
import { lockSync } from 'proper-lockfile';

const LOGIN_TTL_MS = 10 * 60 * 1000;
/** How long `start()` waits for the flow to surface a URL / device code. */
const START_INFO_TIMEOUT_MS = 5_000;
const EXCLUDED_SUBSCRIPTION_PROVIDERS = new Set(['github-copilot']);

export class AgentServerSubscriptionError extends Error {
  override name = 'AgentServerSubscriptionError';
  constructor(
    readonly code:
      | 'provider_unknown'
      | 'login_not_found'
      | 'login_cleanup_failed'
      | 'login_unsupported_prompt',
    message: string,
  ) {
    super(message);
  }
}

export interface SubscriptionProviderView {
  id: string;
  name: string;
  connected: boolean;
}

export interface SubscriptionLoginView {
  providerId: string;
  status: 'pending' | 'completed' | 'failed';
  /** Authorize URL the console should open (browser-redirect flows). */
  authUrl?: string;
  instructions?: string;
  /** Device-code flows: what the user types where. */
  userCode?: string;
  verificationUri?: string;
  error?: string;
  /** The initial OAuth handshake has not surfaced actionable information yet. */
  waitingForAuthorization?: boolean;
}

interface PendingLogin extends SubscriptionLoginView {
  operationId: string;
  startedAt: number;
  infoArrived: () => void;
  abort: AbortController;
  invalidated: boolean;
  previousCredential: ReturnType<typeof readStoredCredential>;
}

export interface LoginCallbacksLike {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onDeviceCode: (info: { userCode: string; verificationUri: string }) => void;
  onPrompt: (prompt: { message: string }) => Promise<string>;
  onProgress?: (message: string) => void;
  onSelect: (prompt: {
    message: string;
    options: { id: string; label: string }[];
  }) => Promise<string | undefined>;
  signal?: AbortSignal;
}

export interface ProviderLoginServiceOptions {
  /** Absolute path to the shared Pi auth.json. */
  authPath: string;
  /** Overridable for tests: available providers. */
  listProviders?: () => { id: string; name: string }[];
  /** Overridable for tests: run one login flow to completion + persist. */
  runLogin?: (
    providerId: string,
    callbacks: LoginCallbacksLike,
  ) => Promise<void>;
  /** Overridable for tests: whether a provider has stored credentials. */
  isConnected?: (providerId: string) => boolean;
  /** Initialized Pi runtime. Production uses `ProviderLoginService.create`. */
  modelRuntime?: ModelRuntime;
  logger?: ProviderLoginLogger;
  now?: () => number;
}

export interface ProviderLoginLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

const silentLogger: ProviderLoginLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class ProviderLoginService {
  private readonly logins = new Map<string, PendingLogin>();
  private readonly logger: ProviderLoginLogger;

  constructor(private readonly options: ProviderLoginServiceOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  static async create(
    options: Omit<ProviderLoginServiceOptions, 'modelRuntime'>,
  ): Promise<ProviderLoginService> {
    const modelRuntime = await ModelRuntime.create({
      authPath: options.authPath,
      refreshOnCreate: false,
    });
    return new ProviderLoginService({ ...options, modelRuntime });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private providers(): { id: string; name: string }[] {
    const providers = this.options.listProviders
      ? this.options.listProviders()
      : this.runtime()
          .getProviders()
          .filter((provider) => provider.auth.oauth !== undefined)
          .map((provider) => ({
            id: provider.id,
            name: provider.name,
          }));
    return providers.filter(
      (provider) => !EXCLUDED_SUBSCRIPTION_PROVIDERS.has(provider.id),
    );
  }

  private connected(providerId: string): boolean {
    if (this.options.isConnected) return this.options.isConnected(providerId);
    try {
      return (
        readStoredCredential(providerId, this.options.authPath) !== undefined
      );
    } catch (error) {
      this.logger.warn(
        {
          event: 'agent-server.subscription_auth_read_failed',
          providerId,
          ...safeLoginError(error),
        },
        'Could not read subscription authentication state',
      );
      return false;
    }
  }

  private runtime(): ModelRuntime {
    if (!this.options.modelRuntime) {
      throw new Error(
        'ProviderLoginService requires a model runtime when production adapters are not overridden',
      );
    }
    return this.options.modelRuntime;
  }

  list(): SubscriptionProviderView[] {
    this.sweep();
    return this.providers().map((provider) => ({
      ...provider,
      connected: this.connected(provider.id),
    }));
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, login] of this.logins) {
      if (login.startedAt + LOGIN_TTL_MS <= now) {
        if (login.status === 'pending') this.invalidate(login, 'expired');
        this.logins.delete(id);
      }
    }
  }

  private restoreCredential(login: PendingLogin): boolean {
    try {
      restoreStoredCredential(
        this.options.authPath,
        login.providerId,
        login.previousCredential,
      );
      return true;
    } catch (error) {
      this.logger.error(
        {
          event: 'agent-server.subscription_login_cleanup_failed',
          operationId: login.operationId,
          providerId: login.providerId,
          ...safeLoginError(error),
        },
        'Could not restore subscription credentials after an invalidated login',
      );
      return false;
    }
  }

  private invalidate(
    login: PendingLogin,
    transition: 'cancelled' | 'expired' | 'shutdown',
  ): boolean {
    if (login.invalidated) return true;
    login.invalidated = true;
    login.abort.abort(new Error(`subscription login ${transition}`));
    const restored = this.restoreCredential(login);
    login.infoArrived();
    this.logger.info(
      {
        event: 'agent-server.subscription_login_transition',
        operationId: login.operationId,
        providerId: login.providerId,
        transition,
      },
      'Subscription login invalidated',
    );
    return restored;
  }

  status(providerId: string): SubscriptionLoginView {
    this.sweep();
    const login = this.logins.get(providerId);
    if (!login) {
      throw new AgentServerSubscriptionError(
        'login_not_found',
        `no login in progress for "${providerId}"`,
      );
    }
    return snapshot(login);
  }

  /**
   * Start (or return the in-flight) login for a provider. Resolves once the
   * flow has surfaced an authorize URL / device code, completed, or the
   * start window elapsed — whichever comes first.
   */
  async start(providerId: string): Promise<SubscriptionLoginView> {
    this.sweep();
    if (!this.providers().some((provider) => provider.id === providerId)) {
      throw new AgentServerSubscriptionError(
        'provider_unknown',
        `"${providerId}" is not a known subscription provider`,
      );
    }
    const existing = this.logins.get(providerId);
    if (existing && existing.status === 'pending') return snapshot(existing);

    let infoArrived: () => void = () => undefined;
    const infoPromise = new Promise<void>((resolvePromise) => {
      infoArrived = () => resolvePromise();
    });
    const abort = new AbortController();
    const login: PendingLogin = {
      providerId,
      status: 'pending',
      operationId: randomUUID(),
      startedAt: this.now(),
      infoArrived,
      abort,
      invalidated: false,
      previousCredential: readStoredCredential(
        providerId,
        this.options.authPath,
      ),
    };
    this.logins.set(providerId, login);
    this.logger.info(
      {
        event: 'agent-server.subscription_login_transition',
        operationId: login.operationId,
        providerId,
        transition: 'started',
      },
      'Subscription login started',
    );

    const callbacks = createLoginCallbacks(login, this.logger);

    const runLogin =
      this.options.runLogin ??
      ((id: string, loginCallbacks: LoginCallbacksLike) =>
        this.runtime()
          .login(id, 'oauth', toAuthInteraction(loginCallbacks))
          .then(() => undefined));

    const completion = runLogin(providerId, callbacks).then(
      () => {
        if (login.invalidated) {
          // Some upstream providers finish after abort. Restore the snapshot
          // again so a late persistence write cannot reconnect a cancelled or
          // expired flow.
          this.restoreCredential(login);
          return;
        }
        if (!this.options.runLogin && !this.connected(providerId)) {
          login.status = 'failed';
          login.error =
            'Subscription sign-in completed, but credentials were not persisted. Start again to retry.';
          this.logger.error(
            {
              event: 'agent-server.subscription_login_transition',
              operationId: login.operationId,
              providerId,
              transition: 'persistence_failed',
            },
            'Subscription login credentials were not persisted',
          );
        } else {
          login.status = 'completed';
          this.logger.info(
            {
              event: 'agent-server.subscription_login_transition',
              operationId: login.operationId,
              providerId,
              transition: 'completed',
            },
            'Subscription login completed',
          );
        }
        login.infoArrived();
      },
      (error: unknown) => {
        if (login.invalidated) {
          this.restoreCredential(login);
          return;
        }
        login.status = 'failed';
        login.error = publicLoginError(error);
        this.logger.warn(
          {
            event: 'agent-server.subscription_login_transition',
            operationId: login.operationId,
            providerId,
            transition: 'failed',
            ...safeLoginError(error),
          },
          'Subscription login failed',
        );
        login.infoArrived();
      },
    );
    // Detached: completion is observed through polling `status()`.
    void completion;

    const infoReceived = await Promise.race([
      infoPromise,
      new Promise<void>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise(), START_INFO_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]).then(
      () =>
        login.authUrl !== undefined ||
        login.userCode !== undefined ||
        login.status !== 'pending',
    );
    if (!infoReceived) {
      login.waitingForAuthorization = true;
      this.logger.warn(
        {
          event: 'serve.subscription_login_start_info_timeout',
          operationId: login.operationId,
          providerId,
          timeoutMs: START_INFO_TIMEOUT_MS,
        },
        'Subscription login is still waiting for authorization information',
      );
    }
    return snapshot(login);
  }

  /** Abort an in-flight login and forget it. */
  cancel(providerId: string): { providerId: string; status: 'cancelled' } {
    const login = this.logins.get(providerId);
    if (!login) {
      throw new AgentServerSubscriptionError(
        'login_not_found',
        `no login in progress for "${providerId}"`,
      );
    }
    const restored = this.invalidate(login, 'cancelled');
    if (!restored) {
      throw new ServeSubscriptionError(
        'login_cleanup_failed',
        `could not safely cancel login for "${providerId}"; credential cleanup requires intervention`,
      );
    }
    this.logins.delete(providerId);
    return { providerId, status: 'cancelled' };
  }

  /** Abort every pending flow during supervisor shutdown. */
  close(): void {
    for (const login of this.logins.values()) {
      if (login.status === 'pending') this.invalidate(login, 'shutdown');
    }
    this.logins.clear();
  }
}

function toAuthInteraction(
  callbacks: LoginCallbacksLike,
): Parameters<ModelRuntime['login']>[2] {
  return {
    ...(callbacks.signal ? { signal: callbacks.signal } : {}),
    notify: (event) => {
      switch (event.type) {
        case 'auth_url':
          callbacks.onAuth({
            url: event.url,
            ...(event.instructions ? { instructions: event.instructions } : {}),
          });
          break;
        case 'device_code':
          callbacks.onDeviceCode({
            userCode: event.userCode,
            verificationUri: event.verificationUri,
          });
          break;
        case 'info':
        case 'progress':
          callbacks.onProgress?.(event.message);
          break;
      }
    },
    prompt: async (prompt) => {
      if (prompt.type !== 'select') {
        return callbacks.onPrompt({ message: prompt.message });
      }
      const selected = await callbacks.onSelect({
        message: prompt.message,
        options: prompt.options.map(({ id, label }) => ({ id, label })),
      });
      if (!selected) {
        throw new AgentServerSubscriptionError(
          'login_unsupported_prompt',
          'This provider flow did not offer a supported sign-in method',
        );
      }
      return selected;
    },
  };
}

function restoreStoredCredential(
  authPath: string,
  providerId: string,
  credential: ReturnType<typeof readStoredCredential>,
): void {
  mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(authPath, '{}\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const release = lockSync(authPath, { realpath: false });
  const temp = `${authPath}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Pi credential store is not an object: ${authPath}`);
    }
    const credentials = parsed as Record<string, unknown>;
    if (credential) credentials[providerId] = credential;
    else delete credentials[providerId];
    writeFileSync(temp, `${JSON.stringify(credentials, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temp, authPath);
  } finally {
    rmSync(temp, { force: true });
    release();
  }
}

function createLoginCallbacks(
  login: PendingLogin,
  logger: ProviderLoginLogger,
): LoginCallbacksLike {
  return {
    onAuth: (info) => {
      login.authUrl = info.url;
      if (info.instructions) login.instructions = info.instructions;
      logger.info(
        {
          event: 'agent-server.subscription_login_transition',
          operationId: login.operationId,
          providerId: login.providerId,
          transition: 'authorization_ready',
        },
        'Subscription authorization URL ready',
      );
      login.infoArrived();
    },
    onDeviceCode: (info) => {
      login.userCode = info.userCode;
      login.verificationUri = info.verificationUri;
      logger.info(
        {
          event: 'agent-server.subscription_login_transition',
          operationId: login.operationId,
          providerId: login.providerId,
          transition: 'device_code_ready',
        },
        'Subscription device code ready',
      );
      login.infoArrived();
    },
    // AgentServer has no interactive terminal: any flow demanding a typed
    // answer fails closed with an actionable message instead of hanging.
    onPrompt: () =>
      Promise.reject(
        new AgentServerSubscriptionError(
          'login_unsupported_prompt',
          'This provider flow needs an interactive prompt; run `pi /login` in a terminal instead',
        ),
      ),
    // Some flows ask which login method to use (Codex offers browser vs
    // device code; answering `undefined` cancels the login outright).
    // Prefer the device-code method: the console shows the code inline,
    // no localhost callback server involved. Otherwise take the first
    // (default) option.
    onSelect: (prompt) =>
      Promise.resolve(
        (
          prompt.options.find((option) => /device/i.test(option.id)) ??
          prompt.options[0]
        )?.id,
      ),
    signal: login.abort.signal,
  };
}

function publicLoginError(error: unknown): string {
  if (error instanceof AgentServerSubscriptionError) return error.message;
  return 'Subscription sign-in failed. Start again to retry.';
}

function safeLoginError(error: unknown): Record<string, string> {
  const result: Record<string, string> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z0-9_:-]{1,64}$/iu.test(code)) {
    result['applicationCode'] = code;
  }
  return result;
}

function snapshot(login: PendingLogin): SubscriptionLoginView {
  const {
    providerId,
    status,
    authUrl,
    instructions,
    userCode,
    verificationUri,
    error,
    waitingForAuthorization,
  } = login;
  return {
    providerId,
    status,
    ...(authUrl ? { authUrl } : {}),
    ...(instructions ? { instructions } : {}),
    ...(userCode ? { userCode } : {}),
    ...(verificationUri ? { verificationUri } : {}),
    ...(error ? { error } : {}),
    ...(waitingForAuthorization ? { waitingForAuthorization } : {}),
  };
}
