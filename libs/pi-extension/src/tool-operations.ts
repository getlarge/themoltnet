/**
 * Gondolin tool operations: redirect pi's built-in tool operations
 * (read, write, edit, bash, ls, find, grep) to execute inside the VM.
 *
 * Follows the same pattern as upstream pi-gondolin.ts — pi's tool factories
 * accept an `operations` object that provides the underlying I/O.
 */
import path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import type {
  BashOperations,
  EditOperations,
  FindOperations,
  GrepToolDetails,
  GrepToolInput,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@earendil-works/pi-coding-agent';
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  truncateLine,
} from '@earendil-works/pi-coding-agent';

import { GUEST_TASK_SKILLS_MOUNT } from './vm-manager.js';

export type {
  BashOperations,
  EditOperations,
  FindOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
};

const DEFAULT_GREP_LIMIT = 100;
const GREP_MAX_FILE_SIZE = '2M';

type PosixPathWithGlob = typeof path.posix & {
  matchesGlob(path: string, pattern: string): boolean;
};

type TextToolResult<TDetails> = {
  content: Array<{ type: 'text'; text: string }>;
  details: TDetails | undefined;
};

function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function normalizeGuestPath(p: string): string {
  return path.posix.normalize(p.replaceAll(path.sep, path.posix.sep));
}

function isSameOrInsidePosixPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function resolveLocalPath(localCwd: string, inputPath: string): string {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(localCwd, inputPath);
}

function toHostToolPath(
  localCwd: string,
  guestWorkspace: string,
  guestPath: string,
): string {
  const normalizedGuestWorkspace = normalizeGuestPath(guestWorkspace);
  const normalizedGuestPath = normalizeGuestPath(guestPath);
  if (isSameOrInsidePosixPath(normalizedGuestPath, normalizedGuestWorkspace)) {
    const rel = path.posix.relative(
      normalizedGuestWorkspace,
      normalizedGuestPath,
    );
    return rel ? path.join(localCwd, ...rel.split('/')) : localCwd;
  }
  return normalizedGuestPath;
}

/**
 * Map a host-side absolute path to a guest-side workspace path.
 * Throws if the path escapes the workspace.
 */
export function toGuestPath(
  localCwd: string,
  localPath: string,
  guestWorkspace: string,
): string {
  const normalizedGuestWorkspace = normalizeGuestPath(guestWorkspace);
  const normalizedLocalPath = normalizeGuestPath(localPath);
  const normalizedTaskSkillsMount = normalizeGuestPath(GUEST_TASK_SKILLS_MOUNT);

  // The LLM may address files by guest-absolute path because that's what the
  // system prompt implies. Accept those as-is; otherwise path.relative(hostCwd,
  // guestPath) produces an escape and Gondolin rejects the read.
  if (isSameOrInsidePosixPath(normalizedLocalPath, normalizedGuestWorkspace)) {
    return normalizedLocalPath;
  }
  // Same accommodation for the memory-backed task-context skills mount
  // (#943 slice 1.5). pi advertises injected skills with absolute paths
  // under this mount in `<available_skills>`; the agent has to be able
  // to Read them.
  if (isSameOrInsidePosixPath(normalizedLocalPath, normalizedTaskSkillsMount)) {
    return normalizedLocalPath;
  }
  const rel = path.relative(localCwd, localPath);
  if (rel === '') return normalizedGuestWorkspace;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(normalizedGuestWorkspace, posixRel);
}

export function createGondolinReadOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): ReadOperations {
  return {
    readFile: async (p) => {
      const content = await vm.fs.readFile(
        toGuestPath(localCwd, p, guestWorkspace),
      );
      return typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : Buffer.from(content);
    },
    access: async (p) => vm.fs.access(toGuestPath(localCwd, p, guestWorkspace)),
    detectImageMimeType: async (p) => {
      try {
        const r = await vm.exec([
          '/bin/sh',
          '-lc',
          `file --mime-type -b ${shQuote(toGuestPath(localCwd, p, guestWorkspace))}`,
        ]);
        if (!r.ok) return null;
        const m = r.stdout.trim();
        return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(
          m,
        )
          ? m
          : null;
      } catch {
        return null;
      }
    },
  };
}

