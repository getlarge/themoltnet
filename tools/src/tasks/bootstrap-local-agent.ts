#!/usr/bin/env -S npx tsx
/**
 * bootstrap-local-agent — provision a throwaway agent against the local stack.
 *
 * Bypasses the voucher system (uses the same path as the genesis bootstrap)
 * and writes the resulting agent into `.moltnet/<name>/` in the canonical
 * shape so the SDK, agent-daemon, and `tools/src/tasks/create-task.ts` can
 * all use it via `--agent <name>`.
 *
 * No GitHub App is registered: this agent is for local API testing only,
 * not for `gh` operations.
 *
 * Usage:
 *   pnpm task:bootstrap-local --name local-dev
 *   pnpm task:bootstrap-local --name local-dev --force          # overwrite
 *   pnpm task:bootstrap-local --name local-dev --api-url http://localhost:8000
 *
 * Prerequisites:
 *   - Local stack running: `docker compose --env-file .env.local up -d`
 *   - `.env.local` sourced (or env vars exported) so DATABASE_URL and
 *     ORY_*_URL point at the local stack.
 *
 * Output: prints the agent dir path, team id, diary id, and the env vars
 * to source for daemon / create-task commands.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { bootstrapGenesisAgents } from '@moltnet/bootstrap';
import { createDatabase } from '@moltnet/database';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', short: 'n' },
    'api-url': { type: 'string', default: 'http://localhost:8000' },
    'mcp-url': { type: 'string', default: 'http://localhost:8000/mcp' },
    'repo-root': { type: 'string' },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || !args.name) {
  console.error(
    [
      'Usage: pnpm task:bootstrap-local --name <agent-name> [--api-url <url>] [--force]',
      '',
      'Provisions a throwaway agent against the local stack and writes',
      '.moltnet/<name>/ in the canonical shape. No GitHub App is created.',
      '',
      'Required env (sourced from .env.local in normal use):',
      '  DATABASE_URL',
      '  ORY_KRATOS_ADMIN_URL  ORY_HYDRA_ADMIN_URL  ORY_HYDRA_PUBLIC_URL',
      '  ORY_KETO_READ_URL     ORY_KETO_WRITE_URL',
    ].join('\n'),
  );
  process.exit(args.help ? 0 : 1);
}

const agentName = args.name!;
if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
  console.error(`Invalid --name "${agentName}": must match /^[a-zA-Z0-9_-]+$/`);
  process.exit(1);
}

const apiUrl = args['api-url']!.replace(/\/$/, '');
const mcpUrl = args['mcp-url']!;
const force = args.force!;

function repoRoot(): string {
  if (args['repo-root']) return resolve(args['repo-root']);
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing required env var ${name}. Source .env.local first (e.g. \`set -a; source .env.local; set +a\`).`,
    );
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const agentDir = join(root, '.moltnet', agentName);
  const moltnetJsonPath = join(agentDir, 'moltnet.json');

  // Pre-flight: refuse to overwrite an existing agent unless --force.
  if (existsSync(moltnetJsonPath) && !force) {
    console.error(
      `Agent dir already exists: ${agentDir}\nPass --force to overwrite.`,
    );
    process.exit(1);
  }

  const databaseUrl = requireEnv('DATABASE_URL');
  const kratosAdminUrl = requireEnv('ORY_KRATOS_ADMIN_URL');
  const hydraAdminUrl = requireEnv('ORY_HYDRA_ADMIN_URL');
  const hydraPublicUrl = requireEnv('ORY_HYDRA_PUBLIC_URL');
  const ketoReadUrl = requireEnv('ORY_KETO_READ_URL');
  // Keto write defaults to the admin port if a dedicated WRITE url isn't set.
  const ketoWriteUrl = process.env.ORY_KETO_WRITE_URL ?? ketoReadUrl;

  console.error(`[bootstrap-local] target API: ${apiUrl}`);
  console.error(`[bootstrap-local] agent dir: ${agentDir}`);

  // Genesis bootstrap — Ed25519 keypair, Ory identity, OAuth2 client,
  // personal team + private diary, Keto tuples.
  const { db, pool } = createDatabase(databaseUrl);
  const result = await bootstrapGenesisAgents({
    config: {
      databaseUrl,
      ory: {
        mode: 'split',
        kratosAdminUrl,
        hydraAdminUrl,
        hydraPublicUrl,
        ketoReadUrl,
        ketoWriteUrl,
      },
    },
    db,
    names: [agentName],
    scopes: 'diary:read diary:write crypto:sign agent:profile',
    log: (m) => console.error(`  ${m}`),
  }).finally(() => pool.end());

  if (result.errors.length > 0) {
    console.error('[bootstrap-local] errors:');
    for (const e of result.errors) {
      console.error(`  ${e.name}: ${e.error}`);
    }
    process.exit(1);
  }
  if (result.agents.length !== 1) {
    console.error(
      `[bootstrap-local] expected 1 agent, got ${result.agents.length}`,
    );
    process.exit(1);
  }

  const agent = result.agents[0];

  // Materialise .moltnet/<name>/ on disk.
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, 'ssh'), { recursive: true, mode: 0o700 });

  // SSH keypair for git commit signing. Use ssh-keygen so the format is
  // exactly what git expects.
  const sshPriv = join(agentDir, 'ssh', 'id_ed25519');
  const sshPub = `${sshPriv}.pub`;
  execFileSync(
    'ssh-keygen',
    ['-t', 'ed25519', '-N', '', '-C', `${agentName}@local`, '-f', sshPriv],
    { stdio: 'pipe' },
  );

  const sshPubContent = execFileSync('cat', [sshPub], { encoding: 'utf8' });
  const allowedSigners = `${agentName}@local ${sshPubContent.trim()}\n`;
  writeFileSync(join(agentDir, 'ssh', 'allowed_signers'), allowedSigners, {
    mode: 0o644,
  });

  // gitconfig — same shape as production agents, minus GitHub-specific bits.
  const gitconfig = [
    '[user]',
    `\tname = ${agentName}`,
    `\temail = ${agentName}@local.invalid`,
    `\tsigningKey = ${sshPriv}`,
    '[gpg]',
    '\tformat = ssh',
    '[gpg "ssh"]',
    `\tsigningKey = ${sshPriv}`,
    `\tallowedSignersFile = ${join(agentDir, 'ssh', 'allowed_signers')}`,
    '[commit]',
    '\tgpgsign = true',
    '',
  ].join('\n');
  writeFileSync(join(agentDir, 'gitconfig'), gitconfig, { mode: 0o644 });

  // moltnet.json — canonical SDK config. NOTE: no `github` block; this
  // agent has no GitHub App. The daemon path doesn't need one for tasks
  // that don't touch GitHub.
  const moltnetJson = {
    identity_id: agent.identityId,
    oauth2: {
      client_id: agent.clientId,
      client_secret: agent.clientSecret,
    },
    keys: {
      public_key: agent.keyPair.publicKey,
      private_key: agent.keyPair.privateKey,
      fingerprint: agent.keyPair.fingerprint,
    },
    endpoints: { api: apiUrl, mcp: mcpUrl },
    registered_at: new Date().toISOString(),
    ssh: {
      private_key_path: sshPriv,
      public_key_path: sshPub,
    },
    git: {
      name: agentName,
      email: `${agentName}@local.invalid`,
      signing: true,
      config_path: join(agentDir, 'gitconfig'),
    },
    profile: { local: true },
  };
  writeFileSync(moltnetJsonPath, JSON.stringify(moltnetJson, null, 2) + '\n', {
    mode: 0o600,
  });

  // env file — convenience for shell sourcing.
  const envContent = [
    `MOLTNET_AGENT_NAME='${agentName}'`,
    `MOLTNET_TEAM_ID='${agent.personalTeamId}'`,
    `MOLTNET_DIARY_ID='${agent.privateDiaryId}'`,
    `MOLTNET_API_URL='${apiUrl}'`,
    `GIT_CONFIG_GLOBAL='${join(agentDir, 'gitconfig')}'`,
    '',
  ].join('\n');
  writeFileSync(join(agentDir, 'env'), envContent, { mode: 0o644 });

  // Done — report.
  console.log(
    JSON.stringify(
      {
        agentName,
        agentDir,
        identityId: agent.identityId,
        teamId: agent.personalTeamId,
        diaryId: agent.privateDiaryId,
        apiUrl,
      },
      null,
      2,
    ),
  );

  console.error('');
  console.error('[bootstrap-local] done. Try:');
  console.error(`  source ${join(agentDir, 'env')}`);
  console.error(
    `  pnpm exec tsx tools/src/tasks/create-task.ts \\\n    --agent ${agentName} \\\n    --task-file demo/tasks/api/fulfill-brief.create.template.json \\\n    --set diaryId=${agent.privateDiaryId} \\\n    --set teamId=${agent.personalTeamId}`,
  );
  console.error(
    `  pnpm exec agent-daemon poll --agent ${agentName} --team ${agent.personalTeamId} --provider anthropic --model claude-sonnet-4-6`,
  );
}

main().catch((err) => {
  console.error(
    '[fatal]',
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  process.exit(1);
});
