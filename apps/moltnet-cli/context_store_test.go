package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

const (
	contextTestTeam  = "00000000-0000-4000-8000-000000000011"
	contextTestDiary = "00000000-0000-4000-8000-000000000001"
)

func TestNormalizeGitRemoteKeyProviderNeutral(t *testing.T) {
	tests := map[string]string{
		"git@github.com:getlarge/themoltnet.git":                "git:github.com/getlarge/themoltnet",
		"https://token@example.com/Group/repo.git":              "git:example.com/Group/repo",
		"ssh://git@gitlab.example.test:2222/nested/project.git": "git:gitlab.example.test/nested/project",
		"https://example.com/repositories/name..with-dots.git":  "git:example.com/repositories/name..with-dots",
	}
	for remote, want := range tests {
		got, err := normalizeGitRemoteKey(remote)
		if err != nil {
			t.Fatalf("normalize %q: %v", remote, err)
		}
		if got != want {
			t.Errorf("normalize %q = %q, want %q", remote, got, want)
		}
	}
}

func initContextTestRepository(t *testing.T, remote string) string {
	t.Helper()
	directory := t.TempDir()
	for _, args := range [][]string{{"init"}, {"remote", "add", "origin", remote}} {
		command := exec.Command("git", append([]string{"-C", directory}, args...)...)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, output)
		}
	}
	return directory
}

func TestResolveContextSharesRepositoryBindingAcrossClones(t *testing.T) {
	agentDir := t.TempDir()
	first := initContextTestRepository(t, "git@github.com:getlarge/themoltnet.git")
	second := initContextTestRepository(t, "https://github.com/getlarge/themoltnet.git")
	binding := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	set, err := setContextBinding(agentDir, first, binding, false, "")
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, second)
	if err != nil {
		t.Fatal(err)
	}
	if set.Key != "git:github.com/getlarge/themoltnet" || resolved.Key != set.Key || resolved.Source != "repository" || resolved.Binding == nil || *resolved.Binding != binding {
		t.Fatalf("repository binding did not follow the remote: set=%+v resolved=%+v", set, resolved)
	}
}

func TestResolveContextDirectoryOverrideAndAncestorPrecedeRepository(t *testing.T) {
	agentDir := t.TempDir()
	repository := initContextTestRepository(t, "ssh://git@gitlab.example.test/team/project.git")
	child := filepath.Join(repository, "packages", "worker")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	repositoryBinding := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	if _, err := setContextBinding(agentDir, repository, repositoryBinding, false, ""); err != nil {
		t.Fatal(err)
	}
	override := contextBinding{TeamID: contextTestTeam, DiaryID: "00000000-0000-4000-8000-000000000002"}
	if _, err := setContextBinding(agentDir, "", override, false, filepath.Join(repository, "packages")); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, child)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source != "directory" || resolved.Binding == nil || *resolved.Binding != override {
		t.Fatalf("directory override did not win: %+v", resolved)
	}
	overrideDirectory, err := canonicalDirectory(filepath.Join(repository, "packages"))
	if err != nil {
		t.Fatal(err)
	}
	if key, err := clearContextBinding(agentDir, child, false, ""); err != nil {
		t.Fatal(err)
	} else if key != "dir:"+overrideDirectory {
		t.Fatalf("cleared key = %q", key)
	}
	resolved, err = resolveContextBinding(agentDir, child)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source != "repository" || resolved.Binding == nil || *resolved.Binding != repositoryBinding {
		t.Fatalf("repository binding did not resume after clear: %+v", resolved)
	}
}

func TestResolveContextDefaultKeepsPerFolderCacheIsolation(t *testing.T) {
	agentDir := t.TempDir()
	first := t.TempDir()
	second := t.TempDir()
	binding := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	if _, err := setContextBinding(agentDir, "", binding, true, ""); err != nil {
		t.Fatal(err)
	}
	one, err := resolveContextBinding(agentDir, first)
	if err != nil {
		t.Fatal(err)
	}
	two, err := resolveContextBinding(agentDir, second)
	if err != nil {
		t.Fatal(err)
	}
	if one.Source != "default" || two.Source != "default" || one.Key == two.Key {
		t.Fatalf("default contexts are not isolated: one=%+v two=%+v", one, two)
	}
	if activationCachePathForContext(agentDir, one.Key) == activationCachePathForContext(agentDir, two.Key) {
		t.Fatal("default contexts unexpectedly share an activation cache")
	}
}

func TestContextCommandsSetShowAndClearDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	agentDir := filepath.Join(home, ".config", "moltnet", "identities", "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeIdentitySelector("test-agent"); err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	root := NewRootCmd("test", "")
	if _, _, err := executeCommand(root, "context", "set", "--directory", directory, "--team-id", contextTestTeam, "--diary-id", contextTestDiary); err != nil {
		t.Fatal(err)
	}
	root = NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "context", "show", "--directory", directory, "--json")
	if err != nil {
		t.Fatal(err)
	}
	var shown contextShowResult
	if err := json.Unmarshal([]byte(stdout), &shown); err != nil {
		t.Fatal(err)
	}
	if shown.Source != "directory" || shown.TeamID != contextTestTeam || shown.DiaryID != contextTestDiary {
		t.Fatalf("unexpected context show result: %+v", shown)
	}
	root = NewRootCmd("test", "")
	if _, _, err := executeCommand(root, "context", "clear", "--directory", directory); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, directory)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Binding != nil {
		t.Fatalf("directory binding survived clear: %+v", resolved)
	}
}