export function createGondolinWriteOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): WriteOperations {
  return {
    writeFile: async (p, content) => {
      const guestPath = toGuestPath(localCwd, p, guestWorkspace);
      const dir = path.posix.dirname(guestPath);
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      const r = await vm.exec([
        '/bin/sh',
        '-lc',
        [
          'set -eu',
          `mkdir -p ${shQuote(dir)}`,
          `echo ${shQuote(b64)} | base64 -d > ${shQuote(guestPath)}`,
        ].join('\n'),
      ]);
      if (!r.ok) throw new Error(`write failed (${r.exitCode}): ${r.stderr}`);
    },
    mkdir: async (dir) => {
      const r = await vm.exec([
        '/bin/mkdir',
        '-p',
        toGuestPath(localCwd, dir, guestWorkspace),
      ]);
      if (!r.ok) throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
    },
  };
}

export function createGondolinEditOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): EditOperations {
  const r = createGondolinReadOps(vm, localCwd, guestWorkspace);
  const w = createGondolinWriteOps(vm, localCwd, guestWorkspace);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

export function createGondolinLsOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): LsOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.access(toGuestPath(localCwd, p, guestWorkspace));
        return true;
      } catch {
        return false;
      }
    },
    stat: async (p) => vm.fs.stat(toGuestPath(localCwd, p, guestWorkspace)),
    readdir: async (p) =>
      vm.fs.listDir(toGuestPath(localCwd, p, guestWorkspace)),
  };
}

async function walkGuestFiles(
  vm: VM,
  root: string,
  visit: (guestPath: string, relativePath: string) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) throw new Error('Operation aborted');
  const stat = await vm.fs.stat(root, { signal });
  if (!stat.isDirectory()) {
    return visit(root, path.posix.basename(root));
  }

  const walkDirectory = async (
    dir: string,
    relativeDir: string,
  ): Promise<boolean> => {
    if (signal?.aborted) throw new Error('Operation aborted');
    const entries = await vm.fs.listDir(dir, { signal });
    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules') continue;
      const guestPath = path.posix.join(dir, entry);
      const relativePath = relativeDir
        ? path.posix.join(relativeDir, entry)
        : entry;
      let entryStat: Awaited<ReturnType<VM['fs']['stat']>>;
      try {
        entryStat = await vm.fs.stat(guestPath, { signal });
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        if (!(await walkDirectory(guestPath, relativePath))) return false;
      } else if (!(await visit(guestPath, relativePath))) {
        return false;
      }
    }
    return true;
  };

  return walkDirectory(root, '');
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  return (path.posix as PosixPathWithGlob).matchesGlob(relativePath, pattern);
}

function matchesToolGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeGuestPath(pattern);
  if (normalizedPattern.includes('/')) {
    return (
      matchesGlob(relativePath, normalizedPattern) ||
      matchesGlob(relativePath, `**/${normalizedPattern}`)
    );
  }
  return matchesGlob(path.posix.basename(relativePath), normalizedPattern);
}

export function createGondolinFindOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): FindOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.access(toGuestPath(localCwd, p, guestWorkspace));
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, cwd, options) => {
      const root = toGuestPath(localCwd, cwd, guestWorkspace);
      const results: string[] = [];
      await walkGuestFiles(vm, root, (guestPath, relativePath) => {
        if (results.length >= options.limit) return Promise.resolve(false);
        if (
          options.ignore.some((ignore) => matchesToolGlob(relativePath, ignore))
        ) {
          return Promise.resolve(true);
        }
        if (matchesToolGlob(relativePath, pattern)) {
          results.push(toHostToolPath(localCwd, guestWorkspace, guestPath));
        }
        return Promise.resolve(results.length < options.limit);
      });
      return results;
    },
  };
}

