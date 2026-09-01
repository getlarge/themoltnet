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
      | 'login_in_progress'
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
  startedAt: number;
  infoArrived: () => void;
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
  now?: () => number;
}

export class ProviderLoginService {
  private readonly logins = new Map<string, PendingLogin>();

  constructor(private readonly options: ProviderLoginServiceOptions) {}

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
      return AuthStorage.create(this.options.authPath).getAuthStatus(providerId)
        .configured;
    } catch {
      return false;
    }
  }

  list(): SubscriptionProviderView[] {
    return this.providers().map((provider) => ({
      ...provider,
      connected: this.connected(provider.id),
    }));
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, login] of this.logins) {
      if (login.startedAt + LOGIN_TTL_MS <= now) this.logins.delete(id);
    }
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
    const login: PendingLogin = {
      providerId,
      status: 'pending',
      startedAt: this.now(),
      infoArrived,
    };
    this.logins.set(providerId, login);

    const callbacks: LoginCallbacksLike = {
      onAuth: (info) => {
        login.authUrl = info.url;
        if (info.instructions) login.instructions = info.instructions;
        login.infoArrived();
      },
      onDeviceCode: (info) => {
        login.userCode = info.userCode;
        login.verificationUri = info.verificationUri;
        login.infoArrived();
      },
      // Serve has no interactive terminal: any flow demanding a typed
      // answer fails closed with a actionable message instead of hanging.
      onPrompt: () =>
        Promise.reject(
          new ServeSubscriptionError(
            'login_unsupported_prompt',
            'This provider flow needs an interactive prompt; run `pi /login` in a terminal instead',
          ),
        ),
      onSelect: () => Promise.resolve(undefined),
    };

    const runLogin =
      this.options.runLogin ??
      ((id: string, loginCallbacks: LoginCallbacksLike) =>
        AuthStorage.create(this.options.authPath).login(
          id,
          // AuthStorage's callback contract is a superset of ours.
          loginCallbacks as Parameters<AuthStorage['login']>[1],
        ));

    const completion = runLogin(providerId, callbacks).then(
      () => {
        login.status = 'completed';
        login.infoArrived();
      },
      (error: unknown) => {
        login.status = 'failed';
        login.error = error instanceof Error ? error.message : 'login failed';
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
