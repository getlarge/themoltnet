import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { compileDiary, type CompileResult } from '@moltnet/api-client';

import { createAuthedClient, getRepoRoot } from './client.js';

export interface CompiledPackMetadata {
  compile_session: string;
  source_model_tag: string;
  source_entry_ids: string[];
  compile_profile: 'gepa-runtime';
  diary_id: string;
  token_budget: number;
  task_prompt?: string;
  include_tags?: string[];
  exclude_tags?: string[];
  lambda?: number;
  w_recency?: number;
  w_importance?: number;
}

export interface WriteCompiledPackOptions {
  diaryId: string;
  tokenBudget: number;
  taskPrompt?: string;
  includeTags?: string[];
  excludeTags?: string[];
  lambda?: number;
  wRecency?: number;
  wImportance?: number;
  modelTag?: string;
  outputDir?: string;
  outputPath?: string;
  metadataPath?: string;
}

function renderCompiledPack(
  result: CompileResult,
  metadata: CompiledPackMetadata,
): string {
  const sections = result.entries.map((entry, index) => {
    const title = `Entry ${index + 1} — ${entry.id.slice(0, 8)}`;
    return [
      `### ${title}`,
      '',
      `- Entry ID: \`${entry.id}\``,
      `- Compression: \`${entry.compressionLevel}\``,
      `- Tokens: ${entry.compressedTokens}/${entry.originalTokens}`,
      '',
      entry.content.trim(),
    ].join('\n');
  });

  return [
    '# MoltNet Context Pack',
    '',
    `Compile session: ${metadata.compile_session}`,
    `Diary ID: ${metadata.diary_id}`,
    `Profile: ${metadata.compile_profile}`,
    `Model tag: ${metadata.source_model_tag}`,
    `Token budget: ${metadata.token_budget}`,
    metadata.task_prompt ? `Task prompt: ${metadata.task_prompt}` : '',
    '',
    '## Source Entries',
    ...metadata.source_entry_ids.map((id) => `- \`${id}\``),
    '',
    '## Compiled Entries',
    '',
    ...sections,
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveRepoPath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function buildDefaultOutputPaths(
  repoRoot: string,
  compileSession: string,
): {
  outputPath: string;
  metadataPath: string;
} {
  const safeSession = compileSession.replaceAll(':', '-');
  const runDir = resolve(repoRoot, '.legreffier/context/runs', safeSession);
  return {
    outputPath: resolve(runDir, 'compiled-pack.md'),
    metadataPath: resolve(runDir, 'compiled-pack.meta.json'),
  };
}

export async function writeCompiledPack(
  options: WriteCompiledPackOptions,
): Promise<{
  outputPath: string;
  metadataPath: string;
  metadata: CompiledPackMetadata;
}> {
  const repoRoot = await getRepoRoot();
  const client = await createAuthedClient();

  const { data, error } = await compileDiary({
    client,
    path: { id: options.diaryId },
    body: {
      tokenBudget: options.tokenBudget,
      taskPrompt: options.taskPrompt,
      includeTags: options.includeTags,
      excludeTags: options.excludeTags,
      lambda: options.lambda,
      wRecency: options.wRecency,
      wImportance: options.wImportance,
    },
  });

  if (error || !data) {
    throw new Error(`compileDiary failed: ${JSON.stringify(error)}`);
  }

  const compileSession = new Date().toISOString();
  const metadata: CompiledPackMetadata = {
    compile_session: compileSession,
    source_model_tag: options.modelTag ?? 'unknown',
    source_entry_ids: data.entries.map((entry) => entry.id),
    compile_profile: 'gepa-runtime',
    diary_id: options.diaryId,
    token_budget: options.tokenBudget,
    task_prompt: options.taskPrompt,
    include_tags: options.includeTags,
    exclude_tags: options.excludeTags,
    lambda: options.lambda,
    w_recency: options.wRecency,
    w_importance: options.wImportance,
  };

  const defaultPaths = buildDefaultOutputPaths(repoRoot, compileSession);
  const resolvedOutputDir = options.outputDir
    ? resolveRepoPath(repoRoot, options.outputDir)
    : null;
  const outputPath = options.outputPath
    ? resolveRepoPath(repoRoot, options.outputPath)
    : resolvedOutputDir
      ? resolve(resolvedOutputDir, 'compiled-pack.md')
      : defaultPaths.outputPath;
  const metadataPath = options.metadataPath
    ? resolveRepoPath(repoRoot, options.metadataPath)
    : resolvedOutputDir
      ? resolve(resolvedOutputDir, 'compiled-pack.meta.json')
      : defaultPaths.metadataPath;

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(outputPath, renderCompiledPack(data, metadata), 'utf8');
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  return { outputPath, metadataPath, metadata };
}
