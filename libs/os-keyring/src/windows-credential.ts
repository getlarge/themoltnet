import { spawn } from 'node:child_process';

const WINDOWS_DIRECTORY = 'C:\\Windows';
export const WINDOWS_POWERSHELL_PATH =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WINDOWS_CREDENTIAL_TIMEOUT_MS = 30_000;
const WINDOWS_CREDENTIAL_OUTPUT_LIMIT = 64 * 1024;

export interface WindowsCredentialStore {
  read(target: string): Promise<Uint8Array | null>;
  write(target: string, username: string, value: Uint8Array): Promise<void>;
  delete(target: string): Promise<void>;
}

type WindowsCredentialRequest =
  | { operation: 'read'; target: string }
  | { operation: 'write'; target: string; username: string; value: string }
  | { operation: 'delete'; target: string };

type WindowsCredentialResponse = {
  found?: boolean;
  value?: string;
};

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MoltNetCredentialManager {
  private const int CredTypeGeneric = 1;
  private const int CredPersistLocalMachine = 2;
  private const int ErrorNotFound = 1168;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential {
    public int Flags;
    public int Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref Credential credential, int flags);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, int type, int flags);

  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);

  public static byte[] Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, CredTypeGeneric, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == ErrorNotFound) return null;
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      byte[] value = new byte[credential.CredentialBlobSize];
      if (value.Length > 0) Marshal.Copy(credential.CredentialBlob, value, 0, value.Length);
      return value;
    } finally {
      CredFree(pointer);
    }
  }

  public static void Write(string target, string username, byte[] value) {
    IntPtr blob = Marshal.AllocHGlobal(value.Length);
    try {
      if (value.Length > 0) Marshal.Copy(value, 0, blob, value.Length);
      Credential credential = new Credential {
        Type = CredTypeGeneric,
        TargetName = target,
        CredentialBlobSize = value.Length,
        CredentialBlob = blob,
        Persist = CredPersistLocalMachine,
        UserName = username
      };
      if (!CredWrite(ref credential, 0)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally {
      Marshal.FreeHGlobal(blob);
    }
  }

  public static void Delete(string target) {
    if (CredDelete(target, CredTypeGeneric, 0)) return;
    int error = Marshal.GetLastWin32Error();
    if (error != ErrorNotFound) throw new Win32Exception(error);
  }
}
'@

$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$response = switch ($request.operation) {
  'read' {
    $value = [MoltNetCredentialManager]::Read($request.target)
    if ($null -eq $value) { @{ found = $false } }
    else { @{ found = $true; value = [Convert]::ToBase64String($value) } }
  }
  'write' {
    [MoltNetCredentialManager]::Write(
      $request.target,
      $request.username,
      [Convert]::FromBase64String($request.value)
    )
    @{}
  }
  'delete' {
    [MoltNetCredentialManager]::Delete($request.target)
    @{}
  }
  default { throw "Unsupported credential operation" }
}
$response | ConvertTo-Json -Compress
`;

const encodedWindowsCredentialScript = Buffer.from(
  WINDOWS_CREDENTIAL_SCRIPT,
  'utf16le',
).toString('base64');

async function runWindowsCredentialRequest(
  request: WindowsCredentialRequest,
): Promise<WindowsCredentialResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      WINDOWS_POWERSHELL_PATH,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodedWindowsCredentialScript,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ComSpec: `${WINDOWS_DIRECTORY}\\System32\\cmd.exe`,
          SystemRoot: WINDOWS_DIRECTORY,
          WINDIR: WINDOWS_DIRECTORY,
        },
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Windows Credential Manager operation timed out after ${WINDOWS_CREDENTIAL_TIMEOUT_MS}ms`,
        ),
      );
    }, WINDOWS_CREDENTIAL_TIMEOUT_MS);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    const capture = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > WINDOWS_CREDENTIAL_OUTPUT_LIMIT) {
        fail(
          new Error(
            `Windows Credential Manager output exceeded ${WINDOWS_CREDENTIAL_OUTPUT_LIMIT} bytes`,
          ),
        );
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `Windows Credential Manager operation failed: ${Buffer.concat(stderr).toString('utf8').trim() || `exit ${code}`}`,
          ),
        );
        return;
      }
      try {
        const parsed: unknown = JSON.parse(
          Buffer.concat(stdout).toString('utf8'),
        );
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('response must be an object');
        }
        resolve(parsed as WindowsCredentialResponse);
      } catch (error) {
        reject(
          new Error('Windows Credential Manager returned invalid JSON', {
            cause: error,
          }),
        );
      }
    });
    child.stdin.on('error', (error) => fail(error));
    child.stdin.end(JSON.stringify(request));
  });
}

export function createWindowsCredentialStore(): WindowsCredentialStore {
  return {
    async read(target) {
      const response = await runWindowsCredentialRequest({
        operation: 'read',
        target,
      });
      return response.found && response.value
        ? Buffer.from(response.value, 'base64')
        : null;
    },
    async write(target, username, value) {
      await runWindowsCredentialRequest({
        operation: 'write',
        target,
        username,
        value: Buffer.from(value).toString('base64'),
      });
    },
    async delete(target) {
      await runWindowsCredentialRequest({ operation: 'delete', target });
    },
  };
}
