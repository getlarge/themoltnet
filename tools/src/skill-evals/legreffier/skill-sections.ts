import { readFile } from 'node:fs/promises';

/**
 * Split SKILL.md into PREAMBLE, COMMIT_SECTION, and EPILOGUE.
 *
 * Boundaries:
 * - PREAMBLE: everything before "## Accountable commit workflow"
 * - COMMIT_SECTION: from "## Accountable commit workflow" through
 *   the line before "## Semantic entry workflow"
 * - EPILOGUE: from "## Semantic entry workflow" to end of file
 */
export async function loadSkillSections(
  skillPath: string,
): Promise<{ preamble: string; commitSection: string; epilogue: string }> {
  const content = await readFile(skillPath, 'utf8');
  return splitSkillContent(content);
}

export function splitSkillContent(content: string): {
  preamble: string;
  commitSection: string;
  epilogue: string;
} {
  const commitStart = content.indexOf('\n## Accountable commit workflow');
  if (commitStart === -1) {
    throw new Error(
      'SKILL.md missing "## Accountable commit workflow" heading',
    );
  }

  const epilogueStart = content.indexOf('\n## Semantic entry workflow');
  if (epilogueStart === -1) {
    throw new Error('SKILL.md missing "## Semantic entry workflow" heading');
  }

  return {
    preamble: content.slice(0, commitStart + 1), // include trailing newline
    commitSection: content.slice(commitStart + 1, epilogueStart + 1),
    epilogue: content.slice(epilogueStart + 1),
  };
}
