package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

const (
	contextTestTeam  = "00000000-0000-4000-8000-000000000011"
	contextTestDiary = "00000000-0000-4000-8000-000000000001"
)

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

func TestResolveContextDoesNotBindOtherClones(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	agentDir := t.TempDir()
	first := initContextTestRepository(t, "git@github.com:getlarge/themoltnet.git")
	second := initContextTestRepository(t, "https://github.com/getlarge/themoltnet.git")
	writeProjectTestBinding(t, first, contextTestDiary)
	resolved, err := resolveContextBinding(agentDir, second)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Binding != nil {
		t.Fatalf("another checkout inherited a registration: %+v", resolved)
	}
}

func TestResolveContextSubdirectoryUsesRegisteredAncestor(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	agentDir := t.TempDir()
	repository := initContextTestRepository(t, "ssh://git@gitlab.example.test/team/project.git")
	child := filepath.Join(repository, "packages", "worker")
	if err := os.MkdirAll(child, 0700); err != nil {
		t.Fatal(err)
	}
	writeProjectTestBinding(t, repository, contextTestDiary)
	resolved, err := resolveContextBinding(agentDir, child)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Source != contextSourceLocation || resolved.diaryID() != contextTestDiary {
		t.Fatalf("ancestor not selected: %+v", resolved)
	}
}

func TestResolveContextRegisteredFolderIncludesNestedRepository(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	agentDir := t.TempDir()
	workspace := t.TempDir()
	writeProjectTestBinding(t, workspace, contextTestDiary)
	repository := filepath.Join(workspace, "project")
	if err := os.Mkdir(repository, 0700); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "-C", repository, "init").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, output)
	}
	resolved, err := resolveContextBinding(agentDir, repository)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.diaryID() != contextTestDiary {
		t.Fatalf("registered ancestor not selected: %+v", resolved)
	}
}

func writeContextTestEnv(t *testing.T, agentDir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestResolveContextFallsBackToIdentityDefault(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
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
	writeProjectTestBinding(t, location, bound.DiaryID)
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
	t.Setenv("HOME", t.TempDir())
	agentDir := t.TempDir()
	real := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	writeProjectTestBinding(t, link, contextTestDiary)
	resolved, err := resolveContextBinding(agentDir, real)
	if err != nil {
		t.Fatal(err)
	}
	alias, err := resolveContextBinding(agentDir, link)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Key != alias.Key || resolved.diaryID() != contextTestDiary {
		t.Fatalf("alias resolution mismatch: %+v %+v", resolved, alias)
	}
}
