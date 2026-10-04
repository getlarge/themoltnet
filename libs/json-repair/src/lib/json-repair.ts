import JSON5 from 'json5';

export type JsonSyntaxRepair = 'lenient_json' | 'missing_comma';

export interface ParsedCompleteObject {
  value: Record<string, unknown>;
  repairs: JsonSyntaxRepair[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract the last balanced object; incomplete strings, comments, or braces fail. */
function lastCompleteObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let last: string | null = null;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && start >= 0) {
        last = text.slice(start, i + 1);
        start = -1;
      }
    }
  }
  return depth === 0 && !quote && !blockComment ? last : null;
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
  let repaired = source;
  for (const position of insertAt.reverse()) {
    repaired = `${repaired.slice(0, position)},${repaired.slice(position)}`;
  }
  return repaired;
}

function parseCandidate(source: string): ParsedCompleteObject | null {
  try {
    const value: unknown = JSON.parse(source);
    if (object(value)) return { value, repairs: [] };
  } catch {
    // Try complete, documented JSON5 syntax next.
  }
  try {
    const value: unknown = JSON5.parse(source);
    if (object(value)) return { value, repairs: ['lenient_json'] };
  } catch {
    // Try one conservative structural repair next.
  }
  const withCommas = insertMissingObjectCommas(source);
  if (!withCommas) return null;
  try {
    const value: unknown = JSON5.parse(withCommas);
    if (object(value)) return { value, repairs: ['missing_comma'] };
  } catch {
    // The repair did not form a complete object.
  }
  return null;
}

/**
 * Parse an assistant final message into a complete object. Unlike broad JSON
 * repair libraries, this never closes truncated containers or invents values.
 * Task schema validation remains the caller's responsibility.
 */
export function parseCompleteJsonObject(
  text: string,
): ParsedCompleteObject | null {
  if (!text) return null;
  const candidates: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('```', cursor);
    if (open < 0) break;
    const close = text.indexOf('```', open + 3);
    if (close < 0) break;
    let contentStart = open + 3;
    if (text.slice(contentStart, contentStart + 4).toLowerCase() === 'json') {
      contentStart += 4;
    }
    while (contentStart < close && /\s/.test(text[contentStart])) {
      contentStart++;
    }
    candidates.push(text.slice(contentStart, close));
    cursor = close + 3;
  }
  candidates.push(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const objectText = lastCompleteObject(candidates[i]);
    if (!objectText) continue;
    const parsed = parseCandidate(objectText);
    if (parsed) return parsed;
  }
  return null;
}
