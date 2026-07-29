type ArgvPrefix = readonly [
  executable: string,
  subcommand: string,
  ...nestedTokens: string[],
];

export interface ShellCommandRule {
  argvPrefix: ArgvPrefix;
}

export const SHELL_COMMAND_ENCODING_VERSION = 'v1';
export const MIN_SHELL_COMMAND_TOKENS = 2;
export const MAX_SHELL_COMMAND_TOKENS = 8;
export const MAX_SHELL_COMMAND_TOKEN_CHARACTERS = 128;
export const MAX_SHELL_COMMAND_IDENTIFIER_BYTES = 1024;

const UNRESERVED_BYTE = /^[A-Za-z0-9._~-]$/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const UPPER_HEX = /^[0-9A-F]{2}$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class ShellCommandIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellCommandIdentifierError';
  }
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new ShellCommandIdentifierError(
          'Shell command tokens must contain well-formed UTF-8 text',
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ShellCommandIdentifierError(
        'Shell command tokens must contain well-formed UTF-8 text',
      );
    }
  }
}

function assertToken(token: string): void {
  assertWellFormedUnicode(token);
  if (token.length === 0) {
    throw new ShellCommandIdentifierError(
      'Shell command tokens must not be empty',
    );
  }
  if ([...token].length > MAX_SHELL_COMMAND_TOKEN_CHARACTERS) {
    throw new ShellCommandIdentifierError(
      `Shell command tokens must be at most ${MAX_SHELL_COMMAND_TOKEN_CHARACTERS} characters`,
    );
  }
  if (CONTROL_CHARACTER.test(token)) {
    throw new ShellCommandIdentifierError(
      'Shell command tokens must not contain control characters',
    );
  }
}

function encodeToken(token: string): string {
  assertToken(token);
  return [...textEncoder.encode(token)]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return UNRESERVED_BYTE.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

function decodeToken(segment: string): string {
  if (segment.length === 0) {
    throw new ShellCommandIdentifierError(
      'Shell command identifier segments must not be empty',
    );
  }

  const bytes: number[] = [];
  for (let index = 0; index < segment.length; ) {
    const character = segment[index];
    if (UNRESERVED_BYTE.test(character)) {
      bytes.push(character.charCodeAt(0));
      index += 1;
      continue;
    }
    if (
      character !== '%' ||
      index + 2 >= segment.length ||
      !UPPER_HEX.test(segment.slice(index + 1, index + 3))
    ) {
      throw new ShellCommandIdentifierError(
        'Shell command identifier is not canonically percent-encoded',
      );
    }
    bytes.push(Number.parseInt(segment.slice(index + 1, index + 3), 16));
    index += 3;
  }

  let token: string;
  try {
    token = textDecoder.decode(Uint8Array.from(bytes));
  } catch {
    throw new ShellCommandIdentifierError(
      'Shell command identifier contains malformed UTF-8',
    );
  }
  assertToken(token);
  if (encodeToken(token) !== segment) {
    throw new ShellCommandIdentifierError(
      'Shell command identifier is not canonically percent-encoded',
    );
  }
  return token;
}

function assertTokenCount(
  tokens: readonly string[],
): asserts tokens is ArgvPrefix {
  if (
    tokens.length < MIN_SHELL_COMMAND_TOKENS ||
    tokens.length > MAX_SHELL_COMMAND_TOKENS
  ) {
    throw new ShellCommandIdentifierError(
      `Shell command prefixes require ${MIN_SHELL_COMMAND_TOKENS}–${MAX_SHELL_COMMAND_TOKENS} tokens`,
    );
  }
}

export function encodeShellCommandRule(rule: ShellCommandRule): string {
  assertTokenCount(rule.argvPrefix);
  const identifier = [
    SHELL_COMMAND_ENCODING_VERSION,
    ...rule.argvPrefix.map(encodeToken),
  ].join('/');
  if (
    textEncoder.encode(identifier).length > MAX_SHELL_COMMAND_IDENTIFIER_BYTES
  ) {
    throw new ShellCommandIdentifierError(
      `Shell command identifiers must be at most ${MAX_SHELL_COMMAND_IDENTIFIER_BYTES} encoded bytes`,
    );
  }
  return identifier;
}

export function decodeShellCommandIdentifier(
  identifier: string,
): ShellCommandRule {
  if (
    textEncoder.encode(identifier).length > MAX_SHELL_COMMAND_IDENTIFIER_BYTES
  ) {
    throw new ShellCommandIdentifierError(
      `Shell command identifiers must be at most ${MAX_SHELL_COMMAND_IDENTIFIER_BYTES} encoded bytes`,
    );
  }
  const [version, ...segments] = identifier.split('/');
  if (version !== SHELL_COMMAND_ENCODING_VERSION) {
    throw new ShellCommandIdentifierError(
      `Unknown shell command encoding version: ${version || '(empty)'}`,
    );
  }
  assertTokenCount(segments);
  const tokens = segments.map(decodeToken);
  assertTokenCount(tokens);
  const rule = { argvPrefix: tokens };
  if (encodeShellCommandRule(rule) !== identifier) {
    throw new ShellCommandIdentifierError(
      'Shell command identifier is not canonical',
    );
  }
  return rule;
}

export function compareShellCommandRules(
  left: ShellCommandRule,
  right: ShellCommandRule,
): number {
  const leftPrefix = left.argvPrefix;
  const rightPrefix = right.argvPrefix;
  const count = Math.min(leftPrefix.length, rightPrefix.length);
  for (let index = 0; index < count; index += 1) {
    if (leftPrefix[index] < rightPrefix[index]) return -1;
    if (leftPrefix[index] > rightPrefix[index]) return 1;
  }
  return leftPrefix.length - rightPrefix.length;
}

export function normalizeShellCommandRules(
  rules: readonly ShellCommandRule[],
): ShellCommandRule[] {
  const byIdentifier = new Map<string, ShellCommandRule>();
  for (const rule of rules) {
    const identifier = encodeShellCommandRule(rule);
    byIdentifier.set(identifier, decodeShellCommandIdentifier(identifier));
  }
  return [...byIdentifier.values()].sort(compareShellCommandRules);
}
