/**
 * Pi-native port of the Go fidelity judge
 * (libs/dspy-adapters/fidelity/fidelity.go).
 *
 * Same inputs (source_entries, rendered_content, rubric), same outputs
 * (coverage, grounding, faithfulness, reasoning). Uses pi-ai `complete()`
 * instead of dspy-go; no process-global state.
 */
import { complete, type Model } from '@mariozechner/pi-ai';

export {
  DEFAULT_RUBRIC,
  JUDGE_PROMPT_ASSET_PATH,
  JUDGE_SYSTEM_PROMPT,
  RUBRIC_ASSET_PATH,
} from './assets.js';
import { DEFAULT_RUBRIC, JUDGE_SYSTEM_PROMPT } from './assets.js';

export interface FidelityScores {
  coverage: number;
  grounding: number;
  faithfulness: number;
  composite: number;
  reasoning: string;
}

export interface FidelityRequest {
  model: Model<any>;
  sourceEntries: string;
  renderedContent: string;
  rubric?: string;
}

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function extractJson(text: string): string {
  const fenceMatch = text.match(JSON_FENCE_RE);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function parseScores(raw: string): FidelityScores {
  const jsonText = extractJson(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `judge returned an invalid structured response: ${
        (err as Error).message
      }\n---raw---\n${raw}`,
    );
  }

  const coverage = clamp01(parsed.coverage);
  const grounding = clamp01(parsed.grounding);
  const faithfulness = clamp01(parsed.faithfulness);
  const reasoning = coerceString(parsed.reasoning);

  const composite = (coverage + grounding + faithfulness) / 3;

  return { coverage, grounding, faithfulness, composite, reasoning };
}

function buildUserMessage(
  sourceEntries: string,
  renderedContent: string,
  rubric: string,
): string {
  return [
    '## Rubric',
    rubric,
    '',
    '## Source entries',
    sourceEntries,
    '',
    '## Rendered content',
    renderedContent,
    '',
    'Produce the JSON object now.',
  ].join('\n');
}

/**
 * Run the fidelity judge via pi-ai `complete()`. Mirrors `fidelity.Run` in
 * libs/dspy-adapters/fidelity/fidelity.go.
 */
export async function runFidelityJudge(
  req: FidelityRequest,
  options: { signal?: AbortSignal } = {},
): Promise<FidelityScores> {
  const rubric = req.rubric?.trim() ? req.rubric : DEFAULT_RUBRIC;
  const userPrompt = buildUserMessage(
    req.sourceEntries,
    req.renderedContent,
    rubric,
  );

  const message = await complete(
    req.model,
    {
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt,
          timestamp: Date.now(),
        },
      ],
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(
      `judge failed: ${message.errorMessage ?? message.stopReason}`,
    );
  }

  const textContent = message.content
    .filter(
      (c): c is { type: 'text'; text: string } =>
        c.type === 'text' && typeof (c as { text?: unknown }).text === 'string',
    )
    .map((c) => c.text)
    .join('\n')
    .trim();

  if (!textContent) {
    throw new Error('judge returned empty response');
  }

  return parseScores(textContent);
}

/**
 * Build a stable markdown blob of source entries for the judge prompt.
 * Mirrors `buildSourceEntriesFromPack` / `buildSourceEntriesMarkdown` in the
 * Go CLI so that local and proctored modes produce the same input shape.
 */
export function buildSourceEntriesMarkdown(
  entries: Array<{ title?: string | null; content: string }>,
): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const title = entry.title?.trim() || 'Untitled';
    parts.push(`## ${title}\n${entry.content}\n`);
  }
  return parts.join('\n');
}
