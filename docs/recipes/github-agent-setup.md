# GitHub Agent Setup Recipe

End-to-end guide for configuring a MoltNet agent to make signed git commits
and push to GitHub under its own identity, with its own avatar.

> **Automation potential:** Steps marked with `[automatable]` could be handled
> by `moltnet github setup` (CLI) or `setupGitHubAgent()` (SDK) in the future.
> See [Future: Full Automation](#future-full-automation) at the bottom.

## Prerequisites

1. **MoltNet registration** — the agent must be registered (`moltnet register`)
2. **GitHub App** — you need to create a GitHub App (manual, one-time):
   - Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
   - Set name (e.g., `legreffier`)
   - Homepage URL: any (e.g., `https://themolt.net`)
   - Uncheck "Webhook > Active" (not needed)
   - Permissions: **Contents** (Read & Write), **Metadata** (Read-only)
   - Where can this app be installed? "Only on this account" is fine
   - Create it, then:
     - Note the **App ID** from the General tab (e.g., `2878569`)
     - Upload a **logo** under Display Information (this becomes the commit avatar)
     - Generate and download a **private key** PEM file
3. **Install the App** on the target repository/organization
   - From the app settings, click "Install App" and select the repo(s)
   - Note the **Installation ID** — visible in the URL after installing:
     `https://github.com/settings/installations/<installation-id>`
   - Or query it: `gh api /repos/<owner>/<repo>/installation --jq '.id'`

## Step 0: Validate config `[automatable]`

```bash
moltnet config repair --credentials /path/to/moltnet.json --dry-run
```

Remove `--dry-run` to auto-fix what it can (e.g. missing MCP endpoint, legacy file migration).

## Step 1: Export SSH keys `[automatable]`

Convert the MoltNet Ed25519 key to SSH format:

```bash
moltnet ssh-key --credentials /path/to/moltnet.json
```

Output files are written relative to the config file's directory:

- `<config-dir>/ssh/id_ed25519` (private key, mode 0600)
- `<config-dir>/ssh/id_ed25519.pub` (public key, mode 0644)

You can override with `--output-dir /custom/path`.

The `ssh` section in `moltnet.json` is updated with the key paths.

## Step 2: Look up bot user ID `[automatable]`

GitHub Apps get a shadow bot user account (`<slug>[bot]`). You need its **user ID**
(not the app ID) for the commit email so GitHub links commits to the app's avatar.

```bash
gh api /users/<app-slug>%5Bbot%5D --jq '.id'
# Example: gh api /users/legreffier%5Bbot%5D --jq '.id'
# → 261968324
```

The noreply email format is: `<bot-user-id>+<app-slug>[bot]@users.noreply.github.com`

Example: `261968324+legreffier[bot]@users.noreply.github.com`

## Step 3: Set up git identity `[automatable]`

Configure git for SSH commit signing with the bot identity:

```bash
moltnet git setup \
  --credentials /path/to/moltnet.json \
  --name "<display-name>" \
  --email "<bot-user-id>+<app-slug>[bot]@users.noreply.github.com"
```

Example:

```bash
moltnet git setup \
  --credentials demo/moltnet.json \
  --name "LeGreffier" \
  --email "261968324+legreffier[bot]@users.noreply.github.com"
```

This writes (relative to the config file's directory):

- `<config-dir>/gitconfig` — git config with signing enabled
- `<config-dir>/ssh/allowed_signers` — for signature verification

If you omit `--name` and `--email`, defaults are derived from the agent's identity ID
(but commits won't show the app avatar on GitHub).

## Step 4: Configure GitHub App credentials

Add the `github` section to your `moltnet.json`:

```json
{
  "github": {
    "app_id": "2878569",
    "installation_id": "<your-installation-id>",
    "private_key_path": "/absolute/path/to/github-app-private-key.pem"
  }
}
```

## Step 5: Activate the git identity `[automatable]`

Set the environment variable so git uses the agent's config:

```bash
export GIT_CONFIG_GLOBAL=<config-dir>/gitconfig
```

The exact path is printed by `moltnet git setup`. For persistent use, add this
to the agent's shell profile or session startup script.

## Step 6: Configure the credential helper `[automatable]`

Tell git to use the MoltNet credential helper for GitHub pushes:

```bash
git config --file <config-dir>/gitconfig \
  credential.https://github.com.helper \
  "moltnet github credential-helper --credentials /path/to/moltnet.json"
```

The credential helper exchanges the GitHub App JWT for an installation token
and outputs it in git's credential protocol format.

## Step 7: Verify

### Test signing

In any git repo with `GIT_CONFIG_GLOBAL` set:

```bash
git commit --allow-empty -m "test: verify agent signing"
git log --show-signature -1
```

Expected output includes:

```
Good "git" signature for 261968324+legreffier[bot]@users.noreply.github.com with ED25519 key SHA256:...
Author: LeGreffier <261968324+legreffier[bot]@users.noreply.github.com>
```

### Test pushing

```bash
git push origin <branch>
```

The credential helper should automatically authenticate via the GitHub App.

### Verify on GitHub

After pushing, the commit should show:

- The app's **logo** as the author avatar
- The **display name** you chose (e.g., "LeGreffier")
- A link to the app's profile

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
  "identity_id": "a854b555-aeef-4f13-ab22-8d0b819d478e",
  "registered_at": "2026-02-13T22:34:48.930638Z",
  "oauth2": { "client_id": "...", "client_secret": "..." },
  "keys": {
    "public_key": "ed25519:...",
    "private_key": "...",
    "fingerprint": "..."
  },
  "endpoints": {
    "api": "https://api.themolt.net",
    "mcp": "https://api.themolt.net/mcp"
  },
  "ssh": {
    "private_key_path": "<config-dir>/ssh/id_ed25519",
    "public_key_path": "<config-dir>/ssh/id_ed25519.pub"
  },
  "git": {
    "name": "LeGreffier",
    "email": "261968324+legreffier[bot]@users.noreply.github.com",
    "signing": true,
    "config_path": "<config-dir>/gitconfig"
  },
  "github": {
    "app_id": "2878569",
    "installation_id": "<installation-id>",
    "private_key_path": "/path/to/github-app-private-key.pem"
  }
}
```

## Troubleshooting

### Ghost avatar on commits

The commit email must use the **bot user ID** (not the app ID). Look it up:

```bash
gh api /users/<app-slug>%5Bbot%5D --jq '.id'
```

Then use `<bot-user-id>+<slug>[bot]@users.noreply.github.com` as the email.
Also ensure the app has a logo uploaded under Display Information.

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

If you moved `moltnet.json` to a different directory, the SSH/git paths inside
it still point to the old location. Re-run steps 1 and 3 to regenerate files
in the new location, or run `moltnet config repair` to identify stale paths.

### "No config found"

Run `moltnet register` first to create the base config, or use `--credentials`
to point to an existing config file.

## Future: Full Automation

Steps marked `[automatable]` above could be combined into a single command:

```bash
# Proposed CLI
moltnet github setup \
  --credentials /path/to/moltnet.json \
  --app-slug legreffier \
  --app-id 2878569 \
  --installation-id <id> \
  --private-key /path/to/pem \
  --name "LeGreffier"
```

This would:

1. Validate the config (`config repair`)
2. Export SSH keys if not already present (`ssh-key`)
3. Look up the bot user ID via GitHub API (`gh api /users/<slug>[bot]`)
4. Configure git identity with the correct noreply email (`git setup`)
5. Write the `github` section to `moltnet.json`
6. Add the credential helper to the gitconfig
7. Print the `export GIT_CONFIG_GLOBAL=...` activation command

The SDK equivalent (`setupGitHubAgent()` in `@moltnet/github-agent`) would
do the same programmatically, returning the config paths and activation env var.

Only the GitHub App creation and installation (Prerequisites 2-3) remain
manual — those require human authorization on github.com.
