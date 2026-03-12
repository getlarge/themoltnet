#!/usr/bin/env npx tsx
/**
 * tasksmith/enrich.ts — Enrich diary-linked task records with evidence.
 *
 * Resolution chain:
 *   commit trailer
 *     → procedural entry (accountable commit)
 *       → extract branch, scopes, refs, keywords
 *         → search for related episodic entries (incidents, observations)
 *         → search for related semantic entries (decisions, architecture scans)
 *           → assemble evidence bundle per task
 *
 * Reads:  tasksmith/candidates/tasks/*.json
 * Writes: tasksmith/evidence/entries/{entry_id}.json   (cache)
 *         tasksmith/evidence/tasks/{task_id}.json       (enrichment records)
 *         tasksmith/evidence/benchmark-links.json       (consolidation feed)
 *
 * Does NOT modify the original task files in candidates/tasks/.
 *
 * Usage:
 *   npx tsx tasksmith/enrich.ts                    # enrich all diary-linked tasks
 *   npx tsx tasksmith/enrich.ts --force            # re-resolve cached entries
 *   npx tsx tasksmith/enrich.ts --dry-run          # collect + log, no writes
 *   npx tsx tasksmith/enrich.ts --skip-search      # resolve linked entries only, skip related entry search
 *
 * Requires: .moltnet/legreffier/moltnet.json (client credentials for OAuth2)
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type Client,
  type DiaryEntry,
  createClient,
  createConfig,
  getDiaryEntryById,
  searchDiary,
} from '@moltnet/api-client';

const __dirname =
  import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const TASKS_DIR = join(REPO_ROOT, 'tasksmith/candidates/tasks');
const ENTRY_CACHE_DIR = join(REPO_ROOT, 'tasksmith/evidence/entries');
const ENRICHED_DIR = join(REPO_ROOT, 'tasksmith/evidence/tasks');
const BENCHMARK_LINKS_FILE = join(
  REPO_ROOT,
  'tasksmith/evidence/benchmark-links.json',
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRecord {
  task_id: string;
  fixture_ref: string;
  gold_fix_ref: string;
  source_commit_ref: string;
  problem_statement: string;
  family: string;
  secondary_families: string[];
  subsystems: string[];
  changed_files: string[];
  fail_to_pass: string[];
  pass_to_pass: string[];
  diary_entry_ids: string[];
  confidence: string;
}

interface EntryMetadata {
  operator: string | null;
  tool: string | null;
  risk_level: string | null;
  branch: string | null;
  scopes: string[];
  refs: string[];
  files_changed: number | null;
}

interface CachedEntry {
  entry_id: string;
  title: string;
  entry_type: string;
  tags: string[];
  importance: number;
  signed: boolean;
  created_at: string;
  content_excerpt: string;
  resolution_status: 'resolved' | 'not_found' | 'error';
  metadata: EntryMetadata;
}

interface RelatedEntry {
  id: string;
  entry_type: string;
  title: string;
  relation: 'same_branch' | 'same_scope' | 'content_match';
  relevance_signal: string;
}

interface LinkedEntry {
  id: string;
  entry_type: string;
  title: string;
  tags: string[];
  risk_level: string | null;
  refs: string[];
  summary: string;
}

interface Evidence {
  failure_patterns: string[];
  repo_conventions: string[];
  decisions: string[];
  workarounds: string[];
  verification_hints: string[];
  nugget_tags: string[];
}

interface EnrichedTask {
  task_id: string;
  linked_entry: LinkedEntry | null;
  related_entries: RelatedEntry[];
  evidence: Evidence;
}

interface BenchmarkLink {
  task_id: string;
  linked_entry_id: string | null;
  related_entry_ids: string[];
  family: string;
  subsystems: string[];
  importance_signal: number;
  evidence_types: string[];
}

interface MoltnetCredentials {
  oauth2: { client_id: string; client_secret: string };
  endpoints: { api: string };
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const SKIP_SEARCH = args.includes('--skip-search');

// ---------------------------------------------------------------------------
// Auth — client_credentials flow from moltnet.json
// ---------------------------------------------------------------------------

async function loadCredentials(): Promise<MoltnetCredentials> {
  const credPath = join(
    REPO_ROOT,
    process.env.MOLTNET_CREDENTIALS_PATH ??
      '.moltnet/legreffier/moltnet.json',
  );
  return JSON.parse(await readFile(credPath, 'utf8'));
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(creds: MoltnetCredentials): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.oauth2.client_id,
    client_secret: creds.oauth2.client_secret,
    scope: 'diary:read diary:write',
  });

  const res = await fetch(`${creds.endpoints.api}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(
      `OAuth2 token exchange failed (${res.status}): ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedToken = data.access_token;
  // Refresh 60s before expiry
  tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return cachedToken;
}

function rateLimitFetch(
  maxRetries = 3,
): typeof globalThis.fetch {
  return async (input, init) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await globalThis.fetch(input, init);
      if (response.status !== 429) return response;

      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * 2 ** attempt, 30_000);

      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      console.error(
        `[enrich] 429 rate limited — waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries} (${url.split('/').slice(-2).join('/')})`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    // Final attempt — return whatever we get
    return globalThis.fetch(input, init);
  };
}

function initClient(creds: MoltnetCredentials): Client {
  return createClient(
    createConfig({
      baseUrl: creds.endpoints.api,
      fetch: rateLimitFetch(3),
    }),
  );
}

// ---------------------------------------------------------------------------
// Content & metadata parsing
// ---------------------------------------------------------------------------

function extractContentText(raw: string): string {
  let text = raw;
  const signedMatch = text.match(
    /<moltnet-signed>\s*<content>([\s\S]*?)<\/content>/,
  );
  if (signedMatch) {
    text = signedMatch[1];
  }
  text = text.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  text = text.replace(/<signature>[\s\S]*?<\/signature>/g, '');
  return text.trim();
}

function parseMetadataBlock(content: string): EntryMetadata {
  const result: EntryMetadata = {
    operator: null,
    tool: null,
    risk_level: null,
    branch: null,
    scopes: [],
    refs: [],
    files_changed: null,
  };

  const metaMatch = content.match(/<metadata>([\s\S]*?)<\/metadata>/);
  if (!metaMatch) return result;

  const block = metaMatch[1];
  const lines = block.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const k = line.slice(0, colonIdx).trim().toLowerCase();
    const v = line.slice(colonIdx + 1).trim();

    switch (k) {
      case 'operator':
        result.operator = v;
        break;
      case 'tool':
        result.tool = v;
        break;
      case 'risk-level':
        result.risk_level = v;
        break;
      case 'branch':
        result.branch = v;
        break;
      case 'files-changed':
        result.files_changed = parseInt(v, 10) || null;
        break;
      case 'scope':
        result.scopes = v
          .split(',')
          .map((s) => s.trim().replace(/^scope:/, ''));
        break;
      case 'refs':
        result.refs = v.split(',').map((s) => s.trim());
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// DiaryEntry → CachedEntry conversion
// ---------------------------------------------------------------------------

function toCachedEntry(entry: DiaryEntry): CachedEntry {
  const metadata = parseMetadataBlock(entry.content);
  const content = extractContentText(entry.content);

  return {
    entry_id: entry.id,
    title: entry.title ?? '',
    entry_type: entry.entryType,
    tags: entry.tags ?? [],
    importance: entry.importance,
    signed: entry.contentSignature !== null,
    created_at: entry.createdAt,
    content_excerpt: content.slice(0, 500),
    resolution_status: 'resolved',
    metadata,
  };
}

function emptyCachedEntry(
  entryId: string,
  status: 'not_found' | 'error',
): CachedEntry {
  return {
    entry_id: entryId,
    title: '',
    entry_type: '',
    tags: [],
    importance: 0,
    signed: false,
    created_at: '',
    content_excerpt: '',
    resolution_status: status,
    metadata: {
      operator: null,
      tool: null,
      risk_level: null,
      branch: null,
      scopes: [],
      refs: [],
      files_changed: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry resolution
// ---------------------------------------------------------------------------

async function resolveEntry(
  entryId: string,
  client: Client,
  creds: MoltnetCredentials,
): Promise<CachedEntry> {
  const token = await getAccessToken(creds);
  try {
    const { data, error } = await getDiaryEntryById({
      client,
      path: { entryId },
      headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
      if ('statusCode' in error && error.statusCode === 404) {
        return emptyCachedEntry(entryId, 'not_found');
      }
      throw new Error(`API error: ${JSON.stringify(error)}`);
    }

    if (!data) return emptyCachedEntry(entryId, 'error');
    return toCachedEntry(data);
  } catch (err) {
    console.error(`[enrich] Failed to resolve ${entryId}:`, err);
    return emptyCachedEntry(entryId, 'error');
  }
}

// ---------------------------------------------------------------------------
// Related entry discovery
// ---------------------------------------------------------------------------

async function searchEntries(
  client: Client,
  creds: MoltnetCredentials,
  query: string,
  entryTypes: DiaryEntry['entryType'][],
  tags?: string[],
  limit = 5,
): Promise<DiaryEntry[]> {
  const token = await getAccessToken(creds);
  try {
    const { data, error } = await searchDiary({
      client,
      body: {
        query,
        entryTypes,
        tags,
        limit,
        wRelevance: 1.0,
        wImportance: 0.2,
      },
      headers: { Authorization: `Bearer ${token}` },
    });

    if (error || !data) return [];
    return data.results;
  } catch (err) {
    console.error(`[enrich] Search failed for "${query}":`, err);
    return [];
  }
}

async function discoverRelatedEntries(
  linked: CachedEntry,
  client: Client,
  creds: MoltnetCredentials,
): Promise<RelatedEntry[]> {
  const found = new Map<string, RelatedEntry>();
  const linkedId = linked.entry_id;

  // Strategy B1: branch-based search
  const branchTag = linked.metadata.branch
    ? `branch:${linked.metadata.branch}`
    : null;
  if (branchTag) {
    const results = await searchEntries(
      client,
      creds,
      linked.title,
      ['episodic', 'semantic'],
      [branchTag],
      5,
    );
    for (const r of results) {
      if (r.id === linkedId) continue;
      if (!found.has(r.id)) {
        found.set(r.id, {
          id: r.id,
          entry_type: r.entryType,
          title: r.title ?? '',
          relation: 'same_branch',
          relevance_signal: branchTag,
        });
      }
    }
  }

  // Strategy B2: scope-based search for semantic entries
  for (const scope of linked.metadata.scopes) {
    const scopeTag = `scope:${scope}`;
    const results = await searchEntries(
      client,
      creds,
      linked.title,
      ['semantic'],
      [scopeTag],
      3,
    );
    for (const r of results) {
      if (r.id === linkedId) continue;
      // Skip low-importance bulk scan entries
      if ((r.tags ?? []).includes('source:scan') && r.importance < 5) {
        continue;
      }
      if (!found.has(r.id)) {
        found.set(r.id, {
          id: r.id,
          entry_type: r.entryType,
          title: r.title ?? '',
          relation: 'same_scope',
          relevance_signal: scopeTag,
        });
      }
    }
  }

  // Strategy B3: content-based semantic search
  const keywords = linked.title
    .replace(/^Accountable commit:\s*/, '')
    .slice(0, 100);
  if (keywords.length > 10) {
    const results = await searchEntries(
      client,
      creds,
      keywords,
      ['episodic', 'semantic'],
      undefined,
      5,
    );
    for (const r of results) {
      if (r.id === linkedId) continue;
      if ((r.tags ?? []).includes('source:scan') && r.importance < 5) continue;
      if (!found.has(r.id)) {
        found.set(r.id, {
          id: r.id,
          entry_type: r.entryType,
          title: r.title ?? '',
          relation: 'content_match',
          relevance_signal: keywords,
        });
      }
    }
  }

  // Cap at 5, prefer episodic over semantic
  const all = [...found.values()];
  all.sort((a, b) => {
    if (a.entry_type === 'episodic' && b.entry_type !== 'episodic') return -1;
    if (a.entry_type !== 'episodic' && b.entry_type === 'episodic') return 1;
    const relOrder = { same_branch: 0, same_scope: 1, content_match: 2 };
    return relOrder[a.relation] - relOrder[b.relation];
  });

  return all.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

