import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { Context } from '@earendil-works/chord/context';
import type { VM } from '@earendil-works/gondolin';
import {
  type BinaryReader,
  type DirReader,
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
  type FileWatcher,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
} from '@earendil-works/pi-durable/env';
import { execManagedCommand } from '@themoltnet/sandbox-gondolin';

import {
  createGondolinToolLifecycle,
  type GondolinToolLifecycle,
} from './tool-operations.js';

/** Spilled output is appended in batches of at least this many bytes. */
const SPILL_FLUSH_BYTES = 64 * 1024;
/** Keeps generated temp names well inside guest filename limits. */
const MAX_TEMP_NAME_LENGTH = 80;

export interface GondolinDurableEnvOptions {
  /** Ends every guest operation, for example when the writer lease is lost. */
  lifetime?: AbortSignal;
  lifecycle?: GondolinToolLifecycle;
  /**
   * Guest directories that paths may address. Defaults to `cwd`. Temp paths
   * this env creates are always allowed.
   */
  roots?: readonly string[];
}

function isSameOrInside(path: string, root: string) {
  return root === '/' || path === root || path.startsWith(`${root}/`);
}

/** All filesystem and shell operations target the guest; none access host paths. */
export class GondolinDurableEnv implements ExecutionEnv {
  private readonly temporary = new Set<string>();
  private readonly lifetime?: AbortSignal;
  private readonly lifecycle: GondolinToolLifecycle;
  private readonly roots: readonly string[];
  constructor(
    readonly vm: VM,
    readonly id: string,
    public cwd: string,
    options: GondolinDurableEnvOptions = {},
  ) {
    this.lifetime = options.lifetime;
    this.lifecycle = options.lifecycle ?? createGondolinToolLifecycle();
    this.roots = (options.roots ?? [cwd]).map((root) => posix.resolve(root));
  }

  // Gondolin does not expose stable file/directory handles or filesystem
  // notifications. Keep these capabilities explicit: our guest read/search
  // tools remain available, while extensions must handle not_supported.
  async openBinaryReader(
    ..._args: Parameters<ExecutionEnv['openBinaryReader']>
  ): Promise<Result<BinaryReader, FileError>> {
    return err(
      new FileError('not_supported', 'Guest binary handles are unavailable'),
    );
  }
  async openDirReader(
    ..._args: Parameters<ExecutionEnv['openDirReader']>
  ): Promise<Result<DirReader, FileError>> {
    return err(
      new FileError('not_supported', 'Guest directory handles are unavailable'),
    );
  }
  async watch(
    ..._args: Parameters<ExecutionEnv['watch']>
  ): Promise<Result<FileWatcher, FileError>> {
    return err(
      new FileError(
        'not_supported',
        'Guest filesystem watching is unavailable',
      ),
    );
  }

  /**
   * Resolves `path` against `cwd` and rejects anything outside the allowed
   * roots. The check is lexical, like the workspace mapping of the session
   * tools.
   */
  private resolve(path: string): string {
    const resolved = posix.resolve(this.cwd, path);
    const allowed = [...this.roots, ...this.temporary].some((root) =>
      isSameOrInside(resolved, root),
    );
    if (!allowed)
      throw Object.assign(
        new Error(`Path is outside the task workspace: ${path}`),
        { code: 'EACCES' },
      );
    return resolved;
  }

