# macOS signing & packaging plan — `moltnet-agent` desktop bundle

> Sub-task brief. Written to be handed to a dedicated agent session that guides
> the operator through Apple enrollment, CI signing, and notarization for the
> `moltnet-agent serve` bundle. Prerequisite for the "MoltNet Agent wants to
> access your keychain" trust story (Keychain ACLs bind to the requester's code
> signature; under `npx` the requester is the system `node`).

## Goal

Ship a signed, notarized macOS payload (tarball first, `.pkg` second)
containing:

| Component | Today's signature (verified 2026-09-01) | Action |
| --- | --- | --- |
| Bundled Node runtime | Signed by Node.js team (`TeamIdentifier=HX7739G8FX`), hardened runtime, entitlements `com.apple.security.cs.allow-jit` + `allow-unsigned-executable-memory` | **Re-sign** with MoltNet Developer ID, preserving those two entitlements (V8 JIT breaks without them) |
| `gondolin-krun-runner` | **ad-hoc** (`flags=0x2(adhoc)`), entitlement `com.apple.security.hypervisor` already embedded | Re-sign with Developer ID, preserve the hypervisor entitlement |
| `libkrun.dylib` (+ versioned copies) | **ad-hoc, linker-signed** | Re-sign with Developer ID (dylibs need no entitlements) |
| `qemu-img` (static build we ship) | depends on source | Sign with Developer ID |
| `keytar.node` and any other `.node` addons | linker-signed | Sign with Developer ID |
| daemon `dist/` JS | n/a (scripts aren't Mach-O) | nothing |

Key fact for the operator's "isn't node already signed?" question: yes — **by
someone else's Team ID**. A Keychain item created by that binary ACLs to the
Node.js team's designated requirement, and every node install on the machine
satisfies it. Re-signing with our identity is the entire point, and it is the
standard, supported operation (`codesign --force`): it rewrites the
`LC_CODE_SIGNATURE` load command — no manual Mach-O header surgery, ever.
Ad-hoc signatures (krun runner, libkrun) carry no identity at all and would
fail notarization as-is, so they must be re-signed regardless.

## Step 0 — Apple Developer Program (start today; this is the long pole)

1. Decide enrollment type:
   - **Individual** — fastest (usually < 48 h), $99/yr, but signing prompts and
     `spctl` output show the personal legal name.
   - **Organization** — shows the company name; requires a legal entity and a
     **D-U-N-S number** (free, but issuance/verification can take 1–2 weeks if
     the entity has none).
   Recommendation: if a MoltNet legal entity with a D-U-N-S exists, enroll it;
   otherwise enroll individual now and migrate later (Apple supports converting
   accounts; re-signing with the new identity is a rebuild, not a redesign).
2. Enroll at <https://developer.apple.com/programs/enroll/> ($99/yr).
3. In the account, create two certificates (via Xcode or the portal + CSR):
   - **Developer ID Application** — signs every Mach-O above.
   - **Developer ID Installer** — signs the `.pkg` (only needed for step 4).
4. Create an **App Store Connect API key** (or app-specific password) for
   `notarytool` in CI.
5. Export the certs + keys to CI as secrets (`.p12` + password, or use a
   keychain action).

## Step 1 — assemble the unsigned payload

Build step (extend the existing release tooling; `packages/cli`'s per-platform
binary packages + `install.js` are the in-repo precedent):

```
moltnet-agent-darwin-arm64/
  bin/moltnet-agent          # launcher (script or pkg'd binary — see note)
  runtime/node               # pinned Node, re-signed
  daemon/…                   # @themoltnet/agent-daemon dist + prod node_modules
  vendor/gondolin-krun-runner
  vendor/libkrun.dylib …
  vendor/qemu-img
```

Note on `yao-pkg/pkg`: producing `bin/moltnet-agent` as a single pkg-compiled
binary is attractive **because it leaves exactly one first-party executable to
sign and one Keychain requester**. Constraints to validate in a spike before
committing: (a) pkg snapshots CJS — the daemon is ESM/Vite-SSR, so add a CJS
bundle target for the serve entry; (b) native addons (`keytar.node`) and the
vendor binaries stay on disk beside the exe (pkg cannot embed them usefully);
(c) the pkg base binary is a patched Node — sign it with hardened runtime +
the two JIT entitlements exactly like stock Node. If the spike fails, the
runtime-folder layout above works without pkg; the ACL then binds to our
re-signed `runtime/node`.

## Step 2 — sign (CI job, macOS runner)

Sign **inside-out** (dylibs/addons → executables), every Mach-O, with hardened
runtime:

```bash
ID="Developer ID Application: <name> (<TEAMID>)"
# dylibs + addons: no entitlements
codesign --force --timestamp --options runtime -s "$ID" vendor/libkrun*.dylib daemon/**/*.node
# qemu-img: no entitlements
codesign --force --timestamp --options runtime -s "$ID" vendor/qemu-img
# krun runner: KEEP the hypervisor entitlement (extract first, re-apply)
codesign -d --entitlements krun.plist --xml vendor/gondolin-krun-runner
codesign --force --timestamp --options runtime --entitlements krun.plist -s "$ID" vendor/gondolin-krun-runner
# node (or the pkg output): JIT entitlements
cat > node.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict></plist>
EOF
codesign --force --timestamp --options runtime --entitlements node.plist -s "$ID" runtime/node
```

Gotchas the guiding session must check:
- `--options runtime` (hardened runtime) is **mandatory** for notarization.
- `--timestamp` requires network access on the runner.
- Verify each with `codesign --verify --strict --deep -v` and
  `codesign -d --entitlements -` (confirm entitlements survived).
- The hypervisor entitlement is *not* a restricted entitlement; Developer ID +
  plain entitlements plist is sufficient (it already works ad-hoc today).

## Step 3 — notarize + staple

```bash
ditto -c -k --keepParent moltnet-agent-darwin-arm64 payload.zip
xcrun notarytool submit payload.zip --key <api-key> --wait
# .pkg and .dmg can be stapled; bare zips are verified online at first run
```

For the `.pkg` path: `pkgbuild` (component, with postinstall script that
installs the LaunchAgent for `serve`) → `productbuild --sign "Developer ID
Installer: …"` → `notarytool submit` → `xcrun stapler staple`.

## Step 4 — distribution

- `curl -fsSL https://get.themolt.net | sh` — downloads the notarized tarball,
  verifies checksum, unpacks to `~/.local/share/moltnet/`, links
  `moltnet-agent`, installs the `serve` LaunchAgent. Ships first.
- `.pkg` — same payload, double-clickable. Ships second.
- CI: extend `.github/workflows/release.yml` with a `macos-latest` job; secrets:
  `APPLE_CERT_P12`, `APPLE_CERT_PASSWORD`, `NOTARY_KEY_ID`,
  `NOTARY_ISSUER_ID`, `NOTARY_KEY`.

## Step 5 — prove the Keychain story (acceptance test)

1. From the signed `moltnet-agent`, write a secret via `@themoltnet/os-keyring`
   (service `themolt.net`).
2. Confirm the Keychain prompt names **MoltNet Agent** (or the binary's signed
   identifier), not "node".
3. Confirm plain `node -e "require('@github/keytar').getPassword(…)"` triggers
   a prompt / is denied rather than silently reading the item.
4. Confirm the Go CLI (`moltnet`) interop path still round-trips
   (`apps/moltnet-cli/testdata/keyring-interop`).

## Budget

- Money: **$99/yr** (Apple). No Windows spend (out of scope for v1).
- Time: enrollment 0.5 d active (+ up to 2 w wall-clock if D-U-N-S needed);
  payload assembly 1–2 d; signing + notarization CI 2–3 d; pkg + LaunchAgent
  1 d; acceptance test 0.5 d.

## Out of scope

Windows (`.msi`, Authenticode), Linux packaging (tarball + checksums is
enough), auto-update.
