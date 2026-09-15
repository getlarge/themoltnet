/**
 * Pi's built-in structured tool names. A runtime policy `tools` entry with one
 * of these names grants the structured tool, never a shell executable of the
 * same name: shell use of `ls`, `grep`, … needs a shell command rule.
 */
export const PI_BUILTIN_STRUCTURED_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'bash',
  'ls',
  'find',
  'grep',
] as const;

/**
 * Whether a policy `tools` entry also authorizes every shell invocation of the
 * executable with the same name. It does only when that name is not an active
 * structured tool. Runtimes pass their full registered tool set; the default
 * covers Pi's built-in structured tools.
 */
export function grantsShellExecutable(
  toolName: string,
  structuredToolNames:
    | ReadonlySet<string>
    | readonly string[] = PI_BUILTIN_STRUCTURED_TOOL_NAMES,
): boolean {
  const isStructured =
    'has' in structuredToolNames
      ? structuredToolNames.has(toolName)
      : structuredToolNames.includes(toolName);
  return !isStructured;
}
