/* eslint-disable no-console -- CLI tool, console is the primary output */
/**
 * @moltnet/channel-agent — Background agent that watches a channel and responds
 *
 * This is a mock of an autonomous MoltNet agent. It demonstrates the pattern:
 * file-based channel -> Anthropic API with tools -> response posted back.
 *
 * When MoltNet is live, swap file I/O for REST API / MCP calls.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... pnpm --filter @moltnet/channel-agent dev
 *   ANTHROPIC_API_KEY=sk-... pnpm --filter @moltnet/channel-agent dev -- --name "archivist" --persona personas/archivist.md
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, type FSWatcher, readdirSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { Diary, diaryTools, executeDiaryTool } from './memory.js';
import {
  composeSystemPrompt,
  loadPersona,
  loadSkill,
  type Persona,
  type Skill,
} from './persona.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface AgentConfig {
  name: string;
  channel: string;
  channelDir: string;
  channelScript: string;
  model: string;
  systemPrompt: string;
  pollIntervalMs: number;
  apiKey: string;
  personaFile: string | null;
  skillsDir: string | null;
}

function parseArgs(): Partial<AgentConfig> {
  const args = process.argv.slice(2);
  const parsed: Partial<AgentConfig> = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        parsed.name = args[++i];
        break;
      case '--channel':
        parsed.channel = args[++i];
        break;
      case '--channel-dir':
        parsed.channelDir = args[++i];
        break;
      case '--model':
        parsed.model = args[++i];
        break;
      case '--system':
        parsed.systemPrompt = args[++i];
        break;
      case '--poll-interval':
        parsed.pollIntervalMs = parseInt(args[++i], 10);
        break;
      case '--api-key':
        parsed.apiKey = args[++i];
        break;
      case '--persona':
        parsed.personaFile = args[++i];
        break;
      case '--skills-dir':
        parsed.skillsDir = args[++i];
        break;
      case '--help':
        console.log(`Usage: channel-agent [options]
  --name <name>          Agent display name (default: from persona or auto)
  --channel <channel>    Channel to join (default: general)
  --channel-dir <path>   Path to .molt-channel (default: .molt-channel)
  --model <model>        Anthropic model (default: claude-sonnet-4-20250514)
  --system <prompt>      System prompt override (ignores persona)
  --persona <file>       Persona file (markdown with YAML frontmatter)
  --skills-dir <dir>     Directory of SKILL.md files to load
  --poll-interval <ms>   Fallback poll interval (default: 5000)
  --api-key <key>        Anthropic API key (or set ANTHROPIC_API_KEY)`);
        process.exit(0);
    }
  }
  return parsed;
}

function buildConfig(overrides: Partial<AgentConfig>): AgentConfig {
  const projectDir = resolve(process.cwd());
  const channelDir = overrides.channelDir ?? join(projectDir, '.molt-channel');
  const channelScript = join(
    projectDir,
    '.claude',
    'skills',
    'channel',
    'scripts',
    'channel.sh',
  );

  // eslint-disable-next-line no-restricted-syntax -- CLI entry point, env access is intentional
  const apiKey = overrides.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';

  return {
    name: overrides.name ?? '',
    channel: overrides.channel ?? 'general',
    channelDir,
    channelScript,
    model: overrides.model ?? 'claude-sonnet-4-20250514',
    systemPrompt: overrides.systemPrompt ?? '',
    pollIntervalMs: overrides.pollIntervalMs ?? 5000,
    apiKey,
    personaFile: overrides.personaFile ?? null,
    skillsDir: overrides.skillsDir ?? null,
  };
}

// ---------------------------------------------------------------------------
// Persona, skills, and memory setup
// ---------------------------------------------------------------------------

function loadPersonaAndSkills(cfg: AgentConfig): {
  persona: Persona | null;
  skills: Skill[];
  name: string;
  model: string;
} {
  let persona: Persona | null = null;
  const skills: Skill[] = [];

  // Load persona
  if (cfg.personaFile) {
    const personaPath = resolve(cfg.personaFile);
    if (existsSync(personaPath)) {
      persona = loadPersona(personaPath);
      log(`Loaded persona: ${persona.name || 'unnamed'}`);
    } else {
      log(`Persona file not found: ${personaPath}`);
    }
  }

  // Load skills
  if (cfg.skillsDir) {
    const skillsPath = resolve(cfg.skillsDir);
    if (existsSync(skillsPath)) {
      const files = readdirSync(skillsPath).filter(
        (f) => f.endsWith('.md') || f === 'SKILL.md',
      );
      for (const file of files) {
        const skill = loadSkill(join(skillsPath, file));
        skills.push(skill);
        log(`Loaded skill: ${skill.name}`);
      }
    }
  }

  // Resolve name: CLI flag > persona > auto-generated
  const name = cfg.name || persona?.name || `agent-${randomUUID().slice(0, 8)}`;

  // Resolve model: CLI flag > persona > default
  const model =
    cfg.model !== 'claude-sonnet-4-20250514' && cfg.model
      ? cfg.model
      : (persona?.model ?? cfg.model);

  return { persona, skills, name, model };
}

// ---------------------------------------------------------------------------
// Channel operations (thin wrappers around channel.sh)
// ---------------------------------------------------------------------------

let agentConfig: AgentConfig;

function sh(script: string, args: string[]): string {
  const cmd = [script, ...args]
    .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
    .join(' ');
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        // eslint-disable-next-line no-restricted-syntax -- passing env to child process
        ...process.env,
        MOLT_CHANNEL_DIR: agentConfig.channelDir,
      },
    }).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `error: ${msg}`;
  }
}

function channelInit(): string {
  return sh(agentConfig.channelScript, ['init']);
}

function channelRegister(sessionId: string, name: string): string {
  return sh(agentConfig.channelScript, ['register', sessionId, name]);
}

function channelDeregister(sessionId: string): string {
  return sh(agentConfig.channelScript, ['deregister', sessionId]);
}

function channelSend(
  channel: string,
  sessionId: string,
  message: string,
): string {
  return sh(agentConfig.channelScript, ['send', channel, sessionId, message]);
}

function channelDirect(
  sessionId: string,
  targetId: string,
  message: string,
): string {
  return sh(agentConfig.channelScript, [
    'direct',
    sessionId,
    targetId,
    message,
  ]);
}

function channelReceive(sessionId: string): string {
  return sh(agentConfig.channelScript, ['receive', sessionId, '--mark-read']);
}

function channelPoll(sessionId: string): { has_new: boolean; count: number } {
  const raw = sh(agentConfig.channelScript, ['poll', sessionId]);
  try {
    return JSON.parse(raw) as { has_new: boolean; count: number };
  } catch {
    return { has_new: false, count: 0 };
  }
}

function channelSessions(): string {
  return sh(agentConfig.channelScript, ['sessions']);
}

function channelHeartbeat(sessionId: string): void {
  sh(agentConfig.channelScript, ['heartbeat', sessionId]);
}

// ---------------------------------------------------------------------------
// Tool definitions for the Anthropic API
// ---------------------------------------------------------------------------

const channelTools: Anthropic.Messages.Tool[] = [
  {
    name: 'channel_send',
    description:
      'Send a message to a channel. All active sessions on that channel will see it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The message to send',
        },
        channel: {
          type: 'string',
          description: 'Channel name (default: the channel you joined)',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'channel_direct',
    description:
      'Send a direct message to a specific session. Only that session will see it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_session: {
          type: 'string',
          description: 'The short ID (8 chars) of the target session',
        },
        message: {
          type: 'string',
          description: 'The message to send',
        },
      },
      required: ['target_session', 'message'],
    },
  },
  {
    name: 'channel_list_sessions',
    description: 'List all active sessions on the channel network.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// All tools: channel + diary
const allTools: Anthropic.Messages.Tool[] = [...channelTools, ...diaryTools];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

function executeTool(
  sessionId: string,
  diary: Diary,
  name: string,
  input: Record<string, unknown>,
): string {
  // Channel tools
  switch (name) {
    case 'channel_send': {
      const channel = (input['channel'] as string) ?? agentConfig.channel;
      const message = input['message'] as string;
      return channelSend(channel, sessionId, message);
    }
    case 'channel_direct': {
      const target = input['target_session'] as string;
      const message = input['message'] as string;
      return channelDirect(sessionId, target, message);
    }
    case 'channel_list_sessions':
      return channelSessions();
  }

  // Diary tools
  if (name === 'diary_write' || name === 'diary_recall') {
    return executeDiaryTool(diary, name, input);
  }

  return `error: unknown tool ${name}`;
}

// ---------------------------------------------------------------------------
// Agent conversation loop
// ---------------------------------------------------------------------------

interface ChannelMessage {
  from: { name: string; short_id: string; session_id: string };
  content: string;
  channel: string;
  timestamp: string;
}

async function handleMessages(
  client: Anthropic,
  sessionId: string,
  diary: Diary,
  messages: ChannelMessage[],
): Promise<void> {
  const incoming = messages
    .map(
      (m) => `[${m.channel}] ${m.from.name} (${m.from.short_id}): ${m.content}`,
    )
    .join('\n');

  log(`Received ${messages.length} message(s):\n${incoming}`);

  const conversationMessages: Anthropic.Messages.MessageParam[] = [
    {
      role: 'user',
      content:
        `New channel messages:\n\n${incoming}\n\n` +
        `Respond to these messages using the channel_send tool. ` +
        `If something is worth remembering, use diary_write.`,
    },
  ];

  let turns = 0;
  const maxTurns = 5;

  while (turns < maxTurns) {
    turns++;
    const response = await client.messages.create({
      model: agentConfig.model,
      max_tokens: 1024,
      system: agentConfig.systemPrompt,
      tools: allTools,
      messages: conversationMessages,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    if (textBlocks.length > 0) {
      log(`Agent thinks: ${textBlocks.map((b) => b.text).join(' ')}`);
    }

    if (toolBlocks.length === 0) {
      break;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] =
      toolBlocks.map((block) => {
        log(`Tool call: ${block.name}(${JSON.stringify(block.input)})`);
        const result = executeTool(
          sessionId,
          diary,
          block.name,
          block.input as Record<string, unknown>,
        );
        log(`Tool result: ${result}`);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: result,
        };
      });

    conversationMessages.push({
      role: 'assistant',
      content: response.content,
    });
    conversationMessages.push({ role: 'user', content: toolResults });

    if (response.stop_reason === 'end_turn') {
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

function startWatcher(
  sessionId: string,
  client: Anthropic,
  diary: Diary,
): FSWatcher | null {
  const channelsDir = join(agentConfig.channelDir, 'channels');
  if (!existsSync(channelsDir)) {
    log('Channels directory does not exist yet, falling back to polling only');
    return null;
  }

  const watchDir = join(channelsDir, agentConfig.channel);
  if (!existsSync(watchDir)) {
    log(
      `Channel directory ${watchDir} does not exist, will be created on first message`,
    );
    return null;
  }

  const shortId = sessionId.slice(0, 8);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(watchDir, (_eventType, filename) => {
    if (!filename?.endsWith('.json')) return;
    if (filename.includes(`-${shortId}.json`)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void checkAndHandle(sessionId, client, diary);
    }, 500);
  });

  log(`Watching ${watchDir} for new messages (inotify)`);
  return watcher;
}

function startDirectWatcher(
  sessionId: string,
  client: Anthropic,
  diary: Diary,
): FSWatcher | null {
  const shortId = sessionId.slice(0, 8);
  const directDir = join(
    agentConfig.channelDir,
    'channels',
    `.direct-${shortId}`,
  );

  if (!existsSync(directDir)) return null;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watcher = watch(directDir, (_, filename) => {
    if (!filename?.endsWith('.json')) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void checkAndHandle(sessionId, client, diary);
    }, 500);
  });

  log(`Watching ${directDir} for direct messages`);
  return watcher;
}

// ---------------------------------------------------------------------------
// Poll + handle
// ---------------------------------------------------------------------------

async function checkAndHandle(
  sessionId: string,
  client: Anthropic,
  diary: Diary,
): Promise<void> {
  const poll = channelPoll(sessionId);
  if (!poll.has_new) return;

  const raw = channelReceive(sessionId);
  let parsed: { count: number; messages: ChannelMessage[] };
  try {
    parsed = JSON.parse(raw) as {
      count: number;
      messages: ChannelMessage[];
    };
  } catch {
    log(`Failed to parse messages: ${raw}`);
    return;
  }

  if (parsed.count === 0 || parsed.messages.length === 0) return;

  await handleMessages(client, sessionId, diary, parsed.messages);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const overrides = parseArgs();
  agentConfig = buildConfig(overrides);

  // Load persona, skills, resolve name
  const { persona, skills, name, model } = loadPersonaAndSkills(agentConfig);
  agentConfig.name = name;
  agentConfig.model = model;

  // Initialize diary (persistent memory)
  const diary = new Diary(agentConfig.channelDir, agentConfig.name);
  const recentMemories = diary.formatForContext(10);

  // Compose system prompt: base + persona + skills + memories
  if (!agentConfig.systemPrompt) {
    agentConfig.systemPrompt = composeSystemPrompt(
      persona,
      skills,
      recentMemories,
    );
  }

  const sessionId = randomUUID();

  log('Channel Agent starting');
  log(`  Name:      ${agentConfig.name}`);
  log(`  Session:   ${sessionId.slice(0, 8)}`);
  log(`  Channel:   #${agentConfig.channel}`);
  log(`  Model:     ${agentConfig.model}`);
  log(`  Persona:   ${persona?.name ?? '(default)'}`);
  log(
    `  Skills:    ${skills.length > 0 ? skills.map((s) => s.name).join(', ') : '(none)'}`,
  );
  log(`  Memories:  ${recentMemories.length} entries loaded`);
  log(`  Dir:       ${agentConfig.channelDir}`);

  if (!agentConfig.apiKey) {
    console.error(
      'ANTHROPIC_API_KEY environment variable or --api-key flag is required',
    );
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: agentConfig.apiKey });

  channelInit();
  channelRegister(sessionId, agentConfig.name);
  log('Registered on channel network');

  const sessions = channelSessions();
  if (sessions && sessions !== 'No active sessions') {
    log(`Active sessions:\n${sessions}`);
  }

  await checkAndHandle(sessionId, client, diary);

  const channelWatcher = startWatcher(sessionId, client, diary);
  const directWatcher = startDirectWatcher(sessionId, client, diary);

  // Fallback poll loop
  const pollInterval = setInterval(() => {
    channelHeartbeat(sessionId);
    void checkAndHandle(sessionId, client, diary);
  }, agentConfig.pollIntervalMs);

  channelSend(
    agentConfig.channel,
    sessionId,
    `${agentConfig.name} is online and listening.`,
  );
  log('Listening for messages... (Ctrl+C to stop)');

  const shutdown = () => {
    log('Shutting down...');
    clearInterval(pollInterval);
    channelWatcher?.close();
    directWatcher?.close();
    channelSend(
      agentConfig.channel,
      sessionId,
      `${agentConfig.name} is going offline.`,
    );
    channelDeregister(sessionId);
    log('Deregistered. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
