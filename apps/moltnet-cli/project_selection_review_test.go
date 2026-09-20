package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
)

func TestProjectStartRejectsDifferentEndpoint(t *testing.T) {
	setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_API_URL", defaultAPIURL)
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "other", APIURL: "https://other.example", TeamID: contextTestTeam, ProjectID: contextTestDiary, Strategy: "none"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, _, err := executeCommand(NewRootCmd("test", ""), "start", "echo", "--identity", "test-agent", "--binding", "other", "--config-file", path, "--dry-run")
	if err == nil || !strings.Contains(err.Error(), "endpoint") {
		t.Fatalf("expected endpoint mismatch, got %v", err)
	}
}

func TestProjectBindingsSetUsesResolvedEndpoint(t *testing.T) {
	isolateCredentialDiscovery(t)
	t.Setenv("MOLTNET_API_URL", "https://staging.example")
	path := filepath.Join(t.TempDir(), "projects.json")
	_, _, err := executeCommand(NewRootCmd("test", ""), "projects", "bindings", "set", "local", "--config-file", path, "--team-id", contextTestTeam, "--project-id", contextTestDiary, "--strategy", "none")
	if err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if c.Bindings[0].APIURL != "https://staging.example" {
		t.Fatalf("wrong endpoint: %s", c.Bindings[0].APIURL)
	}
}

func TestProjectActivationHonorsLaunchSelection(t *testing.T) {
	setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_API_URL", defaultAPIURL)
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		for _, name := range []string{"one", "two"} {
			c.Bindings = append(c.Bindings, projectconfig.Binding{Name: name, APIURL: defaultAPIURL, TeamID: contextTestTeam, ProjectID: contextTestDiary, Source: t.TempDir(), Strategy: "existing"})
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MOLTNET_PROJECT_CONFIG", path)
	t.Setenv("MOLTNET_PROJECT_BINDING", "two")
	ctx, err := resolveActivationContext("test-agent")
	if err != nil {
		t.Fatal(err)
	}
	if ctx.Context.Project == nil || ctx.Context.Project.Name != "two" {
		t.Fatalf("lost launch selection: %+v", ctx.Context)
	}
	team, err := resolveCredentialTeam(filepath.Join(ctx.AgentDir, "moltnet.json"))
	if err != nil || team != contextTestTeam {
		t.Fatalf("credential selection: %q, %v", team, err)
	}
}

func TestProjectStartExecUsesSelectedFolderAndRestoresCWD(t *testing.T) {
	setupStartUnboundFixture(t, "")
	t.Setenv("MOLTNET_API_URL", defaultAPIURL)
	source := t.TempDir()
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(source, "runner")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "projects.json")
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "local", APIURL: defaultAPIURL, TeamID: contextTestTeam, ProjectID: contextTestDiary, Source: source, Strategy: "existing"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	cmd := newStartCmd()
	_ = cmd.Flags().Set("config-file", path)
	_ = cmd.Flags().Set("binding", "local")
	before, _ := os.Getwd()
	called := false
	launchErr := errors.New("launch failed")
	err = runStartCmdWithRegistryAndExec(cmd, "test-agent", "./runner", nil, false, NewSecretProviderRegistry(), func(target string, _ []string, env []string) error {
		called = true
		cwd, _ := os.Getwd()
		if cwd != canonical {
			t.Errorf("cwd = %s", cwd)
		}
		if target != filepath.Join(canonical, "runner") {
			t.Errorf("target = %s", target)
		}
		for _, want := range []string{"PWD=" + canonical, "MOLTNET_PROJECT_BINDING=local", "MOLTNET_PROJECT_CONFIG=" + path, "MOLTNET_API_URL=" + defaultAPIURL} {
			if !slices.Contains(env, want) {
				t.Errorf("missing %s", want)
			}
		}
		return launchErr
	})
	if !called || !errors.Is(err, launchErr) {
		t.Fatalf("launch = %v, called = %v", err, called)
	}
	after, _ := os.Getwd()
	if after != before {
		t.Fatalf("cwd not restored: %s", after)
	}
}

