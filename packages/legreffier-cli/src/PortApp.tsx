import { execSync } from 'node:child_process';
import { basename, join } from 'node:path';

import { CliHero, CliSpinner, cliTheme } from '@themoltnet/design-system/cli';
import { readConfig } from '@themoltnet/sdk';
import { Box, Text, useApp } from 'ink';
import React, { useEffect, useState } from 'react';

import { adapters } from './adapters/index.js';
import type { AgentAdapterOptions } from './adapters/types.js';
import { toErrorMessage } from './api.js';
import { runPortCopyPhase } from './phases/portCopy.js';
import {
  type PortDiaryMode,
  readSourceDiaryId,
  runPortDiaryPhase,
} from './phases/portDiary.js';
import { runPortResolveInstallationPhase } from './phases/portResolveInstallation.js';
import { runPortRewritePhase } from './phases/portRewrite.js';
import {
  type PortValidateResult,
  runPortValidatePhase,
} from './phases/portValidate.js';
import { runPortVerifyInstallationPhase } from './phases/portVerifyInstallation.js';
import { toEnvPrefix } from './setup.js';
import type { AgentType } from './ui/types.js';

export interface PortAppProps {
  name: string;
  agents: AgentType[];
  sourceDir: string;
  targetRepoDir: string;
  diaryMode: PortDiaryMode;
  apiUrl: string;
}

type PortPhase =
  | 'validating'
  | 'copying'
  | 'rewriting'
  | 'resolving_installation'
  | 'diary'
  | 'agent_setup'
  | 'verifying'
  | 'done'
  | 'error';

interface PortSummary {
  agentName: string;
  filesWritten: string[];
  warnings: string[];
  validationIssues: PortValidateResult['issues'];
  diaryMode: PortDiaryMode;
  diaryId: string | null;
  installMessage: string;
  installStatus: 'ok' | 'repo-not-in-scope' | 'warning';
}

