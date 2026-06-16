# Rotate/Remove Embedded CI GitHub Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent gitconfig carry a tokenless mint-on-demand GitHub credential helper as the single source of truth, stop embedding `ghs_` tokens in any git config, and make `moltnet config repair` heal already-polluted checkouts.

**Architecture:** The agent gitconfig (`.moltnet/<agent>/gitconfig`) gets a `[credential "https://github.com"]` helper that shells out to `moltnet github credential-helper` (already mints fresh App tokens, no secret on disk) plus an `[url] insteadOf` rule rewriting SSH remotes to HTTPS. `moltnet github setup` writes both. `moltnet config repair` gains a `.git/config` + gitconfig scanner that strips any token-bearing `insteadof`/`url` rule and (re)installs the tokenless helper. `vm-manager.ts` stops hand-rolling its own helper + imperative `git config --global` and relies on the injected gitconfig. CI greps for `ghs_`/`ghp_` in tracked-ish git config.

**Tech Stack:** Go (apps/moltnet-cli, cobra, stdlib `os`/`os/exec`), TypeScript (libs/pi-extension), GitHub Actions YAML.

---

## File Structure

- `apps/moltnet-cli/github.go` — add `insteadOf` write to `runGitHubSetupCmd` (idempotent), extract a shared gitconfig-credential-block writer.
- `apps/moltnet-cli/gitcredential.go` (new) — pure helpers: detect token-bearing rules in a git config string, build the tokenless credential block, scan/clean a `.git/config` file.
- `apps/moltnet-cli/repair.go` — call the new scanner against the repo `.git/config` and the agent gitconfig; report + fix.
- `apps/moltnet-cli/gitcredential_test.go` (new) — unit tests for detection + cleaning.
- `apps/moltnet-cli/repair_test.go` — test repair strips a polluted `.git/config`.
- `apps/moltnet-cli/github_test.go` — assert `insteadOf` written + idempotency.
- `libs/pi-extension/src/vm-manager.ts:569-586` — delete hand-rolled helper script + `git config --global`; rely on injected gitconfig.
- `.github/workflows/ci.yml` — add a token-leak grep step.

---

## Task 1: Tokenless credential-block helpers (Go, pure functions)

**Files:**
- Create: `apps/moltnet-cli/gitcredential.go`
- Test: `apps/moltnet-cli/gitcredential_test.go`

- [ ] **Step 1: Write the failing test**

```go
package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHasTokenBearingRule(t *testing.T) {
	polluted := `[remote "origin"]
	url = git@github.com:getlarge/themoltnet.git
[url "https://x-access-token:ghs_ABC123@github.com/"]
	insteadof = git@github.com:
`
	if !hasTokenBearingRule(polluted) {
		t.Fatal("expected token-bearing rule to be detected")
	}
	clean := `[url "https://github.com/"]
	insteadof = git@github.com:
`
	if hasTokenBearingRule(clean) {
		t.Fatal("tokenless insteadof must not be flagged")
	}
}

func TestStripTokenBearingRules(t *testing.T) {
	in := `[core]
	repositoryformatversion = 0
[url "https://x-access-token:ghs_ABC123@github.com/"]
	insteadof = git@github.com:
[branch "main"]
	remote = origin
`
	out := stripTokenBearingRules(in)
	if strings.Contains(out, "ghs_") {
		t.Fatalf("token not stripped:\n%s", out)
	}
	if !strings.Contains(out, "[core]") || !strings.Contains(out, "[branch \"main\"]") {
		t.Fatalf("unrelated sections lost:\n%s", out)
	}
	if strings.Contains(out, "insteadof = git@github.com:") {
		t.Fatalf("orphan insteadof key left behind:\n%s", out)
	}
}

func TestCleanGitConfigFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config")
	os.WriteFile(p, []byte(`[url "https://x-access-token:ghp_DEADBEEF@github.com/"]
	insteadof = git@github.com:
`), 0o644)
	changed, err := cleanGitConfigFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected changed=true")
	}
	b, _ := os.ReadFile(p)
	if strings.Contains(string(b), "ghp_") {
		t.Fatalf("file still polluted:\n%s", b)
	}
	changed2, _ := cleanGitConfigFile(p)
	if changed2 {
		t.Fatal("second pass should be a no-op")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/moltnet-cli && go test -run 'TestHasTokenBearingRule|TestStripTokenBearingRules|TestCleanGitConfigFile' ./...`
