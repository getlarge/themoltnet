import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { createDatabase } from '@moltnet/database';
import {
  Configuration,
  CreateIdentityBodyFromJSON,
  type GetIdentityIncludeCredentialEnum,
  type Identity,
  IdentityApi,
  type Relationship,
  RelationshipApi,
} from '@ory/client-fetch';

const credentialTypes: GetIdentityIncludeCredentialEnum[] = [
  'password',
  'oidc',
  'totp',
  'passkey',
  'webauthn',
  'lookup_secret',
  'saml',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function requireThat(condition: unknown): asserts condition {
  if (!condition) throw new Error('Transfer precondition failed');
}

// Rehearsal may copy a moving permission snapshot, never changing identities.
export function verifySourceStability(
  identitiesUnchanged: boolean,
  permissionsUnchanged: boolean,
  rehearsal = false,
) {
  requireThat(identitiesUnchanged && (permissionsUnchanged || rehearsal));
  return identitiesUnchanged && permissionsUnchanged;
}

export interface Principal {
  kind: 'agent' | 'human';
  id: string;
  identity_id: string | null;
  public_key: string | null;
}

// No email matching, missing-identity cleanup, or changes to durable IDs/keys.
export function planBindings(identities: Identity[], principals: Principal[]) {
  const byId = new Map(identities.map((identity) => [identity.id, identity]));
  requireThat(byId.size === identities.length);
  const used = new Set<string>();
  const bindings: Principal[] = [];
  for (const principal of principals) {
    requireThat(uuid.test(principal.id));
    if (!principal.identity_id) continue;
    const identity = byId.get(principal.identity_id);
    if (!identity) continue; // Preserve an existing stale binding unchanged.
    requireThat(!used.has(identity.id));
    used.add(identity.id);
    const traits = identity.traits as { public_key?: string };
    requireThat(
      principal.kind === 'agent'
        ? traits.public_key === principal.public_key &&
            Boolean(principal.public_key)
        : !traits.public_key,
    );
    bindings.push(principal);
  }
  return {
    bindings,
    unbound: principals.filter((principal) => !principal.identity_id).length,
    stale: principals.filter(
      (principal) => principal.identity_id && !byId.has(principal.identity_id),
    ).length,
    orphanIdentities: identities.length - used.size,
  };
}

export function importIdentity(identity: Identity, reenroll: boolean) {
  const configs = Object.fromEntries(
    Object.entries(identity.credentials ?? {}).map(([type, credential]) => [
      type,
      credential.config as Record<string, unknown> | undefined,
    ]),
  );
  const unsupported = [
    'totp',
    'passkey',
    'webauthn',
    'lookup_secret',
    'saml',
  ].filter((type) => Object.keys(configs[type] ?? {}).length > 0);
  requireThat(reenroll || unsupported.length === 0);
  const password = configs.password?.hashed_password;
  const providers = configs.oidc?.providers as
    { provider: string; subject: string }[] | undefined;
  return CreateIdentityBodyFromJSON({
    schema_id: identity.schema_id,
    traits: identity.traits,
    state: unsupported.length ? 'inactive' : identity.state,
    external_id: identity.external_id,
    metadata_admin: identity.metadata_admin ?? {},
    metadata_public: identity.metadata_public ?? {},
    verifiable_addresses: (identity.verifiable_addresses ?? []).map(
      ({ value, via, verified, status }) => ({ value, via, verified, status }),
    ),
    recovery_addresses: (identity.recovery_addresses ?? []).map(
      ({ value, via }) => ({ value, via }),
    ),
    credentials: {
      ...(password
        ? { password: { config: { hashed_password: password } } }
        : {}),
      ...(providers?.length
        ? {
            oidc: {
              config: {
                providers: providers.map(({ provider, subject }) => ({
                  provider,
                  subject,
                })),
              },
            },
          }
        : {}),
    },
  });
}

function configuration(basePath: string, source = false, accessToken?: string) {
  const base = new URL(basePath);
  requireThat(
    !base.username &&
      !base.password &&
      !base.search &&
      !base.hash &&
      base.pathname === '/',
  );
  requireThat(
    source
      ? base.protocol === 'https:' &&
          base.hostname.endsWith('.projects.oryapis.com')
      : base.protocol === 'http:' &&
          ['127.0.0.1', '[::1]'].includes(base.hostname),
  );
  return new Configuration({
    basePath: base.origin,
    accessToken,
    fetchApi: (input, init) => {
      requireThat(new URL(String(input)).origin === base.origin);
      requireThat(!source || (init?.method ?? 'GET') === 'GET');
      return fetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    },
  });
}

async function identities(api: IdentityApi) {
  const result: Identity[] = [];
  const tokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    const response = await api.listIdentitiesRaw({
      pageSize: 250,
      pageToken,
      includeCredential: credentialTypes,
    });
    result.push(...(await response.value()));
    const next = /<([^>]+)>;\s*rel="?next"?/u.exec(
      response.raw.headers.get('link') ?? '',
    );
    if (!next) break;
    pageToken =
      new URL(next[1], 'http://localhost').searchParams.get('page_token') ??
      undefined;
    requireThat(pageToken && !tokens.has(pageToken));
    tokens.add(pageToken);
  } while (tokens.size < 1000);
  requireThat(
    tokens.size < 1000 &&
      new Set(result.map((identity) => identity.id)).size === result.length,
  );
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function relationships(api: RelationshipApi) {
  const result = new Map<string, Relationship>();
  const tokens = new Set<string>();
  let pageToken: string | undefined;
  do {
    const response = await api.getRelationships({ pageSize: 1000, pageToken });
    for (const tuple of response.relation_tuples ?? []) {
      const key = JSON.stringify([
        tuple.namespace,
        tuple.object,
        tuple.relation,
        tuple.subject_id ?? null,
        tuple.subject_set?.namespace ?? null,
        tuple.subject_set?.object ?? null,
        tuple.subject_set?.relation ?? null,
      ]);
      result.set(key, tuple);
    }
    pageToken = response.next_page_token;
    if (!pageToken) break;
    requireThat(!tokens.has(pageToken));
    tokens.add(pageToken);
  } while (tokens.size < 10000);
  requireThat(tokens.size < 10000);
  return result;
}

const noOtherClients = `SELECT count(*)::int AS count FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;
const print = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);

const principalQuery = `SELECT 'agent' AS kind, id::text, identity_id::text, public_key FROM agents
  UNION ALL SELECT 'human' AS kind, id::text, identity_id::text, NULL AS public_key FROM humans ORDER BY kind, id`;

async function main() {
  let phase = 'input';
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const args = process.argv.slice(2);
    requireThat(
      args.every((arg) =>
        ['--apply', '--reenroll-mfa', '--rehearsal'].includes(arg),
      ),
    );
    let input = '';
    for await (const chunk of process.stdin) {
      input += String(chunk);
      requireThat(input.length < 65536);
    }
    const config = JSON.parse(input) as {
      sourceUrl: string;
      sourceToken: string;
      kratosAdminUrl: string;
      kratosPublicUrl: string;
      ketoReadUrl: string;
      ketoWriteUrl: string;
      databaseUrl: string;
      databaseSystemId: string;
      databaseName: string;
    };
    requireThat(
      typeof config.sourceToken === 'string' && config.sourceToken.length > 0,
    );
    const sourceConfig = configuration(
      config.sourceUrl,
      true,
      config.sourceToken,
    );
    const source = new IdentityApi(sourceConfig);
    const sourceKeto = new RelationshipApi(sourceConfig);
    const target = new IdentityApi(configuration(config.kratosAdminUrl));
    const targetSchemas = new IdentityApi(
      configuration(config.kratosPublicUrl),
    );
    const targetKeto = new RelationshipApi(configuration(config.ketoReadUrl));
    const targetKetoWrite = new RelationshipApi(
      configuration(config.ketoWriteUrl),
    );
    const databaseUrl = new URL(config.databaseUrl);
    requireThat(
      ['postgres:', 'postgresql:'].includes(databaseUrl.protocol) &&
        ['127.0.0.1', '[::1]'].includes(databaseUrl.hostname) &&
        !databaseUrl.hash &&
        [...databaseUrl.searchParams].every(
          ([name, value]) => name === 'sslmode' && value === 'disable',
        ),
    );
    requireThat(
      /^\d+$/u.test(config.databaseSystemId) && Boolean(config.databaseName),
    );
    connection = createDatabase(config.databaseUrl);
    connection.pool.on('error', () => {
      process.stderr.write(
        'Transfer database connection failed; details suppressed\n',
      );
    });
    phase = 'target-database';
    const database = (
      await connection.pool.query(
        'SELECT system_identifier::text AS system_id, current_database() AS name FROM pg_control_system()',
      )
    ).rows[0];
    requireThat(
      database?.system_id === config.databaseSystemId &&
        database?.name === config.databaseName,
    );
    phase = 'preflight';
    const [original, tuples, targetIdentities, targetTuples, principals] =
      await Promise.all([
        identities(source),
        relationships(sourceKeto),
        identities(target),
        relationships(targetKeto),
        connection.pool.query<Principal>(principalQuery),
      ]);
    requireThat(
      original.length > 0 &&
        targetIdentities.length === 0 &&
        targetTuples.size === 0,
    );
    phase = 'identity-schemas';
    for (const id of new Set(original.map((identity) => identity.schema_id))) {
      const [from, to] = await Promise.all([
        source.getIdentitySchema({ id }),
        targetSchemas.getIdentitySchema({ id }),
      ]);
      requireThat(isDeepStrictEqual(from, to));
    }
    phase = 'application-bindings';
    const plan = planBindings(original, principals.rows);
    phase = 'credential-compatibility';
    const bodies = original.map((identity) =>
      importIdentity(identity, args.includes('--reenroll-mfa')),
    );
    phase = 'permission-identifiers';
    const durableIds = new Set(
      principals.rows.map((principal) => principal.id),
    );
    const sourceIds = new Set(
      original
        .map((identity) => identity.id)
        .filter((id) => !durableIds.has(id)),
    );
    for (const tuple of tuples.values()) {
      requireThat(!sourceIds.has(tuple.subject_id ?? ''));
      requireThat(
        !(
          ['Agent', 'Human'].includes(tuple.subject_set?.namespace ?? '') &&
          sourceIds.has(tuple.subject_set?.object ?? '')
        ),
      );
      requireThat(
        !(
          ['Agent', 'Human'].includes(tuple.namespace) &&
          sourceIds.has(tuple.object)
        ),
      );
    }
    const summary = {
      identities: original.length,
      tuples: tuples.size,
      bindings: plan.bindings.length,
      unchangedUnbound: plan.unbound,
      unchangedStale: plan.stale,
      orphanIdentities: plan.orphanIdentities,
      blockedForReenrollment: bodies.filter(
        (body, index) =>
          body.state === 'inactive' && original[index].state !== 'inactive',
      ).length,
    };
    if (!args.includes('--apply')) {
      print({ mode: 'plan', ...summary });
      return;
    }
    phase = 'target-quarantine';
    requireThat(
      (await connection.pool.query(noOtherClients)).rows[0].count === 0,
    );
    phase = 'import-identities';
    const mapping = new Map<string, string>();
    for (const [index, identity] of original.entries()) {
      const created = await target.createIdentity({
        createIdentityBody: bodies[index],
      });
      requireThat(uuid.test(created.id));
      const readback = await target.getIdentity({
        id: created.id,
        includeCredential: credentialTypes,
      });
      requireThat(
        isDeepStrictEqual(importIdentity(readback, false), bodies[index]),
      );
      mapping.set(identity.id, created.id);
    }
    phase = 'import-permissions';
    const batch = [...tuples.values()];
    for (let offset = 0; offset < batch.length; offset += 100) {
      await targetKetoWrite.patchRelationships({
        relationshipPatch: batch
          .slice(offset, offset + 100)
          .map((relation_tuple) => ({ action: 'insert', relation_tuple })),
      });
    }
    phase = 'verify-copy';
    const [copiedTuples, currentSource, currentTuples] = await Promise.all([
      relationships(targetKeto),
      identities(source),
      relationships(sourceKeto),
    ]);
    requireThat(
      isDeepStrictEqual(
        [...copiedTuples.keys()].sort(),
        [...tuples.keys()].sort(),
      ),
    );
    const sourceUnchanged = verifySourceStability(
      isDeepStrictEqual(currentSource, original),
      isDeepStrictEqual(
        [...currentTuples.keys()].sort(),
        [...tuples.keys()].sort(),
      ),
      args.includes('--rehearsal'),
    );
    requireThat((await identities(target)).length === original.length);
    phase = 'rebind';
    const client = await connection.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(
        'LOCK TABLE agents, humans IN SHARE ROW EXCLUSIVE MODE',
      );
      requireThat(
        isDeepStrictEqual(
          (await client.query<Principal>(principalQuery)).rows,
          principals.rows,
        ),
      );
      requireThat((await client.query(noOtherClients)).rows[0].count === 0);
      for (const binding of plan.bindings) {
        const replacement = mapping.get(binding.identity_id ?? '');
        requireThat(replacement);
        const result =
          binding.kind === 'agent'
            ? await client.query(
                'UPDATE agents SET identity_id = $1 WHERE id = $2 AND identity_id = $3 AND public_key = $4',
                [
                  replacement,
                  binding.id,
                  binding.identity_id,
                  binding.public_key,
                ],
              )
            : await client.query(
                'UPDATE humans SET identity_id = $1 WHERE id = $2 AND identity_id = $3',
                [replacement, binding.id, binding.identity_id],
              );
        requireThat(result.rowCount === 1);
      }
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      throw new Error('Relink failed');
    } finally {
      client.release();
    }
    print({
      mode: 'applied',
      sourceUnchanged,
      rehearsal: args.includes('--rehearsal'),
      admissionRequired: true,
      ...summary,
    });
  } catch {
    print({
      failed: true,
      phase,
      detailsSuppressed: true,
      keepTargetQuarantined: true,
    });
    process.exitCode = 1;
  } finally {
    try {
      await connection?.pool.end();
    } catch {
      print({ failed: true, phase: 'close-database', detailsSuppressed: true });
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
