#!/usr/bin/env -S npx tsx
/**
 * Bootstrap Genesis Agents — CLI entrypoint
 *
 * Usage:
 *   pnpm bootstrap --count 3
 *   pnpm bootstrap --count 1 --dry-run
 *   pnpm bootstrap --names "Atlas,Hermes,Prometheus"
 *   pnpm bootstrap --sponsor --dry-run
 *
 * Required environment variables (unless --dry-run):
 *   DATABASE_URL        — Postgres connection string
 *   ORY_PROJECT_URL     — Ory Network project URL (base for all Ory APIs)
 *   ORY_PROJECT_API_KEY  — Ory Network API key (admin access)
 *
 * For split Ory deployments (Docker Compose / E2E), set per-service URLs instead:
 *   ORY_KRATOS_ADMIN_URL, ORY_HYDRA_ADMIN_URL, ORY_HYDRA_PUBLIC_URL,
 *   ORY_KETO_READ_URL, ORY_KETO_WRITE_URL
 *
 * Output:
 *   Credentials JSON to stdout. Redirect to a file and store securely:
 *   pnpm bootstrap --count 3 > genesis-credentials.json
 */

import { parseArgs } from 'node:util';

import {
  type BootstrapConfig,
  bootstrapGenesisAgents,
} from '@moltnet/bootstrap';
import { cryptoService } from '@moltnet/crypto-service';
import { createDatabase } from '@moltnet/database';

// ── CLI Arguments ────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    count: { type: 'string', short: 'c', default: '1' },
    names: { type: 'string', short: 'n' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    scopes: {
      type: 'string',
      short: 's',
      default: 'diary:read diary:write crypto:sign agent:profile',
    },
    sponsor: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: true,
});

if (args.help) {
  console.log(`
Usage: pnpm bootstrap [options]

Options:
  -c, --count <n>       Number of genesis agents to create (default: 1)
  -n, --names <list>    Comma-separated agent names (default: Genesis-1, Genesis-2, ...)
  -s, --scopes <list>   OAuth2 scopes (default: diary:read diary:write crypto:sign agent:profile)
      --dry-run         Generate keypairs only, don't call any APIs
      --sponsor         Create exactly one sponsor agent (mutually exclusive with --count/--names)
  -h, --help            Show this help message

Environment variables (required unless --dry-run):
  DATABASE_URL            Postgres connection string
  ORY_PROJECT_URL         Ory Network project URL (managed mode)
  ORY_PROJECT_API_KEY     Ory Network API key (managed mode)

For split Ory deployments (Docker Compose):
  ORY_KRATOS_ADMIN_URL    Kratos admin API
  ORY_HYDRA_ADMIN_URL     Hydra admin API
  ORY_HYDRA_PUBLIC_URL    Hydra public API (token endpoint)
  ORY_KETO_READ_URL       Keto read API
  ORY_KETO_WRITE_URL      Keto write API
`);
  process.exit(0);
}

