/**
 * Gondolin tool operations: redirect pi's built-in tool operations
 * (read, write, edit, bash) to execute inside the VM.
 *
 * Follows the same pattern as upstream pi-gondolin.ts — pi's tool factories
 * accept an `operations` object that provides the underlying I/O.
 */
import path from 'node:path';

import type { VM } from '@earendil-works/gondolin';
import type {
  BashOperations,
  EditOperations,
  ReadOperations,
  WriteOperations,
} from '@mariozechner/pi-coding-agent';

export type { BashOperations, EditOperations, ReadOperations, WriteOperations };

const GUEST_WORKSPACE = '/workspace';

function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Map a host-side absolute path to a guest-side /workspace path.
 * Throws if the path escapes the workspace.
 */
export function toGuestPath(localCwd: string, localPath: string): string {
  // The LLM often addresses files by guest-absolute path (`/workspace/...`)
  // because that's what the system prompt implies. Accept those as-is —
  // otherwise `path.relative(hostCwd, '/workspace/...')` produces an escape
  // and Gondolin rejects every read from that namespace.
  if (
    localPath === GUEST_WORKSPACE ||
    localPath.startsWith(`${GUEST_WORKSPACE}/`)
  ) {
    return localPath;
  }
  const rel = path.relative(localCwd, localPath);
  if (rel === '') return GUEST_WORKSPACE;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

export function createGondolinReadOps(
  vm: VM,
  localCwd: string,
): ReadOperations {
  return {
    readFile: async (p) => {
      const r = await vm.exec(['/bin/cat', toGuestPath(localCwd, p)]);
      if (!r.ok) throw new Error(`cat failed (${r.exitCode}): ${r.stderr}`);
      return r.stdoutBuffer;
    },
    access: async (p) => {
      const r = await vm.exec([
        '/bin/sh',
        '-lc',
        `test -r ${shQuote(toGuestPath(localCwd, p))}`,
      ]);
      if (!r.ok) throw new Error(`not readable: ${p}`);
    },
    detectImageMimeType: async (p) => {
      try {
        const r = await vm.exec([
          '/bin/sh',
          '-lc',
          `file --mime-type -b ${shQuote(toGuestPath(localCwd, p))}`,
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
): WriteOperations {
  return {
    writeFile: async (p, content) => {
      const guestPath = toGuestPath(localCwd, p);
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
      const r = await vm.exec(['/bin/mkdir', '-p', toGuestPath(localCwd, dir)]);
      if (!r.ok) throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
    },
  };
}

export function createGondolinEditOps(
  vm: VM,
  localCwd: string,
): EditOperations {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

export function createGondolinBashOps(
  vm: VM,
  localCwd: string,
): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = toGuestPath(localCwd, cwd);
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