Expected: FAIL (undefined: hasTokenBearingRule / stripTokenBearingRules / cleanGitConfigFile)

- [ ] **Step 3: Write minimal implementation**

```go
package main

import (
	"os"
	"regexp"
	"strings"
)

// tokenRe matches an embedded GitHub token (server-to-server ghs_, personal
// ghp_, or generic gh*_) anywhere in a git config blob.
var tokenRe = regexp.MustCompile(`gh[a-z]_[A-Za-z0-9]+`)

// hasTokenBearingRule reports whether a git config blob contains an embedded
// GitHub token (the #1396 pollution pattern).
func hasTokenBearingRule(config string) bool {
	return tokenRe.MatchString(config)
}

// stripTokenBearingRules removes any [url "...token..."] section (header +
// its indented body keys) from a git config blob. Returns the cleaned blob.
func stripTokenBearingRules(config string) string {
	lines := strings.Split(config, "\n")
	var out []string
	skipping := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		isSectionHeader := strings.HasPrefix(trimmed, "[")
		if isSectionHeader {
			// A new section ends any skip; decide whether THIS one is poisoned.
			skipping = tokenRe.MatchString(line)
			if skipping {
				continue
			}
		} else if skipping {
			// Inside a poisoned section: drop indented body lines.
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

// cleanGitConfigFile strips token-bearing rules from a git config file in
// place. Returns true if the file was modified.
func cleanGitConfigFile(path string) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	original := string(b)
	if !hasTokenBearingRule(original) {
		return false, nil
	}
	cleaned := stripTokenBearingRules(original)
	if cleaned == original {
		return false, nil
	}
	if err := os.WriteFile(path, []byte(cleaned), 0o644); err != nil {
		return false, err
	}
	return true, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/moltnet-cli && go test -run 'TestHasTokenBearingRule|TestStripTokenBearingRules|TestCleanGitConfigFile' ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/moltnet-cli/gitcredential.go apps/moltnet-cli/gitcredential_test.go
git commit -m "feat(cli): add tokenless git-credential scrubbing helpers"
```

---

## Task 2: Build + write the tokenless credential block

**Files:**
- Modify: `apps/moltnet-cli/gitcredential.go`
- Test: `apps/moltnet-cli/gitcredential_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestBuildCredentialBlock(t *testing.T) {
	block := buildCredentialBlock("/abs/.moltnet/legreffier/moltnet.json")
	if !strings.Contains(block, `[credential "https://github.com"]`) {
		t.Fatalf("missing credential header:\n%s", block)
	}
	if !strings.Contains(block, "moltnet github credential-helper --credentials /abs/.moltnet/legreffier/moltnet.json") {
		t.Fatalf("missing helper invocation:\n%s", block)
	}
	if !strings.Contains(block, `[url "https://github.com/"]`) || !strings.Contains(block, "insteadOf = git@github.com:") {
		t.Fatalf("missing insteadOf rule:\n%s", block)
	}
	if strings.Contains(block, "ghs_") || strings.Contains(block, "ghp_") {
		t.Fatalf("block must never embed a token:\n%s", block)
	}
}

func TestBuildCredentialBlock_NoCredPath(t *testing.T) {
	block := buildCredentialBlock("")
	if !strings.Contains(block, "helper = \"!moltnet github credential-helper\"") {
		t.Fatalf("expected bare helper when no cred path:\n%s", block)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/moltnet-cli && go test -run TestBuildCredentialBlock ./...`
Expected: FAIL (undefined: buildCredentialBlock)

- [ ] **Step 3: Write minimal implementation**

Append to `apps/moltnet-cli/gitcredential.go`:

```go
import "fmt" // add to existing import block

// buildCredentialBlock returns the tokenless gitconfig block that wires the
// mint-on-demand GitHub credential helper plus the SSH->HTTPS insteadOf rule.
// credPath, when non-empty, is passed as an absolute --credentials path so the
// helper resolves the right agent from any CWD or worktree.
func buildCredentialBlock(credPath string) string {
	helper := "moltnet github credential-helper"
	if credPath != "" {
		helper += " --credentials " + credPath
	}
	return fmt.Sprintf(`[credential "https://github.com"]
	helper = "!%s"
[url "https://github.com/"]
	insteadOf = git@github.com:
