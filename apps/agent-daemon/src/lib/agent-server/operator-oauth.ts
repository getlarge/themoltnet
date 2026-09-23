import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { isLoopbackHostname } from '@moltnet/loopback-companion';
import { OPERATOR_OAUTH } from '@moltnet/models';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export class InvalidOperatorGrantError extends Error {}

const LOCAL_SCOPE = OPERATOR_OAUTH.localControlScope;
export interface OperatorOAuthConfig {
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  nativeClientId: string;
  callbackPort: number;
}
export interface NativeProvisioning {
  agentId: string;
  teamId: string;
  operation: 'enroll' | 'renew';
  scopes: string[];
  idempotencyKey: string;
}
export interface OperatorTeam {
  id: string;
  name: string;
}
function readOperatorTeams(value: unknown): OperatorTeam[] {
  if (!Array.isArray(value) || value.length > 256) return [];
  const teams: unknown[] = value;
  if (!teams.every(isOperatorTeam)) return [];
  return teams.map(({ id, name }) => ({ id, name }));
}
function isOperatorTeam(value: unknown): value is OperatorTeam {
  if (!value || typeof value !== 'object') return false;
  const team = value as Record<string, unknown>;
  return (
    typeof team['id'] === 'string' &&
    /^[0-9a-f-]{36}$/i.test(team['id']) &&
    typeof team['name'] === 'string' &&
    team['name'].length > 0 &&
    team['name'].length <= 200
  );
}
/** Trusted native controller owns the verifier, callback and token exchange. */
export class OperatorOAuth {
  readonly instance = randomUUID();
  private readonly keys;
  private active = false;
  private pending?: AbortController;
  private operator: {
    issuer: string;
    subject: string;
    teams: OperatorTeam[];
  } | null;
  constructor(
    readonly config: OperatorOAuthConfig,
    private readonly root: string,
    private readonly openBrowser: (url: string) => void | Promise<void> = (
      url,
    ) => {
      const command =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'explorer.exe'
            : 'xdg-open';
      return new Promise<void>((resolve, reject) => {
        execFile(command, [url], (error) => {
          if (error) reject(new Error('Could not open browser approval'));
          else resolve();
        });
      });
    },
  ) {
    const endpoints = [
      config.authorizationUrl,
      config.tokenUrl,
      config.jwksUrl,
    ].map((value) => new URL(value));
    if (
      endpoints.some(
        (url) =>
          url.username ||
          url.password ||
          url.hash ||
          (url.protocol !== 'https:' &&
            !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))),
      ) ||
      endpoints.some((url) => url.origin !== endpoints[0].origin)
    )
      throw new Error('OAuth endpoints must share a trusted secure origin');
    this.keys = createRemoteJWKSet(new URL(config.jwksUrl));
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(root, 'operator.json'), 'utf8'),
      );
      if (
        !value ||
        typeof value !== 'object' ||
        !('issuer' in value) ||
        !('subject' in value) ||
        typeof value.issuer !== 'string' ||
        typeof value.subject !== 'string'
      )
        throw new Error('Invalid operator');
      this.operator = {
        issuer: value.issuer,
        subject: value.subject,
        teams: 'teams' in value ? readOperatorTeams(value.teams) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.operator = null;
    }
  }
  cancel() {
    this.pending?.abort();
  }
  operatorConfigured(): boolean {
    return this.operator !== null;
  }
  listTeams(): OperatorTeam[] {
    return this.operator?.teams ?? [];
  }
  removeOperator() {
    this.cancel();
    rmSync(join(this.root, 'operator.json'), { force: true });
    this.operator = null;
  }
  private async verify(token: string, scope: string, clientId: string) {
    const { payload } = await jwtVerify(token, this.keys, {
      algorithms: ['RS256'],
      issuer: this.config.issuer,
      audience:
        scope === LOCAL_SCOPE
          ? OPERATOR_OAUTH.localControlAudience
          : OPERATOR_OAUTH.provisioningAudience,
      requiredClaims: ['exp', 'iat', 'sub'],
      // Bound effective authorization by age as well as exp. Hydra records iat
      // before issuance completes, so exp - iat can exceed the configured TTL.
      maxTokenAge: OPERATOR_OAUTH.nativeLifetimeSeconds,
    });
    const claims = payload.ext as Record<string, unknown> | undefined;
    const scopes =
      typeof payload.scope === 'string'
        ? payload.scope.split(' ')
        : payload.scp;
    if (
      !Array.isArray(scopes) ||
      scopes.length !== 1 ||
      scopes[0] !== scope ||
      payload.client_id !== clientId ||
      claims?.['moltnet:subject_type'] !== 'human' ||
      claims['moltnet:identity_id'] !== payload.sub ||
      claims['moltnet:instance'] !== this.instance
    )
      throw new InvalidOperatorGrantError('Invalid operator grant');
    return {
      issuer: payload.iss!,
      subject: payload.sub!,
      provisioning: claims['moltnet:provisioning'],
      teams: readOperatorTeams(claims['moltnet:operator_teams']),
    };
  }
  async authorize(
    grant?: NativeProvisioning,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.active) throw new Error('An approval is already pending');
    this.active = true;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const callback = `http://127.0.0.1:${this.config.callbackPort}/oauth/callback`;
    const scope = grant ? OPERATOR_OAUTH.provisioningScope : LOCAL_SCOPE;
    const controller = new AbortController();
    this.pending = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      OPERATOR_OAUTH.nativeLifetimeSeconds * 1000,
    );
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let server: ReturnType<typeof createServer> | undefined;
    try {
      if (signal?.aborted) throw new Error('Approval cancelled');
      const code = await new Promise<string>((resolve, reject) => {
        let consumed = false;
        server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', callback);
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; frame-ancestors 'none'",
          );
          if (
            req.method !== 'GET' ||
            req.headers.host !== `127.0.0.1:${this.config.callbackPort}` ||
            url.pathname !== '/oauth/callback' ||
            url.searchParams.getAll('state').length !== 1 ||
            url.searchParams.get('state') !== state ||
            consumed
          ) {
            res.writeHead(400);
            res.end('Invalid callback');
            return;
          }
          consumed = true;
          if (
            url.searchParams.has('error') ||
            url.searchParams.getAll('code').length !== 1 ||
            !url.searchParams.get('code')
          ) {
            res.end('Approval cancelled. Return to Desktop.');
            reject(new Error('Approval cancelled'));
            return;
          }
          res.end('Approval received. Return to Desktop.');
          resolve(url.searchParams.get('code')!);
        });
        server.once('error', reject);
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Approval cancelled')),
          { once: true },
        );
        server.listen(this.config.callbackPort, '127.0.0.1', () => {
          const url = new URL(this.config.authorizationUrl);
          for (const [key, value] of Object.entries({
            client_id: this.config.nativeClientId,
            response_type: 'code',
            scope,
            audience: grant
              ? OPERATOR_OAUTH.provisioningAudience
              : OPERATOR_OAUTH.localControlAudience,
            redirect_uri: callback,
            state,
            code_challenge_method: 'S256',
            code_challenge: createHash('sha256')
              .update(verifier)
              .digest('base64url'),
            prompt: 'consent',
            instance: this.instance,
            ...(grant ? { provisioning: JSON.stringify(grant) } : {}),
          }))
            url.searchParams.set(key, value);
          try {
            void Promise.resolve(this.openBrowser(url.href)).catch(() =>
              reject(new Error('Could not open browser approval')),
            );
          } catch {
            reject(new Error('Could not open browser approval'));
          }
        });
      });
      const response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          client_id: this.config.nativeClientId,
          redirect_uri: callback,
        }),
      });
      if (!response.ok)
        throw new Error('Approval exchange lost; request fresh approval');
      const tokens = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!tokens.access_token || tokens.refresh_token)
        throw new Error('Invalid approval token response');
      const operator = await this.verify(
        tokens.access_token,
        scope,
        this.config.nativeClientId,
      );
      controller.signal.throwIfAborted();
      if (grant) {
        const actual = operator.provisioning as NativeProvisioning | undefined;
        if (
          !actual ||
          !Array.isArray(actual.scopes) ||
          !actual.scopes.every((scope) => typeof scope === 'string') ||
          actual.agentId !== grant.agentId ||
          actual.teamId !== grant.teamId ||
          actual.operation !== grant.operation ||
          actual.idempotencyKey !== grant.idempotencyKey ||
          [...actual.scopes].sort().join(' ') !==
            [...grant.scopes].sort().join(' ')
        )
          throw new Error('Approval target differs from native request');
      }
      if (
        this.operator &&
        (this.operator.issuer !== operator.issuer ||
          this.operator.subject !== operator.subject)
      )
        throw new Error(
          'Change the operator through native administration first',
        );
      if (!this.operator) {
        // Exclusive creation prevents competing server processes replacing the operator.
        try {
          writeFileSync(
            join(this.root, 'operator.json'),
            JSON.stringify({
              issuer: operator.issuer,
              subject: operator.subject,
              teams: grant ? [] : operator.teams,
            }),
            { mode: 0o600, flag: 'wx' },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const pinned = JSON.parse(
            readFileSync(join(this.root, 'operator.json'), 'utf8'),
          ) as unknown;
          if (
            !pinned ||
            typeof pinned !== 'object' ||
            !('issuer' in pinned) ||
            !('subject' in pinned) ||
            pinned.issuer !== operator.issuer ||
            pinned.subject !== operator.subject
          )
            throw new Error(
              'Change the operator through native administration first',
            );
        }
        this.operator = {
          issuer: operator.issuer,
          subject: operator.subject,
          teams: grant ? [] : operator.teams,
        };
      } else if (!grant) {
        this.operator.teams = operator.teams;
        writeFileSync(
          join(this.root, 'operator.json'),
          JSON.stringify(this.operator),
          {
            mode: 0o600,
          },
        );
      }
      return tokens.access_token;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      server?.close();
      server?.closeAllConnections();
      this.active = false;
      this.pending = undefined;
    }
  }
}