  private options(context: Context) {
    return {
      cwd: this.cwd,
      signal: this.lifetime
        ? AbortSignal.any([
            this.lifetime,
            ...(context.abortSignal ? [context.abortSignal] : []),
          ])
        : context.abortSignal,
    };
  }
  private async file<T>(
    path: string,
    context: Context,
    operation: () => Promise<T>,
  ): Promise<Result<T, FileError>> {
    try {
      context.abortSignal?.throwIfAborted();
      this.lifetime?.throwIfAborted();
      this.lifecycle.assertActive();
      return ok(await operation());
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      const mapped =
        context.abortSignal?.aborted || this.lifetime?.aborted
          ? 'aborted'
          : code === 'ENOENT'
            ? 'not_found'
            : code === 'EACCES'
              ? 'permission_denied'
              : code === 'ENOTDIR'
                ? 'not_directory'
                : 'unknown';
      return err(
        new FileError(
          mapped,
          cause instanceof Error ? cause.message : String(cause),
          path,
        ),
      );
    }
  }
  private async command(argv: string[], context: Context): Promise<string> {
    const result = await this.vm.exec(argv, this.options(context));
    if (!result.ok)
      throw new Error(
        result.stderr || `Guest command exited ${result.exitCode}`,
      );
    return result.stdout;
  }
  absolutePath(path: string, context: Context) {
    return this.file(path, context, async () => this.resolve(path));
  }
  joinPath(parts: string[], context: Context) {
    return this.file(parts.join('/'), context, async () =>
      posix.join(...parts),
    );
  }
  readTextFile(path: string, context: Context) {
    return this.file(path, context, () =>
      this.vm.fs.readFile(this.resolve(path), {
        ...this.options(context),
        encoding: 'utf8',
      }),
    );
  }
  readBinaryFile(path: string, context: Context) {
    return this.file<Uint8Array>(path, context, () =>
      this.vm.fs.readFile(this.resolve(path), this.options(context)),
    );
  }
  writeFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, () =>
      this.vm.fs.writeFile(this.resolve(path), content, this.options(context)),
    );
  }
  appendFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, async () => {
      const result = await this.vm.exec(
        ['/bin/sh', '-c', 'cat >> "$1"', 'append', this.resolve(path)],
        { ...this.options(context), stdin: Buffer.from(content) },
      );
      if (!result.ok) throw new Error(result.stderr);
    });
  }
  truncateFile(path: string, size: number, context: Context) {
    return this.file(path, context, async () => {
      if (!Number.isSafeInteger(size) || size < 0)
        throw new Error('Invalid file size');
      await this.command(
        ['truncate', '-s', String(size), '--', this.resolve(path)],
        context,
      );
    });
  }
  flushFile(path: string, context: Context) {
    return this.file(path, context, async () => {
      await this.command(['sync', '-f', '--', this.resolve(path)], context);
    });
  }
  renameFile(source: string, destination: string, context: Context) {
    return this.file(source, context, () =>
      this.vm.fs.rename(
        this.resolve(source),
        this.resolve(destination),
        this.options(context),
      ),
    );
  }
  fileInfo(path: string, context: Context) {
    return this.file<FileInfo>(path, context, async () => {
      const resolved = this.resolve(path);
      const stat = await this.vm.fs.stat(resolved, this.options(context));
      return {
        name: posix.basename(resolved),
        path: resolved,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        kind: stat.isDirectory()
          ? 'directory'
          : stat.isSymbolicLink()
            ? 'symlink'
            : 'file',
      };
    });
  }
  listDir(path: string, context: Context) {
    return this.file(path, context, async () => {
      const directory = this.resolve(path);
      const names = await this.vm.fs.listDir(directory, this.options(context));
      const entries: FileInfo[] = [];
      for (const name of names) {
        const result = await this.fileInfo(
          posix.join(directory, name),
          context,
        );
        if (!result.ok) throw result.error;
        entries.push(result.value);
      }
      return entries;
    });
  }
  canonicalPath(path: string, context: Context) {
    return this.file(path, context, async () =>
      (
        await this.command(['realpath', '--', this.resolve(path)], context)
      ).replace(/\n$/, ''),
    );
  }
  exists(path: string, context: Context) {
    return this.file(path, context, async () => {
      try {
        await this.vm.fs.access(this.resolve(path), this.options(context));
        return true;
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return false;
        throw error;
      }
    });
  }
  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ) {
    return this.file(path, context, () =>
      this.vm.fs.mkdir(this.resolve(path), {
        ...this.options(context),
        ...options,
      }),
    );
  }
  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ) {
    return this.file(path, context, () =>
      this.vm.fs.deleteFile(this.resolve(path), {
        ...this.options(context),
        ...options,
      }),
    );
  }
  private safeName(value: string) {
    return value
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(0, MAX_TEMP_NAME_LENGTH);
  }
  createTempDir(prefix: string | undefined, context: Context) {
    return this.file('/tmp', context, async () => {
      const path = (
        await this.command(
          ['mktemp', '-d', `/tmp/${this.safeName(prefix ?? 'pi-')}.XXXXXX`],
          context,
        )
      ).trim();
      this.temporary.add(path);
      return path;
    });
  }
  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ) {
    return this.file('/tmp', context, async () => {
      const path = (
        await this.command(
          ['mktemp', `/tmp/${this.safeName(options?.prefix ?? 'pi-')}.XXXXXX`],
          context,
        )
      ).trim();
      const target = `${path}${this.safeName(options?.suffix ?? '')}`;
      if (target !== path)
        await this.vm.fs.rename(path, target, this.options(context));
      this.temporary.add(target);
      return target;
    });
  }
  openTextLineReader(
    path: string,
    context: Context,
  ): Promise<Result<TextLineReader, FileError>> {
    return this.file(path, context, async () => {
      const stream = await this.vm.fs.readFileStream(
        this.resolve(path),
        this.options(context),
      );
      stream.setEncoding('utf8');
      const iterator = stream[Symbol.asyncIterator]();
      let buffer = '';
      let done = false;
      let closed = false;
      return {
        readLine: (ctx) =>
          this.file(path, ctx, async () => {
            if (closed) throw new Error('Line reader is closed');
            while (!buffer.includes('\n') && !done) {
              const next = await iterator.next();
              done = !!next.done;
              if (!done) buffer += String(next.value);
            }
            const newline = buffer.indexOf('\n');
            if (newline >= 0) {
              const text = buffer.slice(0, newline);
              buffer = buffer.slice(newline + 1);
              return { text, terminated: true };
            }
            if (buffer) {
              const text = buffer;
              buffer = '';
              return { text, terminated: false };
            }
            return undefined;
          }),
        close: async () => {
          closed = true;
          stream.destroy();
        },
      };
    });
  }
  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    const reader = await this.openTextLineReader(path, context);
    if (!reader.ok) return reader;
    const lines: string[] = [];
    try {
      while (lines.length < (options?.maxLines ?? Infinity)) {
        const line = await reader.value.readLine(context);
        if (!line.ok) return line;
        if (!line.value) break;
        lines.push(line.value.text);
      }
      return ok(lines);
    } finally {
      await reader.value.close(context);
    }
  }
  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    if (this.lifecycle.getRetirement())
      return err(
        new ExecutionError('spawn_error', 'Gondolin environment is retired'),
      );
    if (
      options?.timeout !== undefined &&
      (!Number.isFinite(options.timeout) || options.timeout <= 0)
    )
      return err(new ExecutionError('timeout', 'Invalid timeout'));
    // Explicit env belongs to the guest. Host environment is never inherited.
    const decoders = {
      stdout: new StringDecoder('utf8'),
      stderr: new StringDecoder('utf8'),
    };
    let bytes = 0;
    let lines = 0;
    let buffered: string[] = [];
    let pendingBytes = 0;
    let spillPath: string | undefined;
    let endsWithNewline = true;
    // One guest process per append is expensive, so spilled output is
    // written in batches and flushed once more when the command ends.
    const flush = async () => {
      if (!spillPath || buffered.length === 0) return;
      const text = buffered.join('');
      buffered = [];
      pendingBytes = 0;
      const appended = await this.appendFile(spillPath, text, context);
      if (!appended.ok) throw appended.error;
    };
    const output = async (text: string, stream: 'stdout' | 'stderr') => {
      options?.onOutput?.(text, context, { stream });
      if (!options?.spill) return;
      bytes += Buffer.byteLength(text);
      lines += text.split('\n').length - 1;
      if (text) endsWithNewline = text.endsWith('\n');
      buffered.push(text);
      if (
        !spillPath &&
        bytes <= options.spill.afterBytes &&
        lines + (endsWithNewline ? 0 : 1) <= options.spill.afterLines
      )
        return;
      if (!spillPath) {
        const file = await this.createTempFile(
          { prefix: 'pi-output-' },
          context,
        );
        if (!file.ok) throw file.error;
        spillPath = file.value;
        const initial = await this.writeFile(
          spillPath,
          buffered.join(''),
          context,
        );
        if (!initial.ok) throw initial.error;
        buffered = [];
        return;
      }
      pendingBytes += Buffer.byteLength(text);
      if (pendingBytes >= SPILL_FLUSH_BYTES) await flush();
    };
    let cwd: string;
    try {
      cwd = this.resolve(options?.cwd ?? this.cwd);
    } catch (error) {
      return err(
        new ExecutionError(
          'spawn_error',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    try {
      const result = await execManagedCommand(this.vm, command, {
        cwd,
        env: options?.env,
        signal: this.options(context).signal,
        // Durable timeouts are in seconds; the Gondolin primitive takes ms.
        timeoutMs: options?.timeout ? options.timeout * 1000 : undefined,
        onData: (chunk, stream) =>
          output(decoders[stream].write(chunk), stream),
      });
      if (
        result.termination.status === 'backend-retired' ||
        result.termination.status === 'recovery-required'
      )
        this.lifecycle.markRetired({
          backendRetired: result.termination.status === 'backend-retired',
          reason:
            result.termination.status === 'backend-retired'
              ? 'backend-retired'
              : result.termination.reason,
          trigger: result.timedOut ? 'timeout' : 'cancellation',
        });
      if (result.timedOut || result.cancelled) {
        // Best effort: the guest may already be gone after a cancellation.
        await flush().catch(() => {});
        const interrupted = new ExecutionError(
          result.timedOut ? 'timeout' : 'aborted',
          'Guest execution interrupted',
        );
        if (spillPath) interrupted.spillPath = spillPath;
        return err(interrupted);
      }
      for (const stream of ['stdout', 'stderr'] as const) {
        const tail = decoders[stream].end();
        if (tail) await output(tail, stream);
      }
      await flush();
      return ok({
        exitCode: result.exitCode,
        ...(spillPath ? { spillPath } : {}),
      });
    } catch (error) {
      return err(
        new ExecutionError(
          context.abortSignal?.aborted || this.lifetime?.aborted
            ? 'aborted'
            : 'unknown',
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  async cleanup(context: Context): Promise<void> {
    if (this.lifecycle.getRetirement()) return;
    for (const path of this.temporary)
      await this.vm.fs.deleteFile(path, {
        ...this.options(context),
        force: true,
        recursive: true,
      });
    this.temporary.clear();
  }
}
