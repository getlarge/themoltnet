package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/projectconfig"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

type setupProjectHandler struct {
	stubDiaryHandler
	pages []int
}

func (h *setupProjectHandler) ListProjects(_ context.Context, p moltnetapi.ListProjectsParams) (moltnetapi.ListProjectsRes, error) {
	if !p.XMoltnetTeamID.Set || p.XMoltnetTeamID.Value.String() != contextTestTeam {
		return nil, fmt.Errorf("project request omitted selected team header")
	}
	h.pages = append(h.pages, p.Offset.Value)
	if p.Offset.Value == 0 {
		return &moltnetapi.ListProjectsOK{Items: []moltnetapi.ListProjectsOKItemsItem{}, NextOffset: moltnetapi.NewNilInt(100)}, nil
	}
	return &moltnetapi.ListProjectsOK{Items: []moltnetapi.ListProjectsOKItemsItem{{ID: uuid.MustParse(contextTestDiary), Name: "shared-project", TeamId: uuid.MustParse(contextTestTeam)}}, NextOffset: moltnetapi.NilInt{Null: true}}, nil
}
func (h *setupProjectHandler) GetProject(_ context.Context, p moltnetapi.GetProjectParams) (moltnetapi.GetProjectRes, error) {
	return &moltnetapi.GetProjectOK{ID: p.ProjectId, TeamId: p.XMoltnetTeamID.Value, Name: "shared-project"}, nil
}
func (h *setupProjectHandler) GetDiary(_ context.Context, p moltnetapi.GetDiaryParams) (moltnetapi.GetDiaryRes, error) {
	d := newTestDiary("diary")
	d.ID = p.ID
	d.TeamId = uuid.MustParse(contextTestTeam)
	return d, nil
}

func TestStartInteractiveProjectRegistration(t *testing.T) {
	for _, scenario := range []string{"existing", "isolated", "cancel", "decline", "invalid-choice", "offline", "endpoint-override", "dry-run", "noninteractive", "noninteractive-legacy", "dry-run-legacy"} {
		t.Run(scenario, func(t *testing.T) {
			_ = setupStartUnboundFixture(t, fmt.Sprintf("MOLTNET_TEAM_ID='%s'\nMOLTNET_DIARY_ID='%s'\n", contextTestTeam, contextTestDiary))
			t.Setenv("USERPROFILE", os.Getenv("HOME"))
			t.Setenv(agentKeyEnv, "ak_test_setup")
			t.Setenv(agentKeyRefEnv, "")
			t.Setenv("MOLTNET_ACTIVE_IDENTITY", "")
			dir := filepath.Join(os.Getenv("HOME"), ".config", "moltnet", "identities", "test-agent")
			h := &setupProjectHandler{}
			_, server, _ := newTestServer(t, h)
			creds := &CredentialsFile{SubjectID: "test-identity", OAuth2: CredentialsOAuth2{ClientID: "cid", ClientSecret: "secret"}, Endpoints: CredentialsEndpoints{API: server.URL}}
			if _, err := WriteConfigTo(creds, filepath.Join(dir, "moltnet.json")); err != nil {
				t.Fatal(err)
			}
			original := projectCommandInteractive
			projectCommandInteractive = func(*cobra.Command) bool { return scenario != "noninteractive" && scenario != "noninteractive-legacy" }
			t.Cleanup(func() { projectCommandInteractive = original })
			path := filepath.Join(t.TempDir(), "projects.json")
			cmd := newStartCmd()
			cmd.SetContext(context.Background())
			var notices bytes.Buffer
			cmd.SetErr(&notices)
			cmd.SetIn(strings.NewReader("1\n1\n1\nlocal\n1\n"))
			if scenario == "isolated" {
				cmd.SetIn(strings.NewReader("1\n1\n1\nlocal\n2\n"))
			}
			if scenario == "decline" {
				cmd.SetIn(strings.NewReader("2\n"))
			}
			if scenario == "invalid-choice" {
				cmd.SetIn(strings.NewReader("bad\n99\n2\n"))
			}
			if scenario == "offline" {
				server.Close()
			}
			if scenario == "endpoint-override" {
				cmd.Flags().String("api-url", "", "test endpoint override")
				if err := cmd.Flags().Set("api-url", server.URL); err != nil {
					t.Fatal(err)
				}
				creds.Endpoints.API = "https://unselected.example"
				if _, err := WriteConfigTo(creds, filepath.Join(dir, "moltnet.json")); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "cancel" {
				cmd.SetIn(strings.NewReader("1\n1\n3\n"))
			}
			if strings.HasSuffix(scenario, "-legacy") {
				data := []byte("malformed legacy file: must never be parsed")
				if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
					t.Fatal(err)
				}
				cmd.SetIn(strings.NewReader("1\n1\nlocal\n1\n"))
			}
			if err := cmd.Flags().Set("config-file", path); err != nil {
				t.Fatal(err)
			}
			called := false
			err := runStartCmdWithRegistryAndExec(cmd, "test-agent", "echo", nil, strings.HasPrefix(scenario, "dry-run"), NewSecretProviderRegistry(), func(_ string, _ []string, env []string) error {
				called = true
				if (scenario == "existing" || scenario == "isolated" || scenario == "endpoint-override") && !strings.Contains(strings.Join(env, "\n"), "MOLTNET_PROJECT_ID="+contextTestDiary) {
					t.Error("missing project environment")
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(scenario, "dry-run") && !called {
				t.Fatal("start did not launch")
			}

			config, readErr := projectconfig.Read(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			shouldSave := scenario == "existing" || scenario == "isolated" || scenario == "endpoint-override"
			if shouldSave {
				if len(config.Bindings) != 1 || config.Bindings[0].Name != "local" {
					t.Fatalf("missing saved selection: %+v", config)
				}
				expected := "existing"
				if scenario == "isolated" {
					expected = "isolated-directory"
				}
				if config.Bindings[0].Strategy != expected {
					t.Fatal("wrong strategy")
				}
				if len(h.pages) != 2 || h.pages[1] != 100 {
					t.Fatalf("pagination: %v", h.pages)
				}
			} else if len(config.Bindings) != 0 {
				t.Fatal("unexpected saved config")
			}
			if strings.HasSuffix(scenario, "-legacy") {
				data, e := os.ReadFile(contextStorePath(dir))
				if e != nil || string(data) != "malformed legacy file: must never be parsed" {
					t.Fatal("legacy file changed")
				}
				if !strings.Contains(notices.String(), "projects setup") {
					t.Fatalf("missing registration hint: %s", notices.String())
				}
			}
		})
	}
}

func TestLegacyProjectCommandsRemoved(t *testing.T) {
	for _, command := range newProjectsCmd().Commands() {
		if command.Name() == "migrate" {
			t.Fatal("projects migrate must be removed")
		}
	}
	for _, command := range NewRootCmd("test", "").Commands() {
		if command.Name() == "context" {
			t.Fatal("context command must be removed")
		}
	}
}
