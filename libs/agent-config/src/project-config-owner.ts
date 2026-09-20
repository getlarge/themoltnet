/** POSIX reads allow administrator-provisioned files; writes retain ownership. */
export function assertProjectConfigOwner(
  info: { uid: number; mode: number },
  writing = false,
  uid = process.getuid?.(),
): void {
  if (process.platform === 'win32') return;
  if (writing && info.uid !== uid)
    throw new Error(
      'Project config updates require ownership by the current user',
    );
  if ((info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== uid))
    throw new Error(
      'Project config must be owned by root or the current user and not group/world writable',
    );
}
