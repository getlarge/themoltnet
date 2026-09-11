package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const (
	contextTestTeam  = "00000000-0000-4000-8000-000000000011"
	contextTestDiary = "00000000-0000-4000-8000-000000000001"
)

func TestNormalizeGitRemoteKeyProviderNeutral(t *testing.T) {
	tests := map[string]string{
		"git@github.com:getlarge/themoltnet.git":                "git:github.com/getlarge/themoltnet",
		"https://token@example.com/Group/repo.git":              "git:example.com/group/repo",
		"ssh://git@gitlab.example.test:2222/nested/project.git": "git:gitlab.example.test/nested/project",
		"https://example.com/repositories/name..with-dots.git":  "git:example.com/repositories/name..with-dots",
		// A trailing slash after the .git suffix must not keep the suffix.
		"https://github.com/getlarge/themoltnet.git/": "git:github.com/getlarge/themoltnet",
		// Case differs between remotes of one repository; the key must not.
		"git@github.com:GetLarge/TheMoltNet.git": "git:github.com/getlarge/themoltnet",
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
	set, err := setContextBinding(agentDir, first, binding)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, second)
	if err != nil {
		t.Fatal(err)
	}
	if set.Key != "git:github.com/getlarge/themoltnet" || resolved.Key != set.Key ||
		resolved.Source != contextSourceLocation || resolved.Binding == nil || *resolved.Binding != binding {
		t.Fatalf("repository binding did not follow the remote: set=%+v resolved=%+v", set, resolved)
	}
}

// A subdirectory of a repository is the same location as its root: the key is
// the remote, not the path.
func TestResolveContextSubdirectoryUsesRepositoryBinding(t *testing.T) {
	agentDir := t.TempDir()
	repository := initContextTestRepository(t, "ssh://git@gitlab.example.test/team/project.git")
	child := filepath.Join(repository, "packages", "worker")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	binding := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	if _, err := setContextBinding(agentDir, repository, binding); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, child)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source != contextSourceLocation || resolved.Binding == nil || *resolved.Binding != binding {
		t.Fatalf("subdirectory did not resolve to its repository binding: %+v", resolved)
	}
}

// Regression guard: a binding made in a plain folder must never shadow the
// repositories inside it. An earlier design walked ancestor directories before
// the Git remote, so one binding on ~/Dev silently redirected every repository
// under it to the wrong team and diary.
func TestResolveContextAncestorFolderDoesNotShadowRepository(t *testing.T) {
	agentDir := t.TempDir()
	workspace := t.TempDir()
	folderBinding := contextBinding{TeamID: contextTestTeam, DiaryID: "00000000-0000-4000-8000-000000000002"}
	if _, err := setContextBinding(agentDir, workspace, folderBinding); err != nil {
		t.Fatal(err)
	}
	repository := filepath.Join(workspace, "project")
	if err := os.MkdirAll(repository, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init"}, {"remote", "add", "origin", "https://github.com/o/project.git"}} {
		if output, err := exec.Command("git", append([]string{"-C", repository}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, output)
		}
	}

	resolved, err := resolveContextBinding(agentDir, repository)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Key != "git:github.com/o/project" {
		t.Fatalf("key = %q, want the repository's remote key", resolved.Key)
	}
	if resolved.Source == contextSourceLocation {
		t.Fatalf("the enclosing folder's binding leaked into the repository: %+v", resolved)
	}

	// A plain subfolder of the bound folder is a different location too.
	subfolder := filepath.Join(workspace, "notes")
	if err := os.MkdirAll(subfolder, 0o755); err != nil {
		t.Fatal(err)
	}
	resolved, err = resolveContextBinding(agentDir, subfolder)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source == contextSourceLocation {
		t.Fatalf("a parent folder's binding applied to a subfolder: %+v", resolved)
	}
}

