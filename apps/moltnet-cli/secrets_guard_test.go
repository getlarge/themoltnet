package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestSecretsGuardDeniesCredentialReaders(t *testing.T) {
	t.Parallel()
	readers := []string{"cat", "sed -n 1p", "rg secret", "grep secret", "head", "tail", "awk '{print}'", "jq .", "strings", "xxd", "base64", "ls"}
	for _, reader := range readers {
		reader := reader
		t.Run(reader, func(t *testing.T) {
			command := reader + " .moltnet/agent/moltnet.json"
			if reason := evaluateSecretsShell(command); reason == "" {
				t.Fatalf("expected denial for %q", command)
			}
		})
	}
}

func TestSecretsGuardDeniesAlternateShellConstructs(t *testing.T) {
	t.Parallel()
	commands := []string{
		`P=.moltnet/agent/env; cat "$P"`,
		`cat ".moltnet/$AGENT/env"`,
		`cat < .moltnet/agent/env`,
		`x=$(cat .moltnet/agent/moltnet.json)`,
		`cat .moltnet/agent/env | base64`,
		`bash -c 'cat .moltnet/agent/env'`,
		`find .moltnet -type f -print`,
		`security find-generic-password -w -s themolt.net`,
		`secret-tool lookup service themolt.net`,
		`moltnet config export-env --credentials .moltnet/agent/moltnet.json --show-secret`,
		`moltnet github token --credentials .moltnet/agent/moltnet.json`,
		`GH_TOKEN=$(moltnet github token --credentials .moltnet/agent/moltnet.json) gh pr view 1; moltnet github token --credentials .moltnet/agent/moltnet.json`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShell(command); reason == "" {
			t.Errorf("expected denial for %q", command)
		}
	}
}

func TestSecretsGuardAllowsSafeOperations(t *testing.T) {
	t.Parallel()
	commands := []string{
		`stat .moltnet/agent/moltnet.json`,
		`test -f .moltnet/agent/moltnet.json`,
		`cat apps/moltnet-cli/main.go`,
		`moltnet agents activation validate --agent agent --credentials .moltnet/agent/moltnet.json`,
		`moltnet env check --agent agent`,
		`moltnet entry list --credentials .moltnet/agent/moltnet.json`,
		`GH_TOKEN=$(moltnet github token --credentials .moltnet/agent/moltnet.json) gh pr view 1`,
	}
	for _, command := range commands {
		if reason := evaluateSecretsShell(command); reason != "" {
			t.Errorf("unexpected denial for %q: %s", command, reason)
		}
	}
}

func TestSecretsGuardDirectFileTools(t *testing.T) {
	t.Parallel()
	input := secretHookInput{ToolName: "Read", ToolInput: map[string]any{"file_path": "/repo/.moltnet/agent/env"}}
	payload, _ := json.Marshal(input)
	var output bytes.Buffer
	if err := runSecretsGuardCmd(bytes.NewReader(payload), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected deny output, got %s", output.String())
	}
}

func TestSecretsGuardMalformedInputFailsClosed(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	if err := runSecretsGuardCmd(strings.NewReader("{"), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), `"permissionDecision":"deny"`) {
		t.Fatalf("expected deny output, got %s", output.String())
	}
}

func TestCanonicalGuidanceDoesNotReadCredentialFiles(t *testing.T) {
	t.Parallel()
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	unsafe := regexp.MustCompile(`(?im)(?:^|\n)\s*(?:(?:cat|sed|grep|rg|head|tail|awk|jq|strings|xxd|base64)\s+[^\n]*\.moltnet/[^\n]*(?:/env|moltnet\.json|\.pem|id_ed25519)|source\s+\.moltnet/[^\s]+/env)`)
	paths := []string{
		filepath.Join(repoRoot, ".agents", "skills"),
		filepath.Join(repoRoot, "docs"),
		filepath.Join(repoRoot, "packages", "legreffier-cli", "README.md"),
	}
	for _, root := range paths {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || filepath.Ext(path) != ".md" || filepath.Base(path) == "CHANGELOG.md" {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if match := unsafe.Find(data); match != nil {
				t.Errorf("unsafe credential-reading guidance in %s: %q", path, match)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("scan %s: %v", root, err)
		}
	}
}
