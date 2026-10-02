import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import type { Context } from '@earendil-works/chord';
import type { VM } from '@earendil-works/gondolin';
import {
  err,
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
} from '@earendil-works/pi-durable/env';
import { execManagedCommand } from '@themoltnet/sandbox-gondolin';

/** All filesystem and shell operations target the guest; none access host paths. */
export class GondolinDurableEnv implements ExecutionEnv {
  private retired = false;
  private readonly temporary = new Set<string>();
  constructor(
    readonly vm: VM,
    readonly id: string,
    public cwd: string,
    private readonly lifetime?: AbortSignal,
  ) {}

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
      if (this.retired) throw new Error('Gondolin environment is retired');
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
    return this.file(path, context, async () => posix.resolve(this.cwd, path));
  }
  joinPath(parts: string[], context: Context) {
    return this.file(parts.join('/'), context, async () =>
      posix.join(...parts),
    );
  }
  readTextFile(path: string, context: Context) {
    return this.file(path, context, () =>
      this.vm.fs.readFile(path, { ...this.options(context), encoding: 'utf8' }),
    );
  }
  readBinaryFile(path: string, context: Context) {
    return this.file<Uint8Array>(path, context, () =>
      this.vm.fs.readFile(path, this.options(context)),
    );
  }
  writeFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, () =>
      this.vm.fs.writeFile(path, content, this.options(context)),
    );
  }
  appendFile(path: string, content: string | Uint8Array, context: Context) {
    return this.file(path, context, async () => {
      const result = await this.vm.exec(
        [
          '/bin/sh',
          '-c',
          'cat >> "$1"',
          'append',
          posix.resolve(this.cwd, path),
        ],
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
        ['truncate', '-s', String(size), '--', posix.resolve(this.cwd, path)],
        context,
      );
    });
  }
  flushFile(path: string, context: Context) {
    return this.file(path, context, async () => {
      await this.command(
        ['sync', '-f', '--', posix.resolve(this.cwd, path)],
        context,
      );
    });
  }
  renameFile(source: string, destination: string, context: Context) {
    return this.file(source, context, () =>
      this.vm.fs.rename(source, destination, this.options(context)),
    );
  }
  fileInfo(path: string, context: Context) {
    return this.file<FileInfo>(path, context, async () => {
      const stat = await this.vm.fs.stat(path, this.options(context));
      return {
        name: posix.basename(path),
        path: posix.resolve(this.cwd, path),
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
      const names = await this.vm.fs.listDir(path, this.options(context));
      const entries: FileInfo[] = [];
      for (const name of names) {
        const result = await this.fileInfo(posix.join(path, name), context);
        if (!result.ok) throw result.error;
        entries.push(result.value);
      }
      return entries;
    });
  }
  canonicalPath(path: string, context: Context) {
    return this.file(path, context, async () =>
      (
        await this.command(
          ['realpath', '--', posix.resolve(this.cwd, path)],
          context,
        )
      ).replace(/\n$/, ''),
    );
  }
  exists(path: string, context: Context) {
    return this.file(path, context, async () => {
      try {
        await this.vm.fs.access(path, this.options(context));
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
      this.vm.fs.mkdir(path, { ...this.options(context), ...options }),
    );
  }
  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ) {
    return this.file(path, context, () =>
      this.vm.fs.deleteFile(path, { ...this.options(context), ...options }),
    );
  }
  private safeName(value: string) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
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
        path,
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
    if (this.retired)
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
    let spillPath: string | undefined;
    let endsWithNewline = true;
    const output = async (text: string) => {
      options?.onOutput?.(text, context);
      if (!options?.spill) return;
      bytes += Buffer.byteLength(text);
      lines += text.split('\n').length - 1;
      if (text) endsWithNewline = text.endsWith('\n');
      if (
        !spillPath &&
        bytes <= options.spill.afterBytes &&
        lines + (endsWithNewline ? 0 : 1) <= options.spill.afterLines
      ) {
        buffered.push(text);
        return;
      }
      {
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
        }
        const appended = await this.appendFile(spillPath, text, context);
        if (!appended.ok) throw appended.error;
      }
    };
    try {
      const result = await execManagedCommand(this.vm, command, {
        cwd: options?.cwd ?? this.cwd,
        env: options?.env,
        signal: this.options(context).signal,
        timeoutMs: options?.timeout ? options.timeout * 1000 : undefined,
        onData: (chunk, stream) => output(decoders[stream].write(chunk)),
      });
      for (const decoder of Object.values(decoders)) {
        const tail = decoder.end();
        if (tail) await output(tail);
      }
      if (
        result.termination.status === 'backend-retired' ||
        result.termination.status === 'recovery-required'
      )
        this.retired = true;
      if (result.timedOut || result.cancelled)
        return err(
          new ExecutionError(
            result.timedOut ? 'timeout' : 'aborted',
            'Guest execution interrupted',
          ),
        );
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
    if (this.retired) return;
    for (const path of this.temporary)
      await this.vm.fs.deleteFile(path, {
        ...this.options(context),
        force: true,
        recursive: true,
      });
    this.temporary.clear();
  }
}