`, helper)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/moltnet-cli && go test -run TestBuildCredentialBlock ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/moltnet-cli/gitcredential.go apps/moltnet-cli/gitcredential_test.go
git commit -m "feat(cli): build tokenless credential block"
```

---

## Task 3: `github setup` writes credential helper + insteadOf idempotently

**Files:**
- Modify: `apps/moltnet-cli/github.go:95-112`
- Test: `apps/moltnet-cli/github_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestRunGitHubSetup_WritesInsteadOfIdempotent(t *testing.T) {
	// Arrange: minimal moltnet.json with github + ssh + git already set,
	// mirroring TestRunGitHubSetup_FullFlow's fixture (reuse its helper).
	credPath, gitconfigPath := setupGitHubFixture(t) // existing/shared test helper

	// Act: run setup twice.
	if err := runGitHubSetupCmd(credPath, "", "legreffier"); err != nil {
		t.Fatal(err)
	}
	if err := runGitHubSetupCmd(credPath, "", "legreffier"); err != nil {
		t.Fatal(err)
	}

	// Assert: helper + insteadOf present exactly once, no token.
	b, _ := os.ReadFile(gitconfigPath)
	cfg := string(b)
	if strings.Count(cfg, `[credential "https://github.com"]`) != 1 {
		t.Fatalf("credential block not idempotent:\n%s", cfg)
	}
	if strings.Count(cfg, "insteadOf = git@github.com:") != 1 {
		t.Fatalf("insteadOf not idempotent:\n%s", cfg)
	}
	if hasTokenBearingRule(cfg) {
		t.Fatalf("setup must not embed a token:\n%s", cfg)
	}
}
```

> NOTE: if `setupGitHubFixture` does not already exist, factor the fixture
> setup out of `TestRunGitHubSetup_FullFlow` (github_test.go:96-179) into a
> shared helper returning `(credPath, gitconfigPath string)`. The bot-user
> lookup is stubbed via `githubAPIBaseURL` in existing tests — reuse that stub.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/moltnet-cli && go test -run TestRunGitHubSetup_WritesInsteadOfIdempotent ./...`
Expected: FAIL (insteadOf absent / written twice)

- [ ] **Step 3: Write minimal implementation**

Replace the Step 6 block in `github.go` (lines 95-112) with:

```go
	// Step 6: Add tokenless credential helper + SSH->HTTPS rewrite to gitconfig.
	// Idempotent: skip whichever pieces are already present.
	if creds.Git != nil && creds.Git.ConfigPath != "" {
		existing, _ := os.ReadFile(creds.Git.ConfigPath)
		existingStr := string(existing)
		needHelper := !strings.Contains(existingStr, `[credential "https://github.com"]`)
		needInsteadOf := !strings.Contains(existingStr, "insteadOf = git@github.com:")
		if needHelper || needInsteadOf {
			fmt.Fprintln(os.Stderr, "Adding tokenless credential helper to gitconfig...")
			f, err := os.OpenFile(creds.Git.ConfigPath, os.O_APPEND|os.O_WRONLY, 0o644)
			if err != nil {
				return fmt.Errorf("open gitconfig: %w", err)
			}
			var toWrite string
			block := buildCredentialBlock(credPath)
			if needHelper && needInsteadOf {
				toWrite = "\n" + block
			} else if needHelper {
				// Append only the [credential] section.
				toWrite = "\n" + strings.SplitN(block, "[url ", 2)[0]
			} else {
				// Append only the [url] insteadOf section.
				toWrite = "\n[url " + strings.SplitN(block, "[url ", 2)[1]
			}
			if _, err := f.WriteString(toWrite); err != nil {
				f.Close()
				return fmt.Errorf("write credential helper: %w", err)
			}
			f.Close()
		}
	}
```

Ensure `strings` is imported in github.go (it already imports `fmt`, `os`; add `strings`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/moltnet-cli && go test -run 'TestRunGitHubSetup' ./...`
Expected: PASS (all existing github setup tests + the new one)

- [ ] **Step 5: Commit**

```bash
git add apps/moltnet-cli/github.go apps/moltnet-cli/github_test.go
git commit -m "feat(cli): github setup writes tokenless insteadOf idempotently"
```

---

## Task 4: `config repair` strips token pollution + reinstalls helper