function extractEvidence(
  linked: CachedEntry,
  relatedEntries: RelatedEntry[],
  relatedCache: Map<string, CachedEntry>,
): Evidence {
  const evidence: Evidence = {
    failure_patterns: [],
    repo_conventions: [],
    decisions: [],
    workarounds: [],
    verification_hints: [],
    nugget_tags: [],
  };

  if (linked.resolution_status !== 'resolved') return evidence;

  // From linked entry risk level
  if (
    linked.metadata.risk_level === 'high' ||
    linked.metadata.risk_level === 'medium'
  ) {
    evidence.failure_patterns.push(
      `Risk level: ${linked.metadata.risk_level} — ${linked.title.replace(/^Accountable commit:\s*/, '')}`,
    );
  }

  // From linked entry tags
  const nuggetTags = linked.tags.filter(
    (t) => t.startsWith('scope:') || t.startsWith('risk:'),
  );
  evidence.nugget_tags.push(...nuggetTags);

  // From related entries
  for (const rel of relatedEntries) {
    const cached = relatedCache.get(rel.id);
    const content = cached?.content_excerpt?.toLowerCase() ?? '';
    const title = rel.title;

    if (rel.entry_type === 'episodic') {
      if (
        content.includes('incident') ||
        content.includes('broke') ||
        content.includes('failed') ||
        content.includes('regression') ||
        content.includes('security') ||
        content.includes('authorization bypass')
      ) {
        evidence.failure_patterns.push(`Incident: ${title}`);
      }
      if (content.includes('workaround') || content.includes('work around')) {
        evidence.workarounds.push(`Workaround in: ${title}`);
      }
      if (content.includes('watch for') || content.includes('fix applied')) {
        evidence.verification_hints.push(`Verification hint from: ${title}`);
      }
    }

    if (rel.entry_type === 'semantic') {
      if (
        title.toLowerCase().includes('decision') ||
        content.includes('alternatives considered') ||
        content.includes('reason chosen')
      ) {
        evidence.decisions.push(`Decision: ${title}`);
      }
      if (
        content.includes('constraint') ||
        content.includes('must') ||
        content.includes('never') ||
        content.includes('convention')
      ) {
        evidence.repo_conventions.push(`Convention from: ${title}`);
      }
    }

    // Collect scope tags from related entries
    if (cached) {
      for (const t of cached.tags) {
        if (t.startsWith('scope:') && !evidence.nugget_tags.includes(t)) {
          evidence.nugget_tags.push(t);
        }
      }
    }
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Build enrichment record
// ---------------------------------------------------------------------------

function buildLinkedEntry(entry: CachedEntry): LinkedEntry | null {
  if (entry.resolution_status !== 'resolved') return null;
  return {
    id: entry.entry_id,
    entry_type: entry.entry_type,
    title: entry.title,
    tags: entry.tags,
    risk_level: entry.metadata.risk_level,
    refs: entry.metadata.refs,
    summary: entry.content_excerpt.slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const creds = await loadCredentials();
  const client = initClient(creds);

  // 1. Load all task records
  const taskFiles = (await readdir(TASKS_DIR)).filter(
    (f) => f.endsWith('.json') && f !== 'index.jsonl',
  );

  const tasks: TaskRecord[] = [];
  for (const file of taskFiles) {
    const raw = await readFile(join(TASKS_DIR, file), 'utf8');
    tasks.push(JSON.parse(raw));
  }

  const diaryLinked = tasks.filter((t) => t.diary_entry_ids.length > 0);
  console.error(
    `[enrich] Loaded ${tasks.length} tasks, ${diaryLinked.length} diary-linked`,
  );

  // 2. Collect unique entry IDs
  const allEntryIds = new Set<string>();
  for (const task of diaryLinked) {
    for (const id of task.diary_entry_ids) {
      allEntryIds.add(id);
    }
  }
  console.error(
    `[enrich] ${allEntryIds.size} unique diary entry IDs to resolve`,
  );

  if (DRY_RUN) {
    console.error('[enrich] Dry run — stopping before API calls');
    for (const id of allEntryIds) console.error(`[enrich]   ${id}`);
    return;
  }

  // 3. Resolve linked entries (with caching)
  await mkdir(ENTRY_CACHE_DIR, { recursive: true });
  await mkdir(ENRICHED_DIR, { recursive: true });

  const entryCache = new Map<string, CachedEntry>();

  for (const entryId of allEntryIds) {
    const cachePath = join(ENTRY_CACHE_DIR, `${entryId}.json`);

    if (!FORCE) {
      try {
        const cached: CachedEntry = JSON.parse(
          await readFile(cachePath, 'utf8'),
        );
        entryCache.set(entryId, cached);
        console.error(
          `[enrich]   CACHED ${entryId} — ${cached.title.slice(0, 60)}`,
        );
        continue;
      } catch {
        // Not cached
      }
    }

    console.error(`[enrich]   RESOLVE ${entryId}`);
    const resolved = await resolveEntry(entryId, client, creds);
    entryCache.set(entryId, resolved);
    await writeFile(cachePath, JSON.stringify(resolved, null, 2) + '\n');
    if (resolved.resolution_status === 'resolved') {
      console.error(`[enrich]     ok ${resolved.title.slice(0, 60)}`);
    } else {
      console.error(`[enrich]     FAIL ${resolved.resolution_status}`);
    }
  }

  const resolvedCount = [...entryCache.values()].filter(
    (e) => e.resolution_status === 'resolved',
  ).length;
  console.error(
    `[enrich] Resolved ${resolvedCount}/${allEntryIds.size} entries`,
  );

  // 4. For each diary-linked task: discover related, extract evidence, write
  let enrichedCount = 0;
  let withRelated = 0;
  const benchmarkLinks: BenchmarkLink[] = [];
  const relatedCache = new Map<string, CachedEntry>();

  for (const task of diaryLinked) {
    console.error(`[enrich] --- ${task.task_id}`);

    // Each task has one trailer entry (pick first)
    const primaryId = task.diary_entry_ids[0];
    const linked = entryCache.get(primaryId);
    if (!linked || linked.resolution_status !== 'resolved') {
      console.error(`[enrich]   SKIP — linked entry not resolved`);
      continue;
    }

    // Discover related entries
    let related: RelatedEntry[] = [];
    if (!SKIP_SEARCH) {
      related = await discoverRelatedEntries(linked, client, creds);
      if (related.length > 0) {
        withRelated++;
        console.error(`[enrich]   Found ${related.length} related entries`);
        for (const r of related) {
          console.error(
            `[enrich]     ${r.relation}: ${r.entry_type} — ${r.title.slice(0, 60)}`,
          );

          // Resolve related entries into cache for evidence extraction
          if (!relatedCache.has(r.id) && !entryCache.has(r.id)) {
            const cachePath = join(ENTRY_CACHE_DIR, `${r.id}.json`);
            try {
              const cached: CachedEntry = JSON.parse(
                await readFile(cachePath, 'utf8'),
              );
              relatedCache.set(r.id, cached);
            } catch {
              const resolved = await resolveEntry(r.id, client, creds);
              relatedCache.set(r.id, resolved);
              await writeFile(
                cachePath,
                JSON.stringify(resolved, null, 2) + '\n',
              );
            }
          }
        }
      } else {
        console.error(`[enrich]   No related entries found`);
      }
    }

    // Merge caches for evidence extraction
    const fullCache = new Map([...entryCache, ...relatedCache]);

    // Extract evidence
    const evidence = extractEvidence(linked, related, fullCache);

    // Build enrichment record
    const enriched: EnrichedTask = {
      task_id: task.task_id,
      linked_entry: buildLinkedEntry(linked),
      related_entries: related,
      evidence,
    };

    // Write enrichment record
    const outPath = join(ENRICHED_DIR, `${task.task_id}.json`);
    await writeFile(outPath, JSON.stringify(enriched, null, 2) + '\n');
    enrichedCount++;

    // Build benchmark link
    const allLinkedEntries = [
      linked,
      ...related
        .map((r) => fullCache.get(r.id))
        .filter((e): e is CachedEntry => e !== undefined),
    ];
    const maxImportance = Math.max(
      ...allLinkedEntries.map((e) => e.importance),
      0,
    );
    const evidenceTypes: string[] = [];
    if (evidence.failure_patterns.length > 0)
      evidenceTypes.push('failure_pattern');
    if (evidence.repo_conventions.length > 0)
      evidenceTypes.push('repo_convention');
    if (evidence.decisions.length > 0) evidenceTypes.push('decision');
    if (evidence.workarounds.length > 0) evidenceTypes.push('workaround');
    if (evidence.verification_hints.length > 0)
      evidenceTypes.push('verification_hint');

    benchmarkLinks.push({
      task_id: task.task_id,
      linked_entry_id: linked.entry_id,
      related_entry_ids: related.map((r) => r.id),
      family: task.family,
      subsystems: task.subsystems,
      importance_signal: maxImportance,
      evidence_types: evidenceTypes,
    });
  }

  // 5. Write benchmark-links
  const benchmarkLinksDoc = {
    generated_at: new Date().toISOString(),
    total_enriched: enrichedCount,
    total_with_related: withRelated,
    links: benchmarkLinks,
  };
  await writeFile(
    BENCHMARK_LINKS_FILE,
    JSON.stringify(benchmarkLinksDoc, null, 2) + '\n',
  );

  console.error(`[enrich] Done:`);
  console.error(`[enrich]   ${enrichedCount} tasks enriched`);
  console.error(`[enrich]   ${withRelated} with related entries`);
  console.error(
    `[enrich]   ${benchmarkLinks.length} benchmark links written`,
  );
}

main().catch((err) => {
  console.error('[enrich] Fatal:', err);
  process.exit(1);
});