func TestProjectBindingsSetPreservesOptionalFields(t *testing.T) {
	isolateCredentialDiscovery(t)
	t.Setenv("MOLTNET_API_URL", defaultAPIURL)
	path := filepath.Join(t.TempDir(), "projects.json")
	source := t.TempDir()
	hook := &projectconfig.Hooks{BeforeRun: &projectconfig.Hook{Command: "echo", Args: []string{"ready"}, TimeoutMS: 1000}}
	if err := projectconfig.Update(path, func(c *projectconfig.Config) error {
		c.Bindings = []projectconfig.Binding{{Name: "local", APIURL: defaultAPIURL, TeamID: contextTestTeam, ProjectID: contextTestDiary, DiaryID: contextTestDiary, Default: true, Source: source, Strategy: "existing", Hooks: hook}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	_, _, err := executeCommand(NewRootCmd("test", ""), "projects", "bindings", "set", "local", "--config-file", path, "--team-id", contextTestTeam, "--project-id", contextTestDiary, "--strategy", "existing")
	if err != nil {
		t.Fatal(err)
	}
	c, err := projectconfig.Read(path)
	if err != nil {
		t.Fatal(err)
	}
	b := c.Bindings[0]
	if b.DiaryID != contextTestDiary || !b.Default || b.Source != source || b.Hooks == nil {
		t.Fatalf("lost fields: %+v", b)
	}
}

func TestProjectCatalogueMutationsAndErrors(t *testing.T) {
	project := contextTestDiary
	cases := []struct {
		name, method, path, body string
		args                     []string
	}{
		{"create", "POST", "/projects", `{"name":"Research","defaultDiaryId":"` + contextTestDiary + `"}`, []string{"create", "--name", "Research", "--diary-id", contextTestDiary}},
		{"get", "GET", "/projects/" + project, "", []string{"get", project}},
		{"update", "PATCH", "/projects/" + project, `{"name":"Updated","defaultDiaryId":null}`, []string{"update", project, "--name", "Updated", "--clear-diary"}},
		{"archive", "PATCH", "/projects/" + project, `{"archived":true}`, []string{"archive", project}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, status := range []int{200, 403, 404, 409} {
				t.Run(strconv.Itoa(status), func(t *testing.T) {
					isolateCredentialDiscovery(t)
					t.Setenv(agentKeyEnv, "ak_test_projects")
					t.Setenv(agentKeyRefEnv, "")
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if r.Method != tc.method || r.URL.Path != tc.path || r.Header.Get("x-moltnet-team-id") != contextTestTeam {
							t.Errorf("request: %s %s", r.Method, r.URL.Path)
						}
						if tc.body != "" {
							var got, want any
							if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
								t.Error(err)
							}
							if err := json.Unmarshal([]byte(tc.body), &want); err != nil {
								t.Fatal(err)
							}
							if !reflect.DeepEqual(got, want) {
								t.Errorf("body = %#v, want %#v", got, want)
							}
						}
						w.Header().Set("Content-Type", "application/json")
						if status != 200 {
							w.WriteHeader(status)
							fmt.Fprintf(w, `{"status":%d,"type":"https://themolt.net/problems/test","code":"CONFLICT","title":"Request rejected","detail":"project request detail","conflict":{}}`, status)
							return
						}
						if tc.name == "create" {
							w.WriteHeader(201)
						}
						fmt.Fprintf(w, `{"id":%q,"teamId":%q,"name":"Research","archived":false,"description":null,"defaultDiaryId":null,"creatorAgentId":null,"creatorHumanId":null,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}`, project, contextTestTeam)
					}))
					defer server.Close()
					args := append([]string{"projects"}, tc.args...)
					args = append(args, "--team-id", contextTestTeam, "--api-url", server.URL)
					out, _, err := executeCommand(NewRootCmd("test", ""), args...)
					if status == 200 {
						if err != nil || !strings.Contains(out, "Research") {
							t.Fatalf("result: %s, %v", out, err)
						}
					} else if err == nil || !strings.Contains(err.Error(), "project request detail") {
						t.Fatalf("missing error detail: %v", err)
					}
				})
			}
		})
	}
}