**Files:**
- Modify: `apps/moltnet-cli/repair.go`
- Test: `apps/moltnet-cli/repair_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestRepair_StripsPollutedGitConfig(t *testing.T) {
	dir := t.TempDir()
	// Fake a repo .git/config with the #1396 pollution.
	gitDir := filepath.Join(dir, ".git")
	os.MkdirAll(gitDir, 0o755)
	gitConfig := filepath.Join(gitDir, "config")
	os.WriteFile(gitConfig, []byte(`[core]
	repositoryformatversion = 0
[url "https://x-access-token:ghs_LEAKED@github.com/"]
	insteadof = git@github.com:
`), 0o644)

	changed, err := repairGitConfigTokens(gitConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected repair to report a change")
	}
	b, _ := os.ReadFile(gitConfig)
	if hasTokenBearingRule(string(b)) {
		t.Fatalf("token not stripped:\n%s", b)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/moltnet-cli && go test -run TestRepair_StripsPollutedGitConfig ./...`
Expected: FAIL (undefined: repairGitConfigTokens)

- [ ] **Step 3: Write minimal implementation**

Add to `repair.go`:

```go
// repairGitConfigTokens strips embedded GitHub tokens from a git config file.
// Thin wrapper over cleanGitConfigFile so repair flow stays declarative.
func repairGitConfigTokens(gitConfigPath string) (bool, error) {
	if _, err := os.Stat(gitConfigPath); os.IsNotExist(err) {
		return false, nil
	}
	return cleanGitConfigFile(gitConfigPath)
}
```

Then wire it into `runConfigRepairCmd` after the moltnet.json fixes (before the final summary). Scan both the repo `.git/config` (resolved via `git rev-parse --git-dir`) and the agent gitconfig:

```go
	// Strip any #1396 token pollution from the local repo git config and the
	// agent gitconfig. These live outside moltnet.json so they're handled here.
	for _, p := range gitConfigCandidates(creds) {
		changed, err := repairGitConfigTokens(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  [warning] could not scan %s: %v\n", p, err)
			continue
		}
		if changed {
			fmt.Fprintf(os.Stderr, "  [fixed] stripped embedded GitHub token from %s\n", p)
			fixed++
		}
	}
```

```go
// gitConfigCandidates returns git config files that may carry token pollution:
// the current repo's .git/config and the agent gitconfig (if known).
func gitConfigCandidates(creds *CredentialsFile) []string {
	var paths []string
	if out, err := exec.Command("git", "rev-parse", "--git-dir").Output(); err == nil {
		gitDir := strings.TrimSpace(string(out))
		paths = append(paths, filepath.Join(gitDir, "config"))
	}
	if creds.Git != nil && creds.Git.ConfigPath != "" {
		paths = append(paths, creds.Git.ConfigPath)
	}
	return paths
}
```

Add `"os/exec"` to repair.go imports.

> NOTE: `fixed` may now be >0 from git-config cleaning even when moltnet.json
> had no issues. Guard the existing `if len(issues) == 0` early-return so it
> does not short-circuit before the git-config scan runs. Move the git-config
> scan ABOVE that early return, or fold git-config findings into `issues`
> before the length check. Simplest: run the scan first, append a synthetic
> ConfigIssue per cleaned file, then continue into the existing flow.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/moltnet-cli && go test -run 'TestRepair|TestLoadAndValidate|TestRunConfigRepair' ./...`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/moltnet-cli/repair.go apps/moltnet-cli/repair_test.go
git commit -m "feat(cli): config repair strips embedded GitHub tokens from git config"
```

---

## Task 5: Drop hand-rolled helper from pi-extension, rely on injected gitconfig

**Files:**
- Modify: `libs/pi-extension/src/vm-manager.ts:569-586`
- Test: `libs/pi-extension/src/vm-manager.spec.ts` (if a gitconfig-injection test exists; otherwise assert via the injected-gitconfig string)

- [ ] **Step 1: Write/adjust the failing test**

If `vm-manager` has a unit test around `rewriteMoltnetJsonPaths`/gitconfig injection, add an assertion that the injected gitconfig contains `moltnet github credential-helper` and `insteadOf = git@github.com:` and NOT a `git-credential-moltnet` script path. If no such test harness exists (VM tests need Gondolin), SKIP automated test here and rely on the e2e daemon smoke test; document that omission in the commit body.

- [ ] **Step 2: Run test to verify current behavior**

Run: `pnpm exec nx run @themoltnet/pi-extension:test`
Expected: baseline green before edit.