if (args.sponsor && (args.count !== '1' || args.names)) {
  console.error('--sponsor is mutually exclusive with --count and --names');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function log(message: string): void {
  process.stderr.write(message + '\n');
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const count = parseInt(args.count!, 10);
  if (isNaN(count) || count < 1 || count > 10) {
    console.error('--count must be between 1 and 10');
    process.exit(1);
  }

  const names = args.names
    ? args.names.split(',').map((n) => n.trim())
    : Array.from({ length: count }, (_, i) => `Genesis-${i + 1}`);

  if (names.length !== count) {
    console.error(
      `--names has ${names.length} entries but --count is ${count}`,
    );
    process.exit(1);
  }

  const scopes = args.scopes!;

  log(`\nMoltNet Genesis Bootstrap`);
  log(`========================`);
  if (args.sponsor) {
    log(`Mode: Sponsor agent`);
  } else {
    log(`Agents to create: ${count}`);
    log(`Names: ${names.join(', ')}`);
  }
  log(`Scopes: ${scopes}`);

  // Dry-run: just generate keypairs
  if (args['dry-run']) {
    log(`\nDRY RUN — generating keypairs only\n`);

    const dryRunNames = args.sponsor ? ['Sponsor'] : names;
    const agentType = args.sponsor ? 'sponsor' : 'genesis';

    const dryRunAgents = await Promise.all(
      dryRunNames.map(async (name) => {
        const keyPair = await cryptoService.generateKeyPair();
        log(`  ${name}: ${keyPair.fingerprint}`);
        log(`    Public key: ${keyPair.publicKey}`);
        return {
          name,
          type: agentType,
          publicKey: keyPair.publicKey,
        };
      }),
    );

    console.log(JSON.stringify(dryRunAgents, null, 2));
    return;
  }

  // Resolve Ory configuration: managed (single URL) or split (per-service URLs)
  const databaseUrl = requireEnv('DATABASE_URL');
  const oryProjectUrl = optionalEnv('ORY_PROJECT_URL');
  const oryApiKey = optionalEnv('ORY_PROJECT_API_KEY');

  let config: BootstrapConfig;

  if (oryProjectUrl) {
    // Managed Ory Network: single project URL for all APIs
    if (!oryApiKey) {
      console.error(
        'ORY_PROJECT_API_KEY is required when using ORY_PROJECT_URL (managed mode)',
      );
      process.exit(1);
    }
    log(`\nMode: Ory Network (managed)`);
    log(`Ory Project: ${oryProjectUrl}`);

    config = {
      databaseUrl,
      ory: {
        mode: 'managed',
        projectUrl: oryProjectUrl,
        apiKey: oryApiKey,
      },
    };
  } else {
    // Split deployment: separate URLs per Ory service (Docker Compose / E2E)
    log(`\nMode: Split Ory deployment (Docker Compose)`);

    config = {
      databaseUrl,
      ory: {
        mode: 'split',
        kratosAdminUrl: requireEnv('ORY_KRATOS_ADMIN_URL'),
        hydraAdminUrl: requireEnv('ORY_HYDRA_ADMIN_URL'),
        hydraPublicUrl: requireEnv('ORY_HYDRA_PUBLIC_URL'),
        ketoReadUrl: requireEnv('ORY_KETO_READ_URL'),
        ketoWriteUrl: requireEnv('ORY_KETO_WRITE_URL'),
      },
    };
  }

  log(`Database: ${databaseUrl.replace(/\/\/[^@]*@/, '//***@')}\n`);

  const { db, pool } = createDatabase(databaseUrl);

  try {
    // Sponsor mode: create a single sponsor agent
    if (args.sponsor) {
      log('Creating sponsor agent...');
      const result = await bootstrapGenesisAgents({
        config,
        db,
        names: ['Sponsor'],
        scopes,
        log,
      });

      if (result.agents.length !== 1) {
        console.error('Failed to create sponsor agent');
        if (result.errors.length > 0) {
          for (const { name, error } of result.errors) {
            console.error(`  ${name}: ${error}`);
          }
        }
        process.exit(1);
      }

      const agent = result.agents[0];

      process.stderr.write(
        `\nSPONSOR_AGENT_ID=${agent.identityId}\n` +
          `\nStore this ID in your .env:\n` +
          `  dotenvx set SPONSOR_AGENT_ID "${agent.identityId}"\n\n` +
          `IMPORTANT: Store the output JSON securely — it contains OAuth2 secrets.\n`,
      );

      console.log(
        JSON.stringify(
          [
            {
              name: agent.name,
              type: 'sponsor',
              identityId: agent.identityId,
              fingerprint: agent.keyPair.fingerprint,
              clientId: agent.clientId,
            },
          ],
          null,
          2,
        ),
      );
      return;
    }

    const result = await bootstrapGenesisAgents({
      config,
      db,
      names,
      scopes,
      log,
    });

    // Output summary to stderr
    log(`\n========================`);
    log(`Created: ${result.agents.length}/${count}`);
    if (result.errors.length > 0) {
      log(`Failed: ${result.errors.length}`);
      for (const { name, error } of result.errors) {
        log(`  ${name}: ${error}`);
      }
    }

    // Output credentials JSON to stdout
    const output = result.agents.map((a) => ({
      name: a.name,
      identityId: a.identityId,
      fingerprint: a.keyPair.fingerprint,
      publicKey: a.keyPair.publicKey,
      privateKey: a.keyPair.privateKey,
      clientId: a.clientId,
      clientSecret: a.clientSecret,
      accessToken: a.accessToken,
    }));

    console.log(JSON.stringify(output, null, 2));

    if (result.agents.length > 0) {
      log(
        `\nIMPORTANT: Store the output JSON securely — it contains private keys and OAuth2 secrets.`,
      );
      log(
        `These genesis agents can now issue vouchers via POST /vouch to onboard others.`,
      );
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
