/**
 * Pi-owned pack-to-docs transformation.
 *
 * Applies the "Phase 6" rendering method from
 * .agents/skills/legreffier-explore/SKILL.md to an expanded source pack and
 * produces an opinionated markdown document suitable for direct agent
 * consumption.
 *
 * Kept separate from `tools.ts` so the transformer can be unit-tested in
 * isolation and so the tool file stays focused on wiring.
 */

export interface PackEntry {
  entryId: string;
  entryCidSnapshot: string;
  compressionLevel: 'full' | 'summary' | 'keywords';
  originalTokens: number | null;
  packedTokens: number | null;
  entry: {
    title: string | null;
    content: string;
    tags: string[] | null;
    entryType: string;
    creator: {
      fingerprint: string;
    } | null;
  };
}

export interface ExpandedPack {
  id: string;
  packCid: string;
  createdAt: string;
  entries?: PackEntry[];
}

function slugToTitle(value: string) {
  return value
    .split(/[:/_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function extractScope(tags: string[] | null | undefined) {
  const scope = tags?.find((tag) => tag.startsWith('scope:'));
  return scope ? scope.slice('scope:'.length) : null;
}

function extractSeverity(tags: string[] | null | undefined) {
  const severity = tags?.find((tag) => tag.startsWith('severity:'));
  return severity ? severity.slice('severity:'.length) : null;
}

function stripEntryScaffolding(content: string) {
  let out = content;

  // Unwrap signed envelopes: keep the inner <content> body, drop metadata
  // and the base64 signature blob entirely. Signed entries store the full
  // envelope (<moltnet-signed><content>...</content><metadata>...</metadata>
  // <signature>base64==</signature></moltnet-signed>) inside the entry
  // `content` column, so the renderer must reduce it to the prose body.
  out = out.replace(
    /<moltnet-signed>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/moltnet-signed>/gi,
    '$1',
  );

  // Drop metadata blocks (both the skill-managed <metadata>...</metadata>
  // trailer and any stray ones left behind by signed-envelope unwrapping).
  out = out.replace(/<metadata>[\s\S]*?<\/metadata>/gi, '');

  // Drop orphaned signature blocks (base64 body included) if any survived
  // the envelope unwrap — e.g. truncated or malformed signed entries.
  out = out.replace(/<signature>[\s\S]*?<\/signature>/gi, '');

  // Strip any remaining stray tags from the known envelope vocabulary.
  out = out.replace(
    /<\/?(?:moltnet-signed|content|signature|metadata)[^>]*>/gi,
    '',
  );

  // Legacy packed-pack footers.
  out = out.replace(/^- Compression:.*$/gim, '');
  out = out.replace(/^- Tokens:.*$/gim, '');

  return out.trim();
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractRules(content: string) {
  return stripEntryScaffolding(content)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        (/(^rule:|^watch for:|^must\b|^never\b)/i.test(line) ||
          /\b(MUST|NEVER)\b/.test(line)),
    )
    .slice(0, 5);
}

function renderSourceRefs(entries: PackEntry[]) {
  return entries
    .map((entry) => {
      const shortId = entry.entryId.slice(0, 8);
      const fingerprint = entry.entry.creator?.fingerprint
        ?.replaceAll('-', '')
        .slice(0, 4)
        .toLowerCase();
      const agentRef = fingerprint ? `agent:${fingerprint}` : 'agent:unkn';
      return `[\`e:${shortId}\`](@unknown · ${agentRef})`;
    })
    .join(', ');
}

function renderKeywords(tags: string[] | null | undefined) {
  const keywords = (tags ?? []).filter(
    (tag) => !tag.startsWith('scope:') && !tag.startsWith('severity:'),
  );
  if (keywords.length === 0) return '';
  return `Relevant search terms include ${keywords
    .slice(0, 6)
    .map((tag) => `\`${tag}\``)
    .join(', ')}.`;
}

export function renderPhase6Markdown(pack: ExpandedPack): string {
  const entries = pack.entries ?? [];
  const grouped = new Map<
    string,
    Map<string, { title: string; scope: string; entries: PackEntry[] }>
  >();

  for (const entry of entries) {
    const scope = extractScope(entry.entry.tags) ?? 'general';
    const title =
      entry.entry.title?.trim() || `Entry ${entry.entryId.slice(0, 8)}`;
    const groupKey = normalizeKey(scope);
    const topicKey = normalizeKey(title) || entry.entryId;

    if (!grouped.has(groupKey)) grouped.set(groupKey, new Map());
    const topics = grouped.get(groupKey)!;
    const existing = topics.get(topicKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      topics.set(topicKey, { title, scope, entries: [entry] });
    }
  }

  const lines: string[] = [];
  lines.push('# Rendered Pack');
  lines.push('');
  lines.push('## Source');
  lines.push('');
  lines.push('| Pack UUID | Pack CID | Entries |');
  lines.push('| --------- | -------- | ------- |');
  lines.push(`| \`${pack.id}\` | \`${pack.packCid}\` | ${entries.length} |`);
  lines.push('');

  for (const [, topics] of grouped) {
    const firstTopic = topics.values().next().value as
      | { scope: string }
      | undefined;
    const scope = firstTopic?.scope ?? 'general';
    lines.push(`## ${slugToTitle(scope)}`);
    lines.push('');

    for (const [, topic] of topics) {
      const primary = topic.entries[0];
      const mergedContent = topic.entries
        .map((entry) => stripEntryScaffolding(entry.entry.content))
        .filter(Boolean)
        .join('\n\n');
      const rules = topic.entries.flatMap((entry) =>
        extractRules(entry.entry.content),
      );
      const severity = extractSeverity(primary.entry.tags);

      lines.push(`### ${topic.title}`);
      lines.push('');
      lines.push(`**Subsystem:** ${slugToTitle(topic.scope)}`);
      if (severity) lines.push(`**Severity:** ${slugToTitle(severity)}`);
      lines.push(`**Type:** ${primary.entry.entryType}`);
      lines.push('');
      if (rules.length > 0) {
        lines.push('**Rules**');
        lines.push('');
        for (const rule of Array.from(new Set(rules))) {
          lines.push(`- ${rule}`);
        }
        lines.push('');
      }
      lines.push(mergedContent);
      lines.push('');
      const keywords = renderKeywords(primary.entry.tags);
      if (keywords) {
        lines.push(keywords);
        lines.push('');
      }
      lines.push('Provenance:');
      for (const entry of topic.entries) {
        lines.push(
          `- Entry ID \`${entry.entryId}\`, CID \`${entry.entryCidSnapshot}\``,
        );
      }
      lines.push('');
      lines.push(`*Sources: ${renderSourceRefs(topic.entries)}*`);
      lines.push('');
    }
  }

  if (entries.length === 0) {
    lines.push('_This pack has no expanded entries._');
    lines.push('');
  }

  return lines.join('\n').trim();
}
