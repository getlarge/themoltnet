/**
 * Subscription-provider OAuth brokering for `serve` (#2061 slice 4).
 *
 * The console clicks "Connect"; serve runs the Pi OAuth flow host-side via
 * `AuthStorage.login()` (which owns persistence into the shared
 * `pi/auth.json` and token rotation thereafter). The browser only ever sees
 * the provider's authorize URL or device code — never tokens.
 *
 * Provider ids come from pi-ai's own OAuth registry (`getOAuthProviders`),
 * so serve stays in lockstep with what Pi can actually authenticate
 * (anthropic, openai-codex, github-copilot, …) without hardcoding.
 */
// TODO(upstream): Anthropic logins end on pi's own callback server with a
// Pi-branded success page (`oauthSuccessHtml` in pi-ai's anthropic flow;
// redirect_uri is hardcoded to localhost:53692). A `successRedirectUrl`
// option upstream would let us bounce the tab back to the Console like the
// Codex device-code flow does. Tracked here instead of vendoring the PKCE
// flow into serve.
import { randomUUID } from 'node:crypto';

import { getOAuthProviders } from '@earendil-works/pi-ai/oauth';
import { AuthStorage } from '@earendil-works/pi-coding-agent';

const LOGIN_TTL_MS = 10 * 60 * 1000;
/** How long `start()` waits for the flow to surface a URL / device code. */
const START_INFO_TIMEOUT_MS = 5_000;

export class ServeSubscriptionError extends Error {
  override name = 'ServeSubscriptionError';
  constructor(
    readonly code:
      | 'provider_unknown'
      | 'login_not_found'
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
}

interface PendingLogin extends SubscriptionLoginView {
  operationId: string;
  startedAt: number;
  infoArrived: () => void;
  abort: AbortController;
  invalidated: boolean;
  previousCredential: ReturnType<AuthStorage['get']>;
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
  /** Overridable for focused lifecycle tests. */
  authStorage?: AuthStorage;
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
  private readonly authStorage: AuthStorage;
  private readonly logger: ProviderLoginLogger;

  constructor(private readonly options: ProviderLoginServiceOptions) {
    this.authStorage =
      options.authStorage ?? AuthStorage.create(this.options.authPath);
    this.logger = options.logger ?? silentLogger;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private providers(): { id: string; name: string }[] {
    return (
      this.options.listProviders?.() ??
      getOAuthProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
      }))
    );
  }

  private connected(providerId: string): boolean {
    if (this.options.isConnected) return this.options.isConnected(providerId);
    try {
      // Read a fresh instance so the status proves the credential reached
      // auth.json rather than merely existing in AuthStorage's memory.
      const storage = this.options.authStorage
        ? this.authStorage
        : AuthStorage.create(this.options.authPath);
      return storage.getAuthStatus(providerId).configured;
    } catch (error) {
      this.logger.warn(
        {
          event: 'serve.subscription_auth_read_failed',
          providerId,
          ...safeLoginError(error),
        },
        'Could not read subscription authentication state',
      );
      return false;
    }
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
        this.invalidate(login, 'expired');
        this.logins.delete(id);
      }
    }
  }

  private restoreCredential(login: PendingLogin): void {
    try {
      if (login.previousCredential) {
        this.authStorage.set(login.providerId, login.previousCredential);
      } else {
        this.authStorage.logout(login.providerId);
      }
    } catch (error) {
      this.logger.error(
        {
          event: 'serve.subscription_login_cleanup_failed',
          operationId: login.operationId,
          providerId: login.providerId,
          ...safeLoginError(error),
        },
        'Could not restore subscription credentials after an invalidated login',
      );
    }
  }

  private invalidate(
    login: PendingLogin,
    transition: 'cancelled' | 'expired' | 'shutdown',
  ): void {
    if (login.invalidated) return;
    login.invalidated = true;
    login.abort.abort(new Error(`subscription login ${transition}`));
    this.restoreCredential(login);
    login.infoArrived();
    this.logger.info(
      {
        event: 'serve.subscription_login_transition',
        operationId: login.operationId,
        providerId: login.providerId,
        transition,
      },
      'Subscription login invalidated',
    );
  }

  status(providerId: string): SubscriptionLoginView {
    this.sweep();
    const login = this.logins.get(providerId);
    if (!login) {
      throw new ServeSubscriptionError(
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
      throw new ServeSubscriptionError(
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
      previousCredential: this.authStorage.get(providerId),
    };
    this.logins.set(providerId, login);
    this.logger.info(
      {
        event: 'serve.subscription_login_transition',
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
        this.authStorage.login(
          id,
          // AuthStorage's callback contract is a superset of ours.
          loginCallbacks as Parameters<AuthStorage['login']>[1],
        ));

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
              event: 'serve.subscription_login_transition',
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
              event: 'serve.subscription_login_transition',
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
            event: 'serve.subscription_login_transition',
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

    await Promise.race([
      infoPromise,
      new Promise<void>((resolvePromise) => {
        const timer = setTimeout(resolvePromise, START_INFO_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    return snapshot(login);
  }

  /** Abort an in-flight login and forget it. */
  cancel(providerId: string): { providerId: string; status: 'cancelled' } {
    const login = this.logins.get(providerId);
    if (!login) {
      throw new ServeSubscriptionError(
        'login_not_found',
        `no login in progress for "${providerId}"`,
      );
    }
    this.invalidate(login, 'cancelled');
    this.logins.delete(providerId);
    return { providerId, status: 'cancelled' };
  }

  /** Abort every pending flow during supervisor shutdown. */
  close(): void {
    for (const login of this.logins.values()) {
      this.invalidate(login, 'shutdown');
    }
    this.logins.clear();
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
          event: 'serve.subscription_login_transition',
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
          event: 'serve.subscription_login_transition',
          operationId: login.operationId,
          providerId: login.providerId,
          transition: 'device_code_ready',
        },
        'Subscription device code ready',
      );
      login.infoArrived();
    },
    // Serve has no interactive terminal: any flow demanding a typed
    // answer fails closed with an actionable message instead of hanging.
    onPrompt: () =>
      Promise.reject(
        new ServeSubscriptionError(
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
  if (error instanceof ServeSubscriptionError) return error.message;
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
  } = login;
  return {
    providerId,
    status,
    ...(authUrl ? { authUrl } : {}),
    ...(instructions ? { instructions } : {}),
    ...(userCode ? { userCode } : {}),
    ...(verificationUri ? { verificationUri } : {}),
    ...(error ? { error } : {}),
  };
}
