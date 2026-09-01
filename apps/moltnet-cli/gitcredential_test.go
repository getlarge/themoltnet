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

func TestEnsureGitHubCredentialConfigIsIdempotentAndQuotesPath(t *testing.T) {
	dir := t.TempDir()
	gitConfigPath := filepath.Join(dir, "gitconfig")
	if err := os.WriteFile(gitConfigPath, []byte("[user]\n\tname = Agent\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	credentialsPath := filepath.Join(dir, "agent's credentials", "moltnet.json")
	if err := ensureGitHubCredentialConfig(gitConfigPath, credentialsPath); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(gitConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureGitHubCredentialConfig(gitConfigPath, credentialsPath); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(gitConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("credential installation is not idempotent:\nfirst:\n%s\nsecond:\n%s", first, second)
	}
	values, err := gitConfigGetAll(gitConfigPath, "credential.https://github.com.helper")
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 || values[0] != "" || !strings.Contains(values[1], `'\''`) {
		t.Fatalf("helper values = %#v, want reset then shell-quoted command", values)
	}
}

func TestNeedsHelperReset(t *testing.T) {
	// A github.com helper block WITHOUT the empty reset is shadow-prone.
	shadowProne := `[credential "https://github.com"]
	helper = "!moltnet github credential-helper --credentials /x/moltnet.json"
`
	if !needsHelperReset(shadowProne) {
		t.Fatal("expected shadow-prone block to need a reset")
	}
	// Already has the reset — no action.
	fixed := `[credential "https://github.com"]
	helper = ""
	helper = "!moltnet github credential-helper --credentials /x/moltnet.json"
`
	if needsHelperReset(fixed) {
		t.Fatal("block with reset must not need another")
	}
	// No github.com credential helper at all — nothing to reset.
	none := `[user]
	name = x
`
	if needsHelperReset(none) {
		t.Fatal("block without a github helper must not need a reset")
	}
}

func TestAddHelperReset(t *testing.T) {
	in := `[user]
	name = LeGreffier
[credential "https://github.com"]
	helper = "!moltnet github credential-helper --credentials /x/moltnet.json"
[url "https://github.com/"]
	insteadOf = git@github.com:
`
	out := addHelperReset(in)
	// The empty reset must be inserted immediately after the credential header,
	// before the real helper.
	resetIdx := strings.Index(out, `helper = ""`)
	realIdx := strings.Index(out, "credential-helper")
	if resetIdx == -1 {
		t.Fatalf("reset not added:\n%s", out)
	}
	if resetIdx > realIdx {
		t.Fatalf("reset must precede the real helper:\n%s", out)
	}
	// Unrelated sections preserved.
	if !strings.Contains(out, "name = LeGreffier") || !strings.Contains(out, "insteadOf = git@github.com:") {
		t.Fatalf("unrelated content lost:\n%s", out)
	}
	// Idempotent.
	if needsHelperReset(out) {
		t.Fatalf("addHelperReset output should not still need a reset:\n%s", out)
	}
}
