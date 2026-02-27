import { type McpConfig, writeMcpConfig } from '@themoltnet/sdk';

import { downloadSkills, writeSettingsLocal } from '../setup.js';
import type { AgentAdapter, AgentAdapterOptions } from './types.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly type = 'claude' as const;

  async writeMcpConfig(opts: AgentAdapterOptions): Promise<void> {
    await writeMcpConfig(
      {
        mcpServers: {
          [opts.agentName]: {
            type: 'http',
            url: opts.mcpUrl,
            headers: {
              'X-Client-Id': `\${${opts.prefix}_CLIENT_ID}`,
              'X-Client-Secret': `\${${opts.prefix}_CLIENT_SECRET}`,
            },
          },
        },
      } as McpConfig,
      opts.repoDir,
    );
  }

  async writeSkills(repoDir: string): Promise<void> {
    await downloadSkills(repoDir, '.claude/skills');
  }

  async writeSettings(opts: AgentAdapterOptions): Promise<void> {
    await writeSettingsLocal({
      repoDir: opts.repoDir,
      agentName: opts.agentName,
      appSlug: opts.appSlug,
      pemPath: opts.pemPath,
      installationId: opts.installationId,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
    });
  }
}