/** Read `owner/repo` from `git remote get-url origin`. Returns null on any failure. */
function detectCurrentRepo(repoDir: string): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // Supports both git@github.com:owner/repo.git and https://github.com/owner/repo(.git)
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function PortApp({
  name,
  agents,
  sourceDir,
  targetRepoDir,
  diaryMode,
  apiUrl,
}: PortAppProps) {
  const { exit } = useApp();

  const [phase, setPhase] = useState<PortPhase>('validating');
  const [error, setError] = useState<string>();
  const [summary, setSummary] = useState<PortSummary | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const targetDir = join(targetRepoDir, '.moltnet', name);
        const filesWritten: string[] = [];
        const warnings: string[] = [];

        // P1
        setPhase('validating');
        const { config, issues, canProceed } = await runPortValidatePhase({
          sourceDir,
        });
        if (!canProceed) {
          throw new Error(
            'source .moltnet is not portable: ' +
              issues.map((i) => `${i.field} (${i.problem})`).join(', '),
          );
        }

        // Identity guard: target must match source or be absent.
        const existing = await readConfig(targetDir);
        if (
          existing?.identity_id &&
          existing.identity_id !== config.identity_id
        ) {
          throw new Error(
            `target ${targetDir} already has a different identity_id (${existing.identity_id}); refusing to overwrite`,
          );
        }

        // P2
        setPhase('copying');
        const copyResult = await runPortCopyPhase({
          sourceDir,
          targetDir,
          config,
        });
        filesWritten.push(...copyResult.copied);
        warnings.push(...copyResult.warnings);

        // P3
        setPhase('rewriting');
        const rewriteResult = await runPortRewritePhase({
          targetDir,
          agentName: name,
          config,
        });
        filesWritten.push(rewriteResult.gitConfigPath);
        filesWritten.push(join(targetDir, 'env'));

        // P3b — resolve installation_id for the target owner
        setPhase('resolving_installation');
        const currentRepo = detectCurrentRepo(targetRepoDir);
        const prefix = toEnvPrefix(name);
        const resolveResult = await runPortResolveInstallationPhase({
          targetDir,
          config,
          currentRepo: currentRepo ?? undefined,
          envPrefix: prefix,
        });
        if (
          resolveResult.status === 'not-installed' ||
          resolveResult.status === 'skipped'
        ) {
          warnings.push(resolveResult.message);
        }

        // P4
        setPhase('diary');
        const sourceDiaryId = await readSourceDiaryId(sourceDir);
        const diaryResult = await runPortDiaryPhase({
          targetDir,
          mode: diaryMode,
          sourceDiaryId,
        });

        // Per-agent tool files (claude/codex): skills, settings, rules.
        // Mirror what SetupApp does — reuse adapters directly.
        setPhase('agent_setup');
        const mcpUrl =
          config.endpoints?.mcp ??
          apiUrl.replace('://api.', '://mcp.') + '/mcp';
        const adapterOpts: AgentAdapterOptions = {
          repoDir: targetRepoDir,
          agentName: name,
          prefix,
          mcpUrl,
          clientId: config.oauth2.client_id,
          clientSecret: config.oauth2.client_secret,
          appSlug: config.github?.app_slug ?? '',
          appId: config.github?.app_id ?? '',
          pemPath: join(
            targetDir,
            basename(config.github?.private_key_path ?? ''),
          ),
          installationId: resolveResult.installationId,
        };
        for (const agentType of agents) {
          const adapter = adapters[agentType];
          await adapter.writeMcpConfig(adapterOpts);
          filesWritten.push(`${agentType}: MCP config`);
          await adapter.writeSkills(targetRepoDir);
          filesWritten.push(`${agentType}: skills`);
          await adapter.writeSettings(adapterOpts);
          filesWritten.push(`${agentType}: settings`);
          await adapter.writeRules(adapterOpts);
          filesWritten.push(`${agentType}: gh token rule`);
        }

        // P5 — warning-only. Use the rewritten target config so token
        // minting reads the *copied* PEM and the (possibly updated)
        // installation_id. Fall back to the source config only if the
        // target read somehow fails.
        setPhase('verifying');
        const targetConfig = await readConfig(targetDir);
        const verifyConfig = targetConfig ?? config;
        const verifyResult = await runPortVerifyInstallationPhase({
          config: verifyConfig,
          currentRepo: currentRepo ?? undefined,
        });
        if (verifyResult.status !== 'ok') {
          warnings.push(verifyResult.message);
        }

        setSummary({
          agentName: name,
          filesWritten,
          warnings,
          validationIssues: issues,
          diaryMode,
          diaryId: diaryResult.diaryId,
          installMessage: verifyResult.message,
          installStatus: verifyResult.status,
        });
        setPhase('done');
        setTimeout(() => exit(), 3000);
      } catch (err) {
        setError(toErrorMessage(err));
        setPhase('error');
        setTimeout(() => exit(new Error('Port failed')), 3000);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'error') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <Box
          borderStyle="round"
          borderColor={cliTheme.color.error}
          paddingX={2}
          paddingY={1}
        >
          <Text color={cliTheme.color.error} bold>
            {'* Port failed: ' + (error ?? 'unknown error')}
          </Text>
        </Box>
      </Box>
    );
  }

  if (phase !== 'done') {
    const labels: Record<Exclude<PortPhase, 'done' | 'error'>, string> = {
      validating: `Validating source .moltnet/${name}...`,
      copying: `Copying private material...`,
      rewriting: `Rewriting paths in moltnet.json...`,
      resolving_installation: `Resolving GitHub App installation for target org...`,
      diary: `Configuring diary (${diaryMode})...`,
      agent_setup: `Installing agent files for ${agents.join(', ')}...`,
      verifying: `Verifying GitHub App installation scope...`,
    };
    return (
      <Box flexDirection="column" paddingY={1}>
        <CliHero />
        <CliSpinner label={labels[phase]} />
      </Box>
    );
  }

  // done
  return (
    <Box flexDirection="column" paddingY={1}>
      <CliHero />
      <Box flexDirection="column" marginBottom={1}>
        <Text color={cliTheme.color.success} bold>
          {`Ported ${name} to ${targetRepoDir}`}
        </Text>
        <Text color={cliTheme.color.muted}>
          {`  diary: ${summary?.diaryMode}${
            summary?.diaryId ? ` (${summary.diaryId})` : ''
          }`}
        </Text>
        <Text color={cliTheme.color.muted}>
          {`  installation: ${summary?.installStatus}`}
        </Text>
        {summary?.filesWritten.map((f, i) => (
          <Text key={i} color={cliTheme.color.muted}>
            {'  * ' + f}
          </Text>
        ))}
      </Box>
      {summary && summary.warnings.length > 0 && (
        <Box
          borderStyle="round"
          borderColor={cliTheme.color.warning}
          paddingX={2}
          paddingY={0}
          flexDirection="column"
        >
          <Text color={cliTheme.color.warning} bold>
            Warnings:
          </Text>
          {summary.warnings.map((w, i) => (
            <Text key={i} color={cliTheme.color.warning}>
              {'  ! ' + w}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
