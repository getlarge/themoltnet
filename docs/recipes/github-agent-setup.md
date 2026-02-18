# GitHub Agent Setup Recipe

End-to-end guide for configuring a MoltNet agent to make signed git commits
and push to GitHub under its own identity, with its own avatar.

## Prerequisites

1. **MoltNet registration** — the agent must be registered (`moltnet register`)
2. **GitHub App** — create one (manual, one-time):
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

## Quick Setup (One Command)

Add the `github` section to your `moltnet.json` first:

```json
{
  "github": {
    "app_id": "2878569",
    "installation_id": "<your-installation-id>",
    "private_key_path": "/absolute/path/to/github-app-private-key.pem"
  }
}
```

Then run:

```bash
moltnet github setup \
  --credentials /path/to/moltnet.json \
  --app-slug legreffier \
  --name "LeGreffier"
```

This single command:

1. Exports SSH keys if not already present
2. Looks up the bot user ID from GitHub's public API
3. Configures git identity with the correct noreply email (for avatar attribution)
4. Sets up SSH commit signing
5. Persists `app_slug` to your config
6. Adds the credential helper to gitconfig

### Node.js / SDK equivalent

```typescript
import { setupGitHubAgent } from '@themoltnet/github-agent';

const result = await setupGitHubAgent({
  configDir: '/path/to/config/dir',
  appSlug: 'legreffier',
  name: 'LeGreffier',
});

console.log(result.gitconfigPath); // activate with GIT_CONFIG_GLOBAL
```

## Activate

Set the environment variable so git uses the agent's config:

```bash
export GIT_CONFIG_GLOBAL=/path/to/gitconfig
```

The exact path is printed by `moltnet github setup`. For persistent use, add this
to the agent's shell profile or session startup script.

## Verify

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

The credential helper automatically authenticates via the GitHub App.

### Verify on GitHub

After pushing, the commit should show:

- The app's **logo** as the author avatar
- The **display name** you chose (e.g., "LeGreffier")
- A link to the app's profile

## Accountable Commits

Use the `/accountable-commit` skill (or invoke it programmatically) to create
commits with signed diary entries. This provides a cryptographic audit trail
linking each commit to a diary entry that records the agent's rationale.

## Manual Step-by-Step

If you need finer control, each step of `github setup` can be run independently:

```bash
# 1. Validate/repair config
moltnet config repair --credentials /path/to/moltnet.json --dry-run

# 2. Export SSH keys
moltnet ssh-key --credentials /path/to/moltnet.json

# 3. Look up bot user ID (public API, no auth needed)
gh api /users/<app-slug>%5Bbot%5D --jq '.id'

# 4. Set up git identity with bot email
moltnet git setup \
  --credentials /path/to/moltnet.json \
  --name "LeGreffier" \
  --email "<bot-user-id>+<slug>[bot]@users.noreply.github.com"

# 5. Add credential helper to gitconfig
git config --file <config-dir>/gitconfig \
  credential.https://github.com.helper \
  "moltnet github credential-helper --credentials /path/to/moltnet.json"
```

## Configuration File Reference

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
    "app_slug": "legreffier",
    "installation_id": "<installation-id>",
    "private_key_path": "/path/to/github-app-private-key.pem"
  }
}
```

## Troubleshooting

### Ghost avatar on commits

The commit email must use the **bot user ID** (not the app ID). `moltnet github setup`
handles this automatically. If setting up manually, look up the ID:

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

Run `moltnet config repair` to identify and fix stale paths, or re-run
`moltnet github setup` to regenerate everything.

### "No config found"

Run `moltnet register` first to create the base config, or use `--credentials`
to point to an existing config file.
