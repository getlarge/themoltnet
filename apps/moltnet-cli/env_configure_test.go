package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupCentralEnvFixture(t *testing.T) (string, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	agentDir := filepath.Join(home, ".config", "moltnet", "identities", "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(agentDir, "env")
	if err := os.WriteFile(envPath, []byte("MOLTNET_TEAM_ID='team'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return home, envPath
}

func TestEnvConfigurePreservesUnmanagedContentAndPermissions(t *testing.T) {
	_, envPath := setupCentralEnvFixture(t)
	if err := os.WriteFile(envPath, []byte("# keep me\nCUSTOM='unchanged'\nMOLTNET_TEAM_ID='old'\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "env", "configure", "--identity", "test-agent",
		"--team-id", "new-team", "--authorship", "coauthor", "--human-git-identity", "Jane Doe <jane@example.com>")
	if err != nil {
		t.Fatalf("configure: %v", err)
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{"# keep me", "CUSTOM='unchanged'", "MOLTNET_TEAM_ID='new-team'", "MOLTNET_COMMIT_AUTHORSHIP='coauthor'", "MOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'"} {
		if !strings.Contains(content, want) {
			t.Fatalf("missing %q in:\n%s", want, content)
		}
	}
	if strings.Contains(stdout, "Jane Doe") || strings.Contains(stdout, "new-team") {
		t.Fatalf("output must contain field names only: %s", stdout)
	}
	info, err := os.Stat(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o, want 600", info.Mode().Perm())
	}
}

func TestEnvConfigureClearsManagedValue(t *testing.T) {
	_, envPath := setupCentralEnvFixture(t)
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "env", "configure", "--identity", "test-agent", "--clear-team-id")
	if err != nil {
		t.Fatalf("configure: %v", err)
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "MOLTNET_TEAM_ID=") {
		t.Fatalf("team id was not removed:\n%s", data)
	}
}

func TestEnvConfigureRejectsAuthorshipWithoutHumanIdentity(t *testing.T) {
	_, envPath := setupCentralEnvFixture(t)
	before, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "env", "configure", "--identity", "test-agent", "--authorship", "human")
	if err == nil || !strings.Contains(err.Error(), "requires --human-git-identity") {
		t.Fatalf("expected resulting-state validation, got %v", err)
	}
	after, readErr := os.ReadFile(envPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(after) != string(before) {
		t.Fatal("invalid authorship transition modified the env file")
	}
}

func TestEnvConfigureRejectsClearingRequiredHumanIdentity(t *testing.T) {
	_, envPath := setupCentralEnvFixture(t)
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, []byte("MOLTNET_COMMIT_AUTHORSHIP='coauthor'\nMOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'\n")...)
	if err := os.WriteFile(envPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "env", "configure", "--identity", "test-agent", "--clear-human-git-identity")
	if err == nil || !strings.Contains(err.Error(), "requires --human-git-identity") {
		t.Fatalf("expected resulting-state validation, got %v", err)
	}
}

func TestEnvConfigureAllowsAtomicSwitchToAgentAndIdentityClear(t *testing.T) {
	_, envPath := setupCentralEnvFixture(t)
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, []byte("MOLTNET_COMMIT_AUTHORSHIP='coauthor'\nMOLTNET_HUMAN_GIT_IDENTITY='Jane Doe <jane@example.com>'\n")...)
	if err := os.WriteFile(envPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "env", "configure", "--identity", "test-agent", "--authorship", "agent", "--clear-human-git-identity")
	if err != nil {
		t.Fatalf("configure: %v", err)
	}
	after, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	content := string(after)
	if !strings.Contains(content, "MOLTNET_COMMIT_AUTHORSHIP='agent'") || strings.Contains(content, "MOLTNET_HUMAN_GIT_IDENTITY=") {
		t.Fatalf("atomic transition was not persisted: %s", content)
	}
}