func writeContextTestEnv(t *testing.T, agentDir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestResolveContextFallsBackToIdentityDefault(t *testing.T) {
	agentDir := t.TempDir()
	location := t.TempDir()
	writeContextTestEnv(t, agentDir, fmt.Sprintf("MOLTNET_TEAM_ID='%s'\nMOLTNET_DIARY_ID='%s'\n", contextTestTeam, contextTestDiary))

	resolved, err := resolveContextBinding(agentDir, location)
	if err != nil {
		t.Fatal(err)
	}
	want := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	if resolved.Source != contextSourceIdentityDefault || resolved.Binding == nil || *resolved.Binding != want {
		t.Fatalf("unbound location did not fall back to the identity default: %+v", resolved)
	}

	// A binding for the location takes priority over the identity default.
	bound := contextBinding{TeamID: contextTestTeam, DiaryID: "00000000-0000-4000-8000-000000000003"}
	if _, err := setContextBinding(agentDir, location, bound); err != nil {
		t.Fatal(err)
	}
	resolved, err = resolveContextBinding(agentDir, location)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source != contextSourceLocation || resolved.Binding == nil || *resolved.Binding != bound {
		t.Fatalf("location binding did not take priority: %+v", resolved)
	}
}

func TestResolveContextPartialIdentityDefaultIsNotABinding(t *testing.T) {
	agentDir := t.TempDir()
	writeContextTestEnv(t, agentDir, fmt.Sprintf("MOLTNET_TEAM_ID='%s'\n", contextTestTeam))
	resolved, err := resolveContextBinding(agentDir, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Binding != nil || resolved.Source != "" {
		t.Fatalf("a team without a diary must not resolve as a binding: %+v", resolved)
	}
}

// A binding made through a symlinked path must resolve through the real path
// (and vice versa). On macOS /var and /tmp are themselves symlinks.
func TestResolveContextThroughSymlinkedDirectory(t *testing.T) {
	agentDir := t.TempDir()
	real := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	binding := contextBinding{TeamID: contextTestTeam, DiaryID: contextTestDiary}
	set, err := setContextBinding(agentDir, link, binding)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBinding(agentDir, real)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Key != set.Key || resolved.Source != contextSourceLocation || resolved.Binding == nil || *resolved.Binding != binding {
		t.Fatalf("symlinked and real paths resolved differently: set=%+v resolved=%+v", set, resolved)
	}
}

// Concurrent writers each hold the store lock across read-modify-write, so no
// binding is lost when several locations are bound at once.
func TestSetContextBindingConcurrentWritersKeepEveryBinding(t *testing.T) {
	agentDir := t.TempDir()
	const writers = 16
	locations := make([]string, writers)
	for index := range locations {
		locations[index] = t.TempDir()
	}
	var group sync.WaitGroup
	errs := make(chan error, writers)
	for index := range locations {
		group.Add(1)
		go func(location string, index int) {
			defer group.Done()
			binding := contextBinding{TeamID: contextTestTeam, DiaryID: fmt.Sprintf("00000000-0000-4000-8000-%012d", index)}
			if _, err := setContextBinding(agentDir, location, binding); err != nil {
				errs <- err
			}
		}(locations[index], index)
	}
	group.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	store, err := readContextStore(agentDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.Contexts) != writers {
		t.Fatalf("store holds %d bindings after %d concurrent writers; updates were lost", len(store.Contexts), writers)
	}
}

func TestReadContextStoreRejectsNewerVersion(t *testing.T) {
	agentDir := t.TempDir()
	if err := os.WriteFile(contextStorePath(agentDir), []byte(`{"version": 99}`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := readContextStore(agentDir)
	if err == nil || !strings.Contains(err.Error(), "contexts.json") || !strings.Contains(err.Error(), "newer") {
		t.Fatalf("a newer store must fail and name the file and cause, got: %v", err)
	}
}

func useContextTestIdentity(t *testing.T) (string, string) {
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
	if err := writeIdentitySelector("test-agent"); err != nil {
		t.Fatal(err)
	}
	location := t.TempDir()
	original := contextWorkingDirectory
	contextWorkingDirectory = func() (string, error) { return location, nil }
	t.Cleanup(func() { contextWorkingDirectory = original })
	return agentDir, location
}

func TestContextCommandsSetShowAndClearHere(t *testing.T) {
	agentDir, location := useContextTestIdentity(t)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "context", "set", "--team-id", contextTestTeam, "--diary-id", contextTestDiary)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout, "Bound") {
		t.Fatalf("unexpected set output: %s", stdout)
	}

	root = NewRootCmd("test", "")
	stdout, _, err = executeCommand(root, "context", "show", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var shown contextShowResult
	if err := json.Unmarshal([]byte(stdout), &shown); err != nil {
		t.Fatal(err)
	}
	if shown.Source != contextSourceLocation || shown.TeamID != contextTestTeam || shown.DiaryID != contextTestDiary {
		t.Fatalf("unexpected context show result: %+v", shown)
	}

	root = NewRootCmd("test", "")
	stdout, _, err = executeCommand(root, "context", "clear")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout, "Cleared") {
		t.Fatalf("unexpected clear output: %s", stdout)
	}
	resolved, err := resolveContextBinding(agentDir, location)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Binding != nil {
		t.Fatalf("binding survived clear: %+v", resolved)
	}
}

// Clearing a location that has no binding must say so rather than report a
// change that did not happen.
func TestContextClearReportsWhenNothingIsBound(t *testing.T) {
	useContextTestIdentity(t)
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "context", "clear")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stdout, "Cleared") || !strings.Contains(stdout, "nothing to clear") {
		t.Fatalf("clear misreported an unbound location: %s", stdout)
	}
}
