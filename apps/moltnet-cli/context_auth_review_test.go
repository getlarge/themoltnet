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
