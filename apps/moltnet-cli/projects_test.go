package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
)

func TestProjectsCommands(t *testing.T) {
	root := NewRootCmd("test", "")
	out, _, err := executeCommand(root, "projects", "--help")
	if err != nil {
		t.Fatal(err)
	}
	for _, command := range []string{"create", "list", "get", "update", "archive", "bindings"} {
		if !strings.Contains(out, command) {
			t.Errorf("missing %s", command)
		}
	}
}
func TestProjectsBindingsRoundTrip(t *testing.T) {
	path := t.TempDir() + "/projects.json"
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "projects", "bindings", "set", "local", "--config-file", path, "--api-url", "https://api.example", "--team-id", "team", "--project-id", "project", "--source", t.TempDir(), "--strategy", "existing")
	if err != nil {
		t.Fatal(err)
	}
	root = NewRootCmd("test", "")
	out, _, err := executeCommand(root, "projects", "bindings", "resolve", "--config-file", path, "--binding", "local", "--api-url", "https://api.example")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"projectId": "project"`) {
		t.Fatalf("unexpected resolution: %s", out)
	}
}
func TestProjectsBindingsRequireStrategy(t *testing.T) {
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "projects", "bindings", "set", "local", "--config-file", t.TempDir()+"/projects.json", "--team-id", "team", "--project-id", "project", "--source", t.TempDir())
	if err == nil {
		t.Fatal("must explicitly choose a workspace strategy")
	}
}

func TestProjectsBindingsResolveHonorsAPIEndpoint(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	err := projectconfig.Update(path, func(config *projectconfig.Config) error {
		config.Bindings = []projectconfig.Binding{{Name: "local", APIURL: "https://api.example", TeamID: "team", ProjectID: "project", Strategy: "none"}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = executeCommand(NewRootCmd("test", ""), "projects", "bindings", "resolve", "--config-file", path, "--binding", "local", "--api-url", "https://other.example")
	if err == nil {
		t.Fatal("expected a conflicting endpoint to reject the binding")
	}
}

func TestProjectNativeContextUsesRegisteredAncestor(t *testing.T) {
	source := t.TempDir()
	child := filepath.Join(source, "nested")
	if err := os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(t.TempDir(), "projects.json")
	err := projectconfig.Update(configPath, func(config *projectconfig.Config) error {
		config.Bindings = []projectconfig.Binding{{Name: "local", APIURL: "https://api.example", TeamID: "team", ProjectID: "project", DiaryID: "diary", Source: source, Strategy: "git-worktree"}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveContextBindingWithProjectOptions(t.TempDir(), child, configPath, "", "https://api.example")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.teamID() != "team" || resolved.diaryID() != "diary" || resolved.Project == nil || resolved.Project.ProjectID != "project" {
		t.Fatalf("unexpected selection: %+v", resolved)
	}
}

func TestProjectNativeResolutionIgnoresLegacyRemoteBindings(t *testing.T) {
	identity := t.TempDir()
	err := os.WriteFile(contextStorePath(identity), []byte(`{"version":1,"contexts":{"git:example/repo":{"teamId":"team","diaryId":"diary"}}}`), 0600)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolveContextBindingWithProjectOptions(identity, t.TempDir(), filepath.Join(t.TempDir(), "projects.json"), "")
	if err != nil || selected.Project != nil || selected.Binding != nil {
		t.Fatalf("legacy registration influenced project resolution: %+v %v", selected, err)
	}
}

func TestProjectStartSelectsSourceWithoutPreparingWorkspace(t *testing.T) {
	setupStartUnboundFixture(t, "")
	source := t.TempDir()
	configPath := filepath.Join(t.TempDir(), "projects.json")
	err := projectconfig.Update(configPath, func(config *projectconfig.Config) error {
		config.Bindings = []projectconfig.Binding{{Name: "local", APIURL: defaultAPIURL, TeamID: "team", ProjectID: "project", Source: source, Strategy: "git-worktree", Hooks: &projectconfig.Hooks{BeforeRun: &projectconfig.Hook{Command: "must-not-run", Args: []string{}, TimeoutMS: 1000}}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	out, _, err := executeCommand(NewRootCmd("test", ""), "start", "echo", "--identity", "test-agent", "--config-file", configPath, "--binding", "local", "--dry-run")
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "MOLTNET_PROJECT_ID=project") || !strings.Contains(out, "Working directory: "+canonical) {
		t.Fatalf("missing project selection: %s", out)
	}
	entries, err := os.ReadDir(source)
	if err != nil || len(entries) != 0 {
		t.Fatalf("native launcher prepared source: %v, %v", entries, err)
	}
}

func TestProjectsListPaginationFlags(t *testing.T) {
	out, _, err := executeCommand(NewRootCmd("test", ""), "projects", "list", "--help")
	if err != nil {
		t.Fatal(err)
	}
	for _, flag := range []string{"--limit", "--offset"} {
		if !strings.Contains(out, flag) {
			t.Errorf("missing %s", flag)
		}
	}
}

func TestProjectsListPaginationRequest(t *testing.T) {
	isolateCredentialDiscovery(t)
	t.Setenv(agentKeyEnv, "ak_test_pagination")
	t.Setenv(agentKeyRefEnv, "")
	var received, requestPath, selectedTeam string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.URL.RawQuery
		requestPath = r.URL.Path
		selectedTeam = r.Header.Get("x-moltnet-team-id")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[],"nextOffset":75}`))
	}))
	defer server.Close()
	out, _, err := executeCommand(NewRootCmd("test", ""), "projects", "list", "--team-id", "00000000-0000-0000-0000-000000000001", "--api-url", server.URL, "--limit", "25", "--offset", "50")
	if err != nil {
		t.Fatal(err)
	}
	if requestPath != "/projects" || selectedTeam != "00000000-0000-0000-0000-000000000001" {
		t.Fatalf("wrong project routing: %s, team %s", requestPath, selectedTeam)
	}
	if !strings.Contains(received, "limit=25") || !strings.Contains(received, "offset=50") {
		t.Fatalf("query = %q", received)
	}
	if !strings.Contains(out, `"nextOffset": 75`) {
		t.Fatalf("output = %s", out)
	}
}

func TestProjectsListRejectsInvalidPagination(t *testing.T) {
	for _, args := range [][]string{{"--limit", "0"}, {"--limit", "101"}, {"--offset", "-1"}} {
		_, _, err := executeCommand(NewRootCmd("test", ""), append([]string{"projects", "list", "--team-id", "00000000-0000-0000-0000-000000000001"}, args...)...)
		if err == nil || !strings.Contains(err.Error(), "limit must be") {
			t.Fatalf("args %v: %v", args, err)
		}
	}
}
