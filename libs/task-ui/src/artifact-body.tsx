import { Button, CodeBlock, useTheme } from '@themoltnet/design-system';
import { type ReactNode, useId, useState } from 'react';

/**
 * Readable preview for an artifact's inline `body`.
 *
 * Handles the shapes agents actually emit — prose, lightweight markdown
 * (headings, ordered/bulleted lists, fenced code), and JSON lists — without
 * pulling a markdown dependency into the task UI. Everything renders as
 * text nodes; nothing is interpreted as HTML.
 */

type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ordered' | 'bulleted'; items: ListItem[] }
  | { type: 'code'; text: string };

interface ListItem {
  primary: string;
  secondary?: string;
}

const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BULLETED = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseReadableBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const pushItem = (type: 'ordered' | 'bulleted', text: string) => {
    const last = blocks.at(-1);
    if (last?.type === type) last.items.push({ primary: text });
    else blocks.push({ type, items: [{ primary: text }] });
  };

  for (const line of lines) {
    if (code) {
      if (FENCE.test(line)) {
        blocks.push({ type: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (FENCE.test(line)) {
      flushParagraph();
      code = [];
      continue;
    }
    const heading = HEADING.exec(line);
    const ordered = ORDERED.exec(line);
    const bulleted = BULLETED.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', text: heading[1] });
    } else if (ordered) {
      flushParagraph();
      pushItem('ordered', ordered[1]);
    } else if (bulleted) {
      flushParagraph();
      pushItem('bulleted', bulleted[1]);
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      const last = blocks.at(-1);
      // An indented continuation line belongs to the preceding list item.
      if (
        paragraph.length === 0 &&
        /^\s{2,}\S/.test(line) &&
        (last?.type === 'ordered' || last?.type === 'bulleted')
      ) {
        const item = last.items[last.items.length - 1];
        item.secondary = item.secondary
          ? `${item.secondary} ${line.trim()}`
          : line.trim();
      } else {
        paragraph.push(line.trim());
      }
    }
  }
  if (code) blocks.push({ type: 'code', text: code.join('\n') });
  flushParagraph();
  return blocks;
}

const PRIMARY_KEYS = [
  'statement',
  'requirement',
  'finding',
  'title',
  'text',
  'summary',
  'name',
];
const SECONDARY_KEYS = ['detail', 'description', 'rationale', 'note'];

/** Reads a JSON list of strings or labelled objects into list items. */
export function readJsonList(body: string): ListItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const list =
    Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null
      ? parsed
      : Object.values(parsed).find(Array.isArray);
  if (!Array.isArray(list) || list.length === 0) return null;

  const items: ListItem[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      items.push({ primary: entry });
      continue;
    }
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const primaryKey = PRIMARY_KEYS.find(
      (key) => typeof record[key] === 'string',
    );
    if (!primaryKey) return null;
    const secondaryKey = SECONDARY_KEYS.find(
      (key) => key !== primaryKey && typeof record[key] === 'string',
    );
    items.push({
      primary: record[primaryKey] as string,
      secondary: secondaryKey ? (record[secondaryKey] as string) : undefined,
    });
  }
  return items;
}

function isCodeLike(contentType?: string, kind?: string) {
  const type = contentType?.toLowerCase() ?? '';
  return (
    /diff|patch|x-sh|javascript|typescript|x-python|yaml|toml|xml/.test(type) ||
    /^(diff|patch|code|log)$/i.test(kind ?? '')
  );
}

function isJsonLike(body: string, contentType?: string) {
  if (contentType?.toLowerCase().includes('json')) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('[') || trimmed.startsWith('{');
}

/** Renders `**strong**` and `` `code` `` spans as text nodes. */
function InlineText({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={index} style={{ fontWeight: 600 }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={index}
              style={{
                fontFamily: theme.font.family.mono,
                fontSize: '0.9em',
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}

function ListBlock({
  ordered,
  items,
}: {
  ordered: boolean;
  items: ListItem[];
}) {
  const theme = useTheme();
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag
      style={{
        margin: 0,
        paddingLeft: theme.spacing[6],
        display: 'grid',
        gap: theme.spacing[3],
      }}
    >
      {items.map((item, index) => (
        <li key={index} style={{ paddingLeft: theme.spacing[1] }}>
          <span style={{ color: theme.color.text.DEFAULT }}>
            <InlineText text={item.primary} />
          </span>
          {item.secondary ? (
            <span
              style={{
                display: 'block',
                marginTop: theme.spacing[1],
                color: theme.color.text.secondary,
                fontSize: theme.font.size.sm,
              }}
            >
              <InlineText text={item.secondary} />
            </span>
          ) : null}
        </li>
      ))}
    </Tag>
  );
}

function ReadableBlocks({ blocks }: { blocks: Block[] }) {
  const theme = useTheme();
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <p
                key={index}
                style={{
                  margin: 0,
                  fontWeight: theme.font.weight.semibold,
                  color: theme.color.text.DEFAULT,
                }}
              >
                <InlineText text={block.text} />
              </p>
            );
          case 'paragraph':
            return (
              <p key={index} style={{ margin: 0 }}>
                <InlineText text={block.text} />
              </p>
            );
          case 'ordered':
          case 'bulleted':
            return (
              <ListBlock
                key={index}
                ordered={block.type === 'ordered'}
                items={block.items}
              />
            );
          case 'code':
            return (
              <CodeBlock key={index} style={{ overflow: 'auto' }}>
                {block.text}
              </CodeBlock>
            );
        }
      })}
    </>
  );
}

export interface ArtifactBodyProps {
  body: string;
  contentType?: string;
  kind?: string;
  /** Characters above which the preview starts collapsed. */
  collapseAfter?: number;
}

export function ArtifactBody({
  body,
  contentType,
  kind,
  collapseAfter = 1400,
}: ArtifactBodyProps) {
  const theme = useTheme();
  const regionId = useId();
  const isLong = body.length > collapseAfter;
  const [expanded, setExpanded] = useState(false);
  const collapsed = isLong && !expanded;

  let content: ReactNode;
  if (isCodeLike(contentType, kind)) {
    content = <CodeBlock style={{ overflow: 'auto' }}>{body}</CodeBlock>;
  } else if (isJsonLike(body, contentType)) {
    const items = readJsonList(body);
    content = items ? (
      <ListBlock ordered items={items} />
    ) : (
      <CodeBlock language="json" style={{ overflow: 'auto' }}>
        {prettyJson(body)}
      </CodeBlock>
    );
  } else {
    content = <ReadableBlocks blocks={parseReadableBlocks(body)} />;
  }

  return (
    <div>
      <div
        id={regionId}
        style={{
          display: 'grid',
          gap: theme.spacing[3],
          maxWidth: '72ch',
          color: theme.color.text.secondary,
          fontSize: theme.font.size.md,
          lineHeight: theme.font.lineHeight.relaxed,
          overflowWrap: 'anywhere',
          ...(collapsed
            ? {
                maxHeight: '18rem',
                overflow: 'hidden',
                maskImage:
                  'linear-gradient(to bottom, black 70%, transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to bottom, black 70%, transparent 100%)',
              }
            : null),
        }}
      >
        {content}
      </div>
      {isLong ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((value) => !value)}
          style={{ marginTop: theme.spacing[2] }}
        >
          {expanded ? 'Show less' : 'Show the full artifact'}
        </Button>
      ) : null}
    </div>
  );
}

function prettyJson(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
