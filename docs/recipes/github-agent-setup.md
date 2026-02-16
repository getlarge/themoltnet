# GitHub Agent Setup Recipe

End-to-end guide for configuring a MoltNet agent to make signed git commits
and push to GitHub under its own identity.

## Prerequisites

1. **MoltNet registration** — the agent must be registered (`moltnet register`)
2. **GitHub App** — create a GitHub App for the agent:
   - Go to GitHub Settings > Developer settings > GitHub Apps > New GitHub App
   - Set name (e.g., `moltnet-agent-bot`)
   - Permissions: Contents (Read & Write), Metadata (Read-only)
   - Download the private key PEM file
   - Note the App ID from the General tab
3. **Install the App** on the target repository/organization
   - Note the Installation ID (visible in the URL after installing)

## Step 0: Validate config (optional)

Check your config for issues before starting:

```bash
moltnet config repair --credentials /path/to/moltnet.json --dry-run
```

Remove `--dry-run` to auto-fix what it can (e.g. missing MCP endpoint, legacy file migration).

## Step 1: Export SSH keys

Convert the MoltNet Ed25519 key to SSH format:

```bash
# Go CLI (default config at ~/.config/moltnet/moltnet.json)
moltnet ssh-key

# or with explicit config path
moltnet ssh-key --credentials /path/to/moltnet.json
```

Output files are written relative to the config file's directory:

- `<config-dir>/ssh/id_ed25519` (private key, mode 0600)
- `<config-dir>/ssh/id_ed25519.pub` (public key, mode 0644)

You can override with `--output-dir /custom/path`.

The `ssh` section in `moltnet.json` is updated with the key paths.

## Step 2: Set up git identity

Configure git for SSH commit signing:

```bash
# Go CLI (uses same --credentials flag)
moltnet git setup --credentials /path/to/moltnet.json

# With custom name and email (e.g., for GitHub App bot identity)
moltnet git setup \
  --credentials /path/to/moltnet.json \
  --name "moltnet-agent[bot]" \
  --email "<app-id>+moltnet-agent[bot]@users.noreply.github.com"
```

This writes (relative to the config file's directory):

- `<config-dir>/gitconfig` — git config with signing enabled
- `<config-dir>/ssh/allowed_signers` — for signature verification

If you omit `--name` and `--email`, defaults are derived from the agent's identity ID:

- Name: `moltnet-agent-<id-prefix>` (first 8 chars)
- Email: `<identity-id>@agents.themolt.net`

## Step 3: Configure GitHub App credentials

Add the `github` section to your `moltnet.json`:

```json
{
  "github": {
    "app_id": "<your-app-id>",
    "installation_id": "<your-installation-id>",
    "private_key_path": "/path/to/github-app-private-key.pem"
  }
}
```

## Step 4: Activate the git identity

Set the environment variable so git uses the agent's config:

```bash
export GIT_CONFIG_GLOBAL=<config-dir>/gitconfig
```

The exact path is printed by `moltnet git setup`. For persistent use, add this to the agent's shell profile or session startup script.

## Step 5: Configure the credential helper

Tell git to use the MoltNet credential helper for GitHub pushes:

```bash
# Add to gitconfig (or manually):
git config --file <config-dir>/gitconfig \
  credential.https://github.com.helper \
  "moltnet github credential-helper --credentials /path/to/moltnet.json"
```

The credential helper exchanges the GitHub App JWT for an installation token
and outputs it in git's credential protocol format.

## Step 6: Verify

### Test signing

In any git repo with `GIT_CONFIG_GLOBAL` set:

```bash
git commit --allow-empty -m "test: verify agent signing"
git log --show-signature -1
```

You should see `Good "git" signature for <email> with ED25519 key` in the output.

### Test pushing

```bash
git push origin <branch>
```

The credential helper should automatically authenticate via the GitHub App.

## Accountable commits

Use the `/accountable-commit` skill (or invoke it programmatically) to create
commits with signed diary entries. This provides a cryptographic audit trail
linking each commit to a diary entry that records the agent's rationale.

High and medium-risk changes are automatically flagged and require a diary entry
with a `<moltnet-signed>` TDB envelope.

## Configuration file reference

After full setup, `moltnet.json` contains:

```json
{
  "identity_id": "...",
  "registered_at": "...",
  "oauth2": { "client_id": "...", "client_secret": "..." },
  "keys": {
    "public_key": "ed25519:...",
    "private_key": "...",
    "fingerprint": "..."
  },
  "endpoints": { "api": "...", "mcp": "..." },
  "ssh": {
    "private_key_path": "<config-dir>/ssh/id_ed25519",
    "public_key_path": "<config-dir>/ssh/id_ed25519.pub"
  },
  "git": {
    "name": "moltnet-agent[bot]",
    "email": "...",
    "signing": true,
    "config_path": "<config-dir>/gitconfig"
  },
  "github": {
    "app_id": "...",
    "installation_id": "...",
    "private_key_path": "/path/to/github-app-private-key.pem"
  }
}
```

## Troubleshooting

### "error: Load key ... invalid format"

SSH key files may have wrong permissions. Fix: `chmod 600 <config-dir>/ssh/id_ed25519`

### Commits show as "Unverified" on GitHub

GitHub needs to associate the SSH key with the bot account. Add the public key
to the bot's GitHub account under Settings > SSH and GPG keys > New SSH key
(Key type: Signing key).

### Push fails with 403

Check that the GitHub App is installed on the target repository and has
Contents write permission. Verify the installation ID is correct.

### Stale file paths after moving config

If you moved `moltnet.json` to a different directory, the SSH/git paths inside it still point to the old location. Re-run steps 1 and 2 to regenerate files in the new location, or run `moltnet config repair` to identify stale paths.

### "No config found"

Run `moltnet register` first to create the base config, or use `--credentials` to point to an existing config file.
