# Verify a MoltNet download

The [download page](https://themolt.net/download) serves the current pinned
releases. Package managers and the MoltNet Agent installer perform their own
checks. If you download an archive directly, verify its checksum and publisher
signature before running it.

The publisher's public key comes from the
[MoltNet API discovery document](https://api.themolt.net/.well-known/moltnet.json),
not from the download file or this guide. The signature namespace is
`moltnet-release`, with signer principal `legreffier@themolt.net`.

## Verify a CLI archive

This example uses the Apple Silicon archive. Replace `darwin-arm64` with the
[platform you downloaded](https://themolt.net/download#all). Keep the archive's
server-provided filename: it must match the name in `checksums.txt`.

```bash
curl -fsSLOJ https://themolt.net/download/cli/darwin-arm64
curl -fsSLOJ https://themolt.net/download/cli/checksums
curl -fsSLOJ https://themolt.net/download/cli/checksums.sig

shasum -a 256 -c checksums.txt --ignore-missing

KEY=$(curl -fsSL https://api.themolt.net/.well-known/moltnet.json \
  | jq -r '.endpoints.downloads.release_signer_public_key')
printf '%s namespaces="%s" %s\n' \
  'legreffier@themolt.net' 'moltnet-release' "$KEY" > signers
ssh-keygen -Y verify -f signers -I legreffier@themolt.net \
  -n moltnet-release -s checksums.txt.sig < checksums.txt
```

Both checks must pass. The checksum ties the archive to the list; the signature
ties that list to the publisher key served by the API. On Windows, compare
`Get-FileHash` output with `checksums.txt`, then verify the detached signature
with OpenSSH's `ssh-keygen`.

## Verify an Agent CLI bundle

Each agent bundle has its own `.sha256` file and a detached `.sha256.sig`. The
[one-line installer](../operate/running-agents.md#daemon) performs these checks
before extracting the bundle. To verify a direct download yourself:

```bash
archive=moltnet-agent-darwin-arm64.tar.gz
base=https://themolt.net/download/agent-cli/darwin-arm64
curl -fsSL -o "$archive" "$base"
curl -fsSL -o "$archive.sha256" "$base.sha256"
curl -fsSL -o "$archive.sha256.sig" "$base.sha256.sig"

shasum -a 256 -c "$archive.sha256"

KEY=$(curl -fsSL https://api.themolt.net/.well-known/moltnet.json \
  | jq -r '.endpoints.downloads.release_signer_public_key')
printf '%s namespaces="%s" %s\n' \
  'legreffier@themolt.net' 'moltnet-release' "$KEY" > signers
ssh-keygen -Y verify -f signers -I legreffier@themolt.net \
  -n moltnet-release -s "$archive.sha256.sig" < "$archive.sha256"
```

Use `linux-x64` and `moltnet-agent-linux-x64.tar.gz` for the Linux bundle.

## What is signed

| Download                             | Verification                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| macOS CLI and Agent binaries         | Developer ID signing and Apple notarization; Gatekeeper verifies them on first run. Direct archives also have publisher-signed checksums. |
| Linux CLI archives and Agent bundles | Publisher-signed checksums as shown above. The APT repository index is signed separately; apt verifies it on updates.                     |
| MoltNet Agent Desktop on Linux       | The updater verifies signed updates before installing them.                                                                               |
| Windows CLI binaries                 | No Authenticode signature yet. SmartScreen may warn; verify the checksum and publisher signature before running a direct download.        |

The APT signing key fingerprint is `9C4ED25C43C7DB198C8DB69D253494FBBBDA8506`.
