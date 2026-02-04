import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Persona: identity + personality loaded from a markdown file
// ---------------------------------------------------------------------------

export interface Persona {
  name: string;
  description: string;
  model?: string;
  traits: string[];
  style: string;
  body: string;
}

const DEFAULT_PERSONA: Persona = {
  name: '',
  description: 'A helpful autonomous agent',
  traits: [],
  style: '',
  body: '',
};

/**
 * Parse a persona file. Format: YAML frontmatter + markdown body.
 *
 * ```markdown
 * ---
 * name: archivist
 * description: A meticulous knowledge curator
 * model: claude-sonnet-4-20250514
 * traits:
 *   - methodical and precise
 *   - slightly formal but warm
 * style: Speaks in measured, complete sentences.
 * ---
 *
 * # Archivist
 *
 * You are the Archivist...
 * ```
 */
export function loadPersona(filePath: string): Persona {
  const raw = readFileSync(filePath, 'utf-8');
  return parsePersona(raw);
}

export function parsePersona(raw: string): Persona {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { ...DEFAULT_PERSONA, body: raw.trim() };
  }

  const [, frontmatter, body] = fmMatch;
  const persona: Persona = { ...DEFAULT_PERSONA, body: body.trim() };

  // Simple YAML parser — enough for flat keys + string arrays
  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    switch (key) {
      case 'name':
        persona.name = value.trim();
        break;
      case 'description':
        persona.description = value.trim();
        break;
      case 'model':
        persona.model = value.trim();
        break;
      case 'style':
        persona.style = value.trim();
        break;
      case 'traits':
        // Traits are on subsequent indented lines
        persona.traits = [];
        break;
    }
    // Handle YAML list items (  - item)
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem) {
      persona.traits.push(listItem[1].trim());
    }
  }

  return persona;
}

// ---------------------------------------------------------------------------
// Skill loader: reads SKILL.md files and extracts instructions
// ---------------------------------------------------------------------------

export interface Skill {
  name: string;
  description: string;
  instructions: string;
}

/**
 * Load a SKILL.md file. Same format as Claude Code skills:
 * YAML frontmatter (name, description) + markdown body.
 */
export function loadSkill(filePath: string): Skill {
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  const skill: Skill = {
    name: 'unnamed',
    description: '',
    instructions: '',
  };

  if (!fmMatch) {
    skill.instructions = raw.trim();
    return skill;
  }

  const [, frontmatter, body] = fmMatch;
  skill.instructions = body.trim();

  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'name') skill.name = value.trim();
    if (key === 'description') skill.description = value.trim();
  }

  return skill;
}

// ---------------------------------------------------------------------------
// System prompt composer
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are an autonomous agent on the MoltNet channel network.
You receive messages from other agents and humans via a shared channel.
You can send messages back, list who is online, and send direct messages.
You can also write diary entries to remember important things across sessions.

Always respond to messages you receive. You are a prototype — preparing for
the real MoltNet where agents have cryptographic identity, persistent memory,
and autonomous auth.`;

export function composeSystemPrompt(
  persona: Persona | null,
  skills: Skill[],
  recentMemories: string[],
): string {
  const sections: string[] = [BASE_PROMPT];

  // Persona
  if (persona) {
    sections.push('');
    sections.push('## Your Identity');
    if (persona.name) sections.push(`You are ${persona.name}.`);
    if (persona.description) sections.push(persona.description);
    if (persona.traits.length > 0) {
      sections.push(`\nPersonality traits: ${persona.traits.join(', ')}`);
    }
    if (persona.style) sections.push(`\nCommunication style: ${persona.style}`);
    if (persona.body) {
      sections.push('');
      sections.push(persona.body);
    }
  }

  // Skills
  if (skills.length > 0) {
    sections.push('');
    sections.push('## Loaded Skills');
    for (const skill of skills) {
      sections.push(`\n### ${skill.name}`);
      if (skill.description) sections.push(skill.description);
      sections.push(skill.instructions);
    }
  }

  // Recent memories (diary entries from previous sessions)
  if (recentMemories.length > 0) {
    sections.push('');
    sections.push('## Recent Memories');
    sections.push(
      'These are entries from your diary — things you chose to remember:',
    );
    for (const memory of recentMemories) {
      sections.push(`- ${memory}`);
    }
  }

  return sections.join('\n');
}
