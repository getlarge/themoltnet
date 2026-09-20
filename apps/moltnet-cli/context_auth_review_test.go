package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestOAuthAuthenticationIgnoresOptionalContextState(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	t.Setenv("MOLTNET_TEAM_ID", "")
	for _, state := range []string{"malformed", "unsupported", "directory"} {
		t.Run(state, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "moltnet.json")
			if err := os.WriteFile(path, []byte(`{"oauth2":{"client_id":"client","client_secret":"secret"}}`), 0600); err != nil {
				t.Fatal(err)
			}
			contextPath := filepath.Join(dir, "contexts.json")
			if state == "directory" {
				if err := os.Mkdir(contextPath, 0700); err != nil {
					t.Fatal(err)
				}
			} else {
				data := "{"
				if state == "unsupported" {
					data = `{"version":999,"contexts":{}}`
				}
				if err := os.WriteFile(contextPath, []byte(data), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := newAuthenticatedClient("https://api.example.test", path); err != nil {
				t.Fatalf("optional context broke OAuth: %v", err)
			}
		})
	}
}

func TestGuidedContextBootstrapsMultipleTeamKeys(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	t.Setenv("MOLTNET_TEAM_ID", "")
	dir, secretDir := t.TempDir(), t.TempDir()
	t.Setenv(secretRootEnv, secretDir)
	const subject = "00000000-0000-4000-a000-000000000099"
	const team = "00000000-0000-0000-0000-000000000088"
	const other = "00000000-0000-0000-0000-000000000099"
	_, server, _ := newTestServer(t, &stubDiaryHandler{})
	key := TeamAgentKeyKey(subject, team)
	provider := FileSecretProvider{Root: secretDir, Writable: true}
	if err := provider.Set(key, "team-only"); err != nil {
		t.Fatal(err)
	}
	// The other slot is deliberately unavailable: selecting team must not read it.
	doc := map[string]any{"subject_id": subject, "subject_type": "agent", "agent_key_refs": map[string]SecretReference{
		team: {Provider: "file", Key: key}, other: {Provider: "file", Key: TeamAgentKeyKey(subject, other)},
	}, "endpoints": map[string]string{"api": server.URL}}
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "moltnet.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := &cobra.Command{}
	cmd.SetIn(strings.NewReader("1\n1\n"))
	var output bytes.Buffer
	cmd.SetOut(&output)
	got, diary, err := guidedTeamDiary(cmd, dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != team || diary != testDiaryID.String() {
		t.Fatalf("unexpected selection %s %s", got, diary)
	}
	if !strings.Contains(output.String(), "Choose a configured team") {
		t.Fatal("missing local team prompt")
	}
}
