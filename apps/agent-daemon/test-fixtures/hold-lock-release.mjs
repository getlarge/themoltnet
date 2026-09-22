// Loaded before the CLI so proper-lockfile's filesystem wrapper sees this hook.
// No signal handler is installed here: the real supervisor must survive SIGTERM.
import fs from 'node:fs';
import process from 'node:process';
const rmdir = fs.rmdir;
let held = false;
fs.rmdir = function (path, ...args) {
  if (!held && String(path).endsWith('/agent-server.lock')) {
    held = true;
    process.send('releasing-lock');
    process.once('message', () => {
      rmdir.call(fs, path, ...args);
      process.disconnect();
    });
    return;
  }
  return rmdir.call(fs, path, ...args);
};
