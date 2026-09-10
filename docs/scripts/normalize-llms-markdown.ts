import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../.vitepress/dist/', import.meta.url));

function normalizeCodeGroups(markdown: string): {
  content: string;
  groups: number;
} {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let groups = 0;
  let inCodeGroup = false;
  let fence: { character: string; length: number } | undefined;
  let skipNextBlankLine = false;

  for (const line of lines) {
    if (skipNextBlankLine) {
      skipNextBlankLine = false;
      if (line.length === 0) continue;
    }

    if (!inCodeGroup && /^::: code-group\s*$/.test(line)) {
      inCodeGroup = true;
      groups += 1;
      skipNextBlankLine = true;
      continue;
    }

    if (inCodeGroup && !fence && /^:::\s*$/.test(line)) {
      inCodeGroup = false;
      if (normalized.at(-1)?.length === 0) normalized.pop();
      continue;
    }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const [, marker, info] = fenceMatch;

      if (
        fence &&
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        info.trim().length === 0
      ) {
        fence = undefined;
      } else if (!fence) {
        fence = { character: marker[0], length: marker.length };
      }
    }

    if (inCodeGroup && fenceMatch && fence) {
      const [, marker, info] = fenceMatch;
      const labelledFence = info.match(/^([^\s]+)\s+\[([^\]]+)]\s*$/);

      if (labelledFence) {
        const [, language, label] = labelledFence;
        normalized.push(`**${label}**`, '', `${marker}${language}`);
        continue;
      }
    }

    normalized.push(line);
  }

  if (inCodeGroup) {
    throw new Error('Unterminated VitePress code group in generated Markdown');
  }

  return { content: normalized.join('\n'), groups };
}

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return extname(entry.name) === '.md' ? [path] : [];
    }),
  );
  return files.flat();
}

const files = [
  ...(await markdownFiles(distDir)),
  join(distDir, 'llms-full.txt'),
];
let normalizedGroups = 0;

for (const file of files) {
  const markdown = await readFile(file, 'utf8');
  const normalized = normalizeCodeGroups(markdown);
  normalizedGroups += normalized.groups;
  if (normalized.groups > 0) {
    await writeFile(file, normalized.content);
  }
}

await cp(join(distDir, 'llms-full.txt'), join(distDir, 'llms.txt'));

process.stdout.write(
  `Normalized ${normalizedGroups} VitePress code groups in LLM Markdown output.\n`,
);
