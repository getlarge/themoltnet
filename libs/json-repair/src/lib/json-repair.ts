import JSON5 from 'json5';

export type JsonSyntaxRepair = 'lenient_json' | 'missing_comma';

export interface ParsedCompleteValue {
  value: unknown;
  repairs: JsonSyntaxRepair[];
}

interface Token {
  text: string;
  start: number;
  end: number;
  kind: 'string' | 'word' | 'punctuation';
}

/** Tokenize only enough to locate comma gaps outside strings and comments. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length; ) {
    const ch = source[i];
    const next = source[i + 1];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    const start = i;
    if (ch === '"' || ch === "'") {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i++] === ch) {
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      tokens.push({
        text: source.slice(start, i),
        start,
        end: i,
        kind: 'string',
      });
      continue;
    }
    if ('{}[]:,'.includes(ch)) {
      i++;
      tokens.push({ text: ch, start, end: i, kind: 'punctuation' });
      continue;
    }
    while (
      i < source.length &&
      !/\s/.test(source[i]) &&
      !'{}[]:,'.includes(source[i]) &&
      !(source[i] === '/' && '/*'.includes(source[i + 1] ?? ''))
    ) {
      i++;
    }
    if (i === start) return null;
    tokens.push({ text: source.slice(start, i), start, end: i, kind: 'word' });
  }
  return tokens;
}

/**
 * Largest input the missing-comma repair scans. Strict JSON and JSON5 parsing
 * still run on larger input; only the structural repair is skipped, so model
 * output cannot make it hold the event loop.
 */
export const MAX_COMMA_REPAIR_CHARS = 256 * 1024;

/** Insert a comma only between a completed object value and the next key. */
function insertMissingObjectCommas(source: string): string | null {
  const tokens = tokenize(source);
  if (!tokens) return null;
  const stack: Array<{
    kind: 'object' | 'array';
    phase: 'key' | 'colon' | 'value' | 'separator';
  }> = [];
  const insertAt: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const top = stack.at(-1);
    const previous = tokens[i - 1];
    if (
      top?.kind === 'object' &&
      top.phase === 'separator' &&
      previous &&
      token.start > previous.end &&
      (token.kind === 'string' || token.kind === 'word') &&
      tokens[i + 1]?.text === ':'
    ) {
      insertAt.push(token.start);
      top.phase = 'key';
    }

    if (token.text === '{' || token.text === '[') {
      if (top?.phase === 'value') top.phase = 'separator';
      stack.push({
        kind: token.text === '{' ? 'object' : 'array',
        phase: token.text === '{' ? 'key' : 'value',
      });
    } else if (token.text === '}' || token.text === ']') {
      stack.pop();
    } else if (token.text === ':') {
      if (top?.kind === 'object' && top.phase === 'colon') top.phase = 'value';
    } else if (token.text === ',') {
      if (top?.phase === 'separator') {
        top.phase = top.kind === 'object' ? 'key' : 'value';
      }
    } else if (top?.kind === 'object' && top.phase === 'key') {
      top.phase = 'colon';
    } else if (top?.phase === 'value') {
      top.phase = 'separator';
    }
  }
  if (insertAt.length === 0) return null;
  // One pass over ascending insertion points keeps the rebuild linear.
  const parts: string[] = [];
  let from = 0;
  for (const position of insertAt) {
    parts.push(source.slice(from, position), ',');
    from = position;
  }
  parts.push(source.slice(from));
  return parts.join('');
}

function parseCandidate(source: string): ParsedCompleteValue | null {
  try {
    const value: unknown = JSON.parse(source);
    return { value, repairs: [] };
  } catch {
    // Try complete, documented JSON5 syntax next.
  }
  try {
    const value: unknown = JSON5.parse(source);
    return { value, repairs: ['lenient_json'] };
  } catch {
    // Try one conservative structural repair next.
  }
  if (source.length > MAX_COMMA_REPAIR_CHARS) return null;
  const withCommas = insertMissingObjectCommas(source);
  if (!withCommas) return null;
  try {
    const value: unknown = JSON5.parse(withCommas);
    return { value, repairs: ['missing_comma'] };
  } catch {
    // The repair did not form a complete object.
  }
  return null;
}

/** Parse one complete JSON-like value, with no surrounding prose or fences. */
export function parseCompleteJsonValue(
  text: string,
): ParsedCompleteValue | null {
  if (!text.trim()) return null;
  return parseCandidate(text);
}
