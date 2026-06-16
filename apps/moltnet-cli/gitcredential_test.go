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
	if hasTokenBearingRule(block) {
		t.Fatalf("block must never embed a token:\n%s", block)
	}
}

func TestBuildCredentialBlock_NoCredPath(t *testing.T) {
	block := buildCredentialBlock("")
	if !strings.Contains(block, `helper = "!moltnet github credential-helper"`) {
		t.Fatalf("expected bare helper when no cred path:\n%s", block)
	}
}