function appendGrepBlock(params: {
  outputLines: string[];
  lines: string[];
  relativePath: string;
  lineIndex: number;
  contextLines: number;
}): boolean {
  let linesTruncated = false;
  const start =
    params.contextLines > 0
      ? Math.max(0, params.lineIndex - params.contextLines)
      : params.lineIndex;
  const end =
    params.contextLines > 0
      ? Math.min(
          params.lines.length - 1,
          params.lineIndex + params.contextLines,
        )
      : params.lineIndex;

  for (let index = start; index <= end; index++) {
    const rawLine = params.lines[index] ?? '';
    const { text, wasTruncated } = truncateLine(rawLine.replace(/\r/g, ''));
    if (wasTruncated) linesTruncated = true;
    const separator = index === params.lineIndex ? ':' : '-';
    params.outputLines.push(
      `${params.relativePath}${separator}${index + 1}${separator} ${text}`,
    );
  }
  return linesTruncated;
}

interface RgMatch {
  guestPath: string;
  lineNumber: number;
  lineText?: string;
}

function parseRgJsonLines(params: {
  chunk: string;
  carry: string;
  matches: RgMatch[];
  effectiveLimit: number;
}): { carry: string; limitReached: boolean } {
  const parts = `${params.carry}${params.chunk}`.split('\n');
  const carry = parts.pop() ?? '';
  let limitReached = false;
  for (const line of parts) {
    if (!line.trim() || params.matches.length >= params.effectiveLimit) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const candidate = event as {
      type?: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
      };
    };
    if (candidate.type !== 'match') continue;
    const guestPath = candidate.data?.path?.text;
    const lineNumber = candidate.data?.line_number;
    if (!guestPath || typeof lineNumber !== 'number') continue;
    params.matches.push({
      guestPath,
      lineNumber,
      lineText: candidate.data?.lines?.text,
    });
    if (params.matches.length >= params.effectiveLimit) {
      limitReached = true;
      break;
    }
  }
  return { carry, limitReached };
}

async function readGuestLines(
  vm: VM,
  guestPath: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const content = await vm.fs.readFile(guestPath, {
      encoding: 'utf8',
      signal,
    });
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  } catch {
    return [];
  }
}

