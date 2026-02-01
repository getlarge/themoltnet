# Sandbox Troubleshooting

## Node.js SIGILL (Illegal Instruction) on ARM64 Sandboxes

**Symptom:** Every `node` command crashes immediately with exit code 132 (SIGILL). No output is produced — even `node -e 'console.log(1)'` fails silently.

**Root cause:** The Debian/Ubuntu-packaged Node.js (`nodejs` apt package, installed at `/usr/bin/node`) is compiled targeting ARMv8 extensions (e.g., LSE atomics, specific NEON variants) that are not available on the container's emulated CPU. The SIGILL occurs during V8 initialization — before any JavaScript executes — so V8 flags like `--jitless` or `--no-opt` cannot help.

**Diagnosis:**

```bash
# Confirm the signal
python3 -c "
import subprocess, signal
p = subprocess.Popen(['node', '-e', 'print(1)'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
p.communicate()
print(signal.Signals(-p.returncode).name if p.returncode < 0 else 'OK')
"
# Output: SIGILL

# Confirm other runtimes work fine
python3 -c "print('ok')"   # Works
perl -e 'print "ok\n"'     # Works
```

**Fix:** Install Node.js from the official nodejs.org binaries (which target baseline ARMv8.0) via nvm, then replace the broken system binary:

```bash
# 1. Install nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 2. Install Node (unset NPM_CONFIG_PREFIX if set by the sandbox)
unset NPM_CONFIG_PREFIX
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20

# 3. Replace the broken system binary with a symlink
sudo mv /usr/bin/node /usr/bin/node.broken
sudo ln -s "$HOME/.nvm/versions/node/v20.20.0/bin/node" /usr/bin/node

# 4. Persist nvm in the sandbox environment file (NO bash_completion!)
cat > /etc/sandbox-persistent.sh << 'EOF'
unset NPM_CONFIG_PREFIX
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
EOF

# 5. Verify
node -e 'console.log("works:", process.version)'
```

**Why the symlink replacement (step 3) is necessary:** The `CLAUDE_ENV_FILE` mechanism sources the persistent env file before each command, but the Bash tool's shell snapshot may have already resolved `node` to `/usr/bin/node` in its hash table. Only replacing the binary at its original path guarantees all invocations use the working Node.js.

**Why not just use `bash -l -c`:** Login shells do pick up nvm correctly, but every command would need to be wrapped in `bash -l -c "..."`, which is fragile and easy to forget. The symlink approach makes all commands work transparently.
