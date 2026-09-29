import { truncateAtLine } from './text.js';

interface Section {
  heading: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+\S/;

function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: '', body: '' };
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && HEADING.test(line)) {
      if (current.heading || current.body.trim()) sections.push(current);
      current = { heading: line.trim(), body: '' };
      continue;
    }
    current.body += `${line}\n`;
  }
  if (current.heading || current.body.trim()) sections.push(current);
  return sections;
}

function render(section: Section): string {
  return `${section.heading ? `${section.heading}\n` : ''}${section.body}`;
}

/**
 * Heading-bounded excerpt: the full outline (so the reviewer can tell a
 * section is missing) plus only the sections mentioning a search term.
 */
export function extractExcerpt(
  markdown: string,
  terms: readonly string[],
  maxBytes: number,
): string {
  const sections = splitSections(markdown);
  const headings = sections
    .map((section) => section.heading)
    .filter((heading) => heading.length > 0);
  const outline =
    headings.length > 0
      ? `Outline:\n${headings.map((heading) => `- ${heading}`).join('\n')}\n\n`
      : '';
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean);
  const matching = sections.filter((section) => {
    const text = render(section).toLowerCase();
    return needles.some((needle) => text.includes(needle));
  });
  const chosen = matching.length > 0 ? matching : sections.slice(0, 1);
  return truncateAtLine(`${outline}${chosen.map(render).join('\n')}`, maxBytes);
}