export async function executeGondolinGrep(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
  params: GrepToolInput,
  signal?: AbortSignal,
): Promise<TextToolResult<GrepToolDetails>> {
  const root = toGuestPath(
    localCwd,
    resolveLocalPath(localCwd, params.path ?? '.'),
    guestWorkspace,
  );
  let rootStat: Awaited<ReturnType<VM['fs']['stat']>>;
  try {
    rootStat = await vm.fs.stat(root, { signal });
  } catch {
    throw new Error(
      `Path not found: ${resolveLocalPath(localCwd, params.path ?? '.')}`,
    );
  }
  const rootIsDirectory = rootStat.isDirectory();
  const contextLines =
    params.context && params.context > 0 ? params.context : 0;
  const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
  const args = [
    '--json',
    '--line-number',
    '--color=never',
    '--hidden',
    '--max-filesize',
    GREP_MAX_FILE_SIZE,
  ];
  if (params.ignoreCase) args.push('--ignore-case');
  if (params.literal) args.push('--fixed-strings');
  if (params.glob) args.push('--glob', params.glob);
  args.push('--', params.pattern, root);

  const outputLines: string[] = [];
  const details: GrepToolDetails = {};
  const matches: RgMatch[] = [];
  let matchLimitReached = false;
  let linesTruncated = false;
  let stderr = '';
  let carry = '';
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const proc = vm.exec(['/bin/rg', ...args], {
      signal: ac.signal,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    for await (const chunk of proc.output()) {
      const text =
        typeof chunk.data === 'string'
          ? chunk.data
          : Buffer.from(chunk.data).toString('utf8');
      if ((chunk as { stream?: string }).stream === 'stderr') {
        stderr += text;
        continue;
      }
      const parsed = parseRgJsonLines({
        chunk: text,
        carry,
        matches,
        effectiveLimit,
      });
      carry = parsed.carry;
      if (parsed.limitReached) {
        matchLimitReached = true;
        ac.abort();
        break;
      }
    }

    const r = await proc;
    if (
      !signal?.aborted &&
      !matchLimitReached &&
      r.exitCode !== 0 &&
      r.exitCode !== 1
    ) {
      throw new Error(
        stderr.trim() || `ripgrep exited with code ${r.exitCode}`,
      );
    }
  } catch (err) {
    if (signal?.aborted) throw new Error('Operation aborted');
    if (matchLimitReached) {
      // Expected when we abort ripgrep after collecting the requested limit.
    } else {
      throw err;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (matches.length === 0) {
    return {
      content: [{ type: 'text', text: 'No matches found' }],
      details: undefined,
    };
  }

  const fileCache = new Map<string, string[]>();
  for (const match of matches) {
    if (signal?.aborted) throw new Error('Operation aborted');
    const displayPath = rootIsDirectory
      ? path.posix.relative(root, match.guestPath)
      : path.posix.basename(match.guestPath);
    if (contextLines === 0 && match.lineText !== undefined) {
      const { text, wasTruncated } = truncateLine(
        match.lineText
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '')
          .replace(/\n$/, ''),
      );
      if (wasTruncated) linesTruncated = true;
      outputLines.push(`${displayPath}:${match.lineNumber}: ${text}`);
      continue;
    }
    let lines = fileCache.get(match.guestPath);
    if (!lines) {
      lines = await readGuestLines(vm, match.guestPath, signal);
      fileCache.set(match.guestPath, lines);
    }
    if (lines.length === 0) {
      outputLines.push(
        `${displayPath}:${match.lineNumber}: (unable to read file)`,
      );
      continue;
    }
    if (
      appendGrepBlock({
        outputLines,
        lines,
        relativePath: displayPath,
        lineIndex: match.lineNumber - 1,
        contextLines,
      })
    ) {
      linesTruncated = true;
    }
  }

  const rawOutput = outputLines.join('\n');
  const truncation = truncateHead(rawOutput, {
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  const notices: string[] = [];
  let output = truncation.content;

  if (matchLimitReached) {
    details.matchLimitReached = effectiveLimit;
    notices.push(`${effectiveLimit} matches limit reached`);
  }
  if (linesTruncated) {
    details.linesTruncated = true;
    notices.push('long lines truncated');
  }
  if (truncation.truncated) {
    details.truncation = truncation;
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }
  if (notices.length > 0) output += `\n\n[${notices.join('. ')}]`;

  return {
    content: [{ type: 'text', text: output }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}

export function createGondolinBashOps(
  vm: VM,
  localCwd: string,
  guestWorkspace: string,
): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = toGuestPath(localCwd, cwd, guestWorkspace);
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              ac.abort();
            }, timeout * 1000)
          : undefined;

      try {
        // Do not forward host env to guest — the VM has its own env set at
        // resume time. Forwarding leaks host-specific paths (GOROOT, PATH, etc).
        void env;

        const proc = vm.exec(['/bin/sh', '-lc', command], {
          cwd: guestCwd,
          signal: ac.signal,
          stdout: 'pipe',
          stderr: 'pipe',
        });

        for await (const chunk of proc.output()) {
          const buf =
            typeof chunk.data === 'string'
              ? Buffer.from(chunk.data, 'utf8')
              : chunk.data;
          onData(buf);
        }

        const r = await proc;
        return { exitCode: r.exitCode };
      } catch (err) {
        if (signal?.aborted) throw new Error('aborted');
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
