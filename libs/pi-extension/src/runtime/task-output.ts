import { computeJsonCid } from '@moltnet/crypto-service';
import { validateTaskOutput } from '@moltnet/tasks';

export interface ParsedTaskOutputResult {
  output: Record<string, unknown> | null;
  outputCid: string | null;
  error: { code: string; message: string } | null;
}

export async function parseStructuredTaskOutput(
  assistantText: string,
  taskType: string,
): Promise<ParsedTaskOutputResult> {
  const extracted = extractJsonObject(assistantText);
  if (!extracted) {
    return {
      output: null,
      outputCid: null,
      error: {
        code: 'output_missing',
        message:
          'Agent did not emit a parseable JSON object as its final message.',
      },
    };
  }

  const errors = validateTaskOutput(taskType, extracted);
  if (errors.length > 0) {
    const details = errors
      .slice(0, 3)
      .map((error) => `${error.field}: ${error.message}`);
    const [firstError] = errors;
    return {
      output: null,
      outputCid: null,
      error: {
        code:
          firstError?.field === 'task_type'
            ? 'unknown_task_type'
            : 'output_validation_failed',
        message: `Output failed schema validation: ${details.join('; ')}`,
      },
    };
  }

  try {
    return {
      output: extracted as Record<string, unknown>,
      outputCid: await computeJsonCid(extracted),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: null,
      outputCid: null,
      error: {
        code: 'output_cid_compute_failed',
        message: `Validated output could not be canonicalized: ${message}`,
      },
    };
  }
}

/**
 * Find the last balanced top-level JSON object in `text` and parse it.
 * Tolerates markdown fences and leading prose. Returns null if parsing fails.
 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null;

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/gi;
  const candidates: string[] = [];
  for (const m of text.matchAll(fenceMatch)) {
    candidates.push(m[1]);
  }

  const scanForObject = (s: string): string | null => {
    let depth = 0;
    let start = -1;
    let lastComplete: string | null = null;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          lastComplete = s.slice(start, i + 1);
          start = -1;
        }
      }
    }
    return lastComplete;
  };

  candidates.push(text);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const obj = scanForObject(candidates[i]);
    if (!obj) continue;
    try {
      return JSON.parse(obj);
    } catch {
      /* try next */
    }
  }
  return null;
}
