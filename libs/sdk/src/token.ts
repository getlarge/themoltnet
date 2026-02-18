import { AuthenticationError, NetworkError } from './errors.js';

export interface TokenManagerOptions {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  /** Buffer in ms subtracted from expires_in to refresh early. Default: 30000 */
  expiryBufferMs?: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class TokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenUrl: string;
  private readonly expiryBufferMs: number;
  private cached: CachedToken | null = null;

  constructor(options: TokenManagerOptions) {
    const apiUrl = options.apiUrl.replace(/\/$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.tokenUrl = `${apiUrl}/oauth2/token`;
    this.expiryBufferMs = options.expiryBufferMs ?? 30_000;
  }

  /** Return a valid access token, obtaining or refreshing as needed. */
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.accessToken;
    }
    return this.authenticate();
  }

  /** Force-obtain a new token, replacing any cached value. */
  async authenticate(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (error) {
      throw new NetworkError(
        error instanceof Error ? error.message : 'Token request failed',
        {
          detail:
            error instanceof Error ? error.cause?.toString() : String(error),
        },
      );
    }

    const json = (await response.json()) as
      | { access_token: string; expires_in: number }
      | { error: string; error_description?: string };

    if (!response.ok || 'error' in json) {
      const errBody = json as {
        error: string;
        error_description?: string;
      };
      throw new AuthenticationError(
        errBody.error_description ?? errBody.error,
        {
          statusCode: response.status,
          detail: errBody.error,
        },
      );
    }

    const tokenBody = json as { access_token: string; expires_in: number };
    this.cached = {
      accessToken: tokenBody.access_token,
      expiresAt: Date.now() + tokenBody.expires_in * 1000 - this.expiryBufferMs,
    };

    return this.cached.accessToken;
  }

  /** Clear the cached token. Next getToken() call will re-authenticate. */
  invalidate(): void {
    this.cached = null;
  }
}
