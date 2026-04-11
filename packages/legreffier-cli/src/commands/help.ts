export interface CommandFlag {
  name: string;
  short?: string;
  value?: string;
  description: string;
  required?: boolean;
  default?: string;
}

export interface CommandExample {
  description: string;
  command: string;
}

export interface CommandHelp {
  command: string;
  summary: string;
  usage: string;
  description: string;
  flags: CommandFlag[];
  examples: CommandExample[];
  notes?: string[];
}

function formatFlag(flag: CommandFlag): string {
  const head = flag.short ? `${flag.name}, ${flag.short}` : flag.name;
  const value = flag.value ? ` ${flag.value}` : '';
  const suffixParts: string[] = [];
  if (flag.required) suffixParts.push('(required)');
  if (flag.default !== undefined) suffixParts.push(`default: ${flag.default}`);
  const suffix = suffixParts.length > 0 ? `  [${suffixParts.join(', ')}]` : '';
  return `  ${head}${value}${suffix}\n      ${flag.description}`;
}

export function printCommandHelp(help: CommandHelp): void {
  const lines: string[] = [];
  lines.push(`${help.command} — ${help.summary}`);
  lines.push('');
  lines.push(`Usage: ${help.usage}`);
  lines.push('');
  lines.push(help.description);
  if (help.flags.length > 0) {
    lines.push('');
    lines.push('Flags:');
    for (const flag of help.flags) {
      lines.push(formatFlag(flag));
    }
  }
  if (help.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    for (const ex of help.examples) {
      lines.push(`  # ${ex.description}`);
      lines.push(`  ${ex.command}`);
    }
  }
  if (help.notes && help.notes.length > 0) {
    lines.push('');
    lines.push('Notes:');
    for (const note of help.notes) {
      lines.push(`  - ${note}`);
    }
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
}

export function printRootHelp(commands: CommandHelp[]): void {
  const lines: string[] = [];
  lines.push('legreffier — LeGreffier CLI');
  lines.push('');
  lines.push('Usage: legreffier <command> [flags]');
  lines.push('');
  lines.push('Commands:');
  const pad = Math.max(...commands.map((c) => c.command.length)) + 2;
  for (const cmd of commands) {
    lines.push(`  ${cmd.command.padEnd(pad)}${cmd.summary}`);
  }
  lines.push('');
  lines.push('Run `legreffier <command> --help` for command-specific help.');
  lines.push('');
  process.stdout.write(lines.join('\n'));
}