- [ ] **Step 3: Implement — replace lines 569-586**

The injected gitconfig (from `moltnet github setup`, Task 3) now carries the
helper + insteadOf. The VM must rewrite the `--credentials` path in the helper
line to the VM-side absolute path, same as it already rewrites `signingKey`
(line 520). Replace the hand-rolled-script block with a rewrite of the helper
line during gitconfig injection (extend the existing `creds.gitconfig` block at
lines 518-528):

```ts
    if (creds.gitconfig) {
      const vmSigningKey = `${vmSshDir}/id_ed25519`;
      let vmGitconfig = creds.gitconfig.replace(
        /signingKey\s*=\s*.+/g,
        `signingKey = ${vmSigningKey}`,
      );
      // Rewrite the credential-helper --credentials path to the VM-side
      // moltnet.json so `moltnet github credential-helper` resolves the right
      // agent inside the guest. The host path is invalid in the VM.
      vmGitconfig = vmGitconfig.replace(
        /(moltnet github credential-helper --credentials )\S+/g,
        `$1${vmAgentDir}/moltnet.json`,
      );
      await vm.fs.writeFile(`${vmAgentDir}/gitconfig`, vmGitconfig, {
        mode: 0o644,
        signal: config.signal,
      });
    }
```

Then DELETE the entire `gitCredHelperPath` / `credHelperScript` / `vmRun('git credential helper', ...)` block (old lines 569-586).

> Rationale: the imperative `git config --global ... insteadOf` ran against the
> guest `$HOME` and duplicated what the gitconfig now carries. Removing it
> eliminates the parallel mechanism that could drift from the CLI source of
> truth. If the injected gitconfig lacks the helper (pre-Task-3 agents), the
> guest simply has no HTTPS rewrite — acceptable; those agents should re-run
> `moltnet github setup` or `moltnet config repair`.

- [ ] **Step 4: Typecheck + test**

Run: `pnpm exec nx run @themoltnet/pi-extension:typecheck && pnpm exec nx run @themoltnet/pi-extension:test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/pi-extension/src/vm-manager.ts
git commit -m "refactor(pi-extension): rely on injected gitconfig for git credentials"
```

---

## Task 6: CI token-leak guard

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a grep step**

Add a job (or a step in an existing lint job) that fails if a token literal
appears in any tracked git config or committed file:

```yaml
  token-leak-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fail on embedded GitHub tokens
        run: |
          set -euo pipefail
          # ghs_ = server-to-server (Actions), ghp_ = personal. Neither should
          # ever be committed or embedded in a git config insteadOf rule.
          if grep -rIns -E 'gh[ps]_[A-Za-z0-9]{20,}' . \
               --exclude-dir=.git \
               --exclude-dir=node_modules; then
            echo "::error::Embedded GitHub token found (see #1396)"
            exit 1
          fi
          echo "No embedded GitHub tokens found."
```

> NOTE: confirm the exact runner/check-name conventions against the existing
> `.github/workflows/ci.yml` job matrix before merging — match its style
> (needs:, concurrency:, etc.). The scan must exclude `.git` and `node_modules`
> and any encrypted-but-committed `.env`/`env.public` (dotenvx ciphertext won't
> match the token regex, but verify).

- [ ] **Step 2: Lint the workflow locally if possible**

Run: `pnpm exec nx run ... ` (no-op if no workflow linter) — at minimum
`yamllint .github/workflows/ci.yml` if available, else visual review.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail build on embedded GitHub tokens (#1396)"
```

---

## Self-Review Notes

- **Spec coverage:** issue asks for (1) one of three mechanisms — chosen: mint-on-demand helper in gitconfig (combines proposals 1+3, tokenless); (2) CI grep for `ghs_`/`ghp_` — Task 6; (3) one-shot migration to strip existing embedded tokens — Task 4 (`config repair`) + the manual unblock already applied to this checkout. All covered.
- **Token regex** is consistent across Tasks 1, 3, 4 (`gh[a-z]_` / `gh[ps]_`). Task 6 uses `gh[ps]_{20,}` to avoid false positives on prose; unit-side uses looser `gh[a-z]_` since it scans structured config only. Acceptable divergence, documented here.
- **Idempotency** asserted in Tasks 3 and 1 (second-pass no-op).
- **Out of scope** (per issue): rotating the already-invalidated token, macOS keychain, VM DNS.
