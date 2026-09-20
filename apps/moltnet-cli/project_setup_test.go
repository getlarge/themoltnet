package main

import (
	"context"
	"encoding/json"
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
	h.pages = append(h.pages, p.Offset.Value)
	if p.Offset.Value == 0 {
		return &moltnetapi.ListProjectsOK{Items: []moltnetapi.ListProjectsOKItemsItem{}, NextOffset: moltnetapi.NewNilInt(100)}, nil
	}
	return &moltnetapi.ListProjectsOK{Items: []moltnetapi.ListProjectsOKItemsItem{{ID: uuid.MustParse(contextTestDiary), Name: "shared-project", TeamId: uuid.MustParse(contextTestTeam)}}, NextOffset: moltnetapi.NilInt{Null: true}}, nil
}
func (h *setupProjectHandler) GetProject(_ context.Context, p moltnetapi.GetProjectParams) (moltnetapi.GetProjectRes, error) {
	return &moltnetapi.GetProjectOK{ID: p.ProjectId, TeamId: p.ID, Name: "shared-project"}, nil
}
func (h *setupProjectHandler) GetDiary(_ context.Context, p moltnetapi.GetDiaryParams) (moltnetapi.GetDiaryRes, error) {
	d := newTestDiary("diary")
	d.ID = p.ID
	d.TeamId = uuid.MustParse(contextTestTeam)
	return d, nil
}

func TestStartInteractiveProjectRegistration(t *testing.T) {
	for _, scenario := range []string{"existing", "isolated", "cancel", "dry-run", "noninteractive", "migration", "noninteractive-legacy", "dry-run-legacy"} {
		t.Run(scenario, func(t *testing.T) {
			source := setupStartUnboundFixture(t, fmt.Sprintf("MOLTNET_TEAM_ID='%s'\nMOLTNET_DIARY_ID='%s'\n", contextTestTeam, contextTestDiary))
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
			cmd.SetIn(strings.NewReader("1\n1\nlocal\n1\n"))
			if scenario == "isolated" {
				cmd.SetIn(strings.NewReader("1\n1\nlocal\n2\n"))
			}
			if scenario == "cancel" {
				cmd.SetIn(strings.NewReader("1\n3\n"))
			}
			if scenario == "migration" || strings.HasSuffix(scenario, "-legacy") {
				data, _ := json.Marshal(contextStore{Version: 1, Contexts: map[string]contextBinding{"dir:" + source: {TeamID: contextTestTeam, DiaryID: contextTestDiary}}})
				if err := os.WriteFile(contextStorePath(dir), data, 0600); err != nil {
					t.Fatal(err)
				}
				cmd.SetIn(strings.NewReader("1\nlocal\n1\n"))
			}
			if err := cmd.Flags().Set("config-file", path); err != nil {
				t.Fatal(err)
			}
			called := false
			err := runStartCmdWithRegistryAndExec(cmd, "test-agent", "echo", nil, strings.HasPrefix(scenario, "dry-run"), NewSecretProviderRegistry(), func(_ string, _ []string, env []string) error {
				called = true
				if scenario != "noninteractive" && !strings.Contains(strings.Join(env, "\n"), "MOLTNET_PROJECT_ID="+contextTestDiary) {
					t.Error("missing project environment")
				}
				return nil
			})
			if scenario == "cancel" || strings.HasSuffix(scenario, "-legacy") {
				if err == nil || called {
					t.Fatalf("cancel launched: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			config, readErr := projectconfig.Read(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			shouldSave := scenario == "existing" || scenario == "isolated" || scenario == "migration"
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
				if _, e := os.Stat(contextStorePath(dir)); e != nil {
					t.Fatal("legacy file changed without migration")
				}
			}
			if scenario == "migration" {
				if _, e := os.Stat(contextStorePath(dir)); !os.IsNotExist(e) {
					t.Fatal("legacy file retained")
				}
			}
		})
	}
}
