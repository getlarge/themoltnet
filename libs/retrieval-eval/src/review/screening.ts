import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Entry } from '../dataset.js';
import { hash } from '../hash.js';
import { saveJson } from '../storage.js';
import type { Screening } from './types.js';
export const questions: Screening['questions'] = {
  credentials: {
    type: 'noul',
    criteria: { true: 'Yes', false: 'No' },
    instructions:
      'Does this text contain credentials or secret storage locations?',
  },
  personal: {
    type: 'noul',
    criteria: { true: 'Yes', false: 'No' },
    instructions:
      'Does this text contain a full personal name, identifying alias, contact details, or personal health or financial information? A first name alone, including operator attribution or path usernames, does not count unless accompanied by additional identifying or personal details.',
  },
  publication: {
    type: 'noul',
    criteria: { true: 'Yes', false: 'No' },
    instructions:
      'Does this text contain private information, confidential information or an unresolved operational exposure that needs human review before public release?',
  },
};
export async function screenEntry(
  entry: Entry,
  root: string,
): Promise<Screening> {
  const record: Screening = {
    id: randomUUID(),
    implementationHash: hash(
      await readFile(new URL('./screening.ts', import.meta.url), 'utf8'),
    ),
    dependencyHash: hash(
      await readFile(
        new URL('../../../../pnpm-lock.yaml', import.meta.url),
        'utf8',
      ),
    ),
    entryId: entry.id,
    entryHash: entry.contentHash,
    model: 'nimble',
    modelDigest: 'unknown',
    rubricVersion: 'corpus-screen-v2-first-name-exception',
    input: JSON.stringify({
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
    }),
    questions,
    startedAt: new Date().toISOString(),
  };
  const path = join(root, 'screening', `${record.id}.json`);
  await saveJson(path, record);
  try {
    const tags = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    if (!tags.ok) throw new Error('Local model discovery failed');
    const body = (await tags.json()) as {
      models: {
        name: string;
        digest: string;
        remote_host?: string;
        remote_model?: string;
      }[];
    };
    const model = body.models.find(
      (m) => m.name === 'nimble' || m.name === 'nimble:latest',
    );
    if (!model) throw new Error('Local Nimble is not installed');
    if (model.remote_host || model.remote_model)
      throw new Error('Screening requires a local model');
    record.modelDigest = model.digest;
    const response = await fetch('http://127.0.0.1:11434/v1/systemone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: record.model,
        state: record.input,
        questions,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Local screening returned HTTP ${response.status}`);
    const result = (await response.json()) as {
      answers: Record<string, { type: string; noul: number }>;
    };
    record.probabilities = {};
    for (const key of Object.keys(questions)) {
      const answer = result.answers[key];
      if (
        answer?.type !== 'noul' ||
        !Number.isFinite(answer.noul) ||
        answer.noul < 0 ||
        answer.noul > 1
      )
        throw new Error('Invalid local classifier probability');
      record.probabilities[key] = answer.noul;
    }
  } catch (error) {
    record.error =
      error instanceof Error ? error.message : 'Local screening failed';
  }
  record.finishedAt = new Date().toISOString();
  await saveJson(path, record);
  return record;
}
