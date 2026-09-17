package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestSharedTeamKeySelectionFixtures(t *testing.T) {
	data, err := os.ReadFile("../../libs/agent-config/__tests__/fixtures/team-key-selection.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name         string           `json:"name"`
		Config       CredentialsFile  `json:"config"`
		SelectedTeam string           `json:"selectedTeam"`
		Reference    *SecretReference `json:"reference"`
		TeamID       string           `json:"teamId"`
		Error        bool             `json:"error"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Name, func(t *testing.T) {
			got, err := selectAgentKeyReference(&test.Config, test.SelectedTeam)
			if test.Error {
				if err == nil {
					t.Fatal("expected selection error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if test.Reference == nil {
				if got != nil {
					t.Fatal("unexpected selected key")
				}
				return
			}
			if got == nil || got.Reference != *test.Reference || got.TeamID != test.TeamID {
				t.Fatalf("selection mismatch: %+v", got)
			}
		})
	}
}

func TestSelectedKeyBindingCannotFallBack(t *testing.T) {
	for _, ref := range []SecretReference{
		{Provider: "env", Key: agentKeyEnv},
		{Provider: "file", Key: TeamAgentKeyKey("other", "a")},
		{Provider: "os-keyring", Key: TeamAgentKeyKey("subject", "b")},
		{Provider: "BAD", Key: TeamAgentKeyKey("subject", "a")},
	} {
		config := &CredentialsFile{AgentKeyRef: &SecretReference{Provider: "file", Key: AgentKeyKey("subject")}, AgentKeyRefs: map[string]SecretReference{"a": ref}}
		selected, err := selectAgentKeyReference(config, "a")
		if err != nil {
			t.Fatal(err)
		}
		if selected.Reference != ref {
			t.Fatal("selected fallback")
		}
		if validateSelectedAgentKey(selected, "subject") == nil {
			t.Fatal("invalid binding accepted")
		}
	}
}

const sharedConfigFixture = `{"subject_id":"subject","subject_type":"agent","agent_key_refs":{"initial":{"provider":"file","key":"agent-key/subject/initial"}},"registered_at":"2026-09-17","keys":{"public_key":"public","fingerprint":"fp","private_key_ref":{"provider":"file","key":"identity/fp/seed"}},"endpoints":{"api":"https://api.example","mcp":"https://mcp.example"},"future":{"nested":["kept"]}}`

func nodeConfigCommand(operation, path, team string) *exec.Cmd {
	return exec.Command("node", "--import", "tsx", "../../libs/agent-config/__tests__/fixtures/config-writer.ts", operation, path, team)
}

func TestGoNodeConcurrentConfigUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte(sharedConfigFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errors := make(chan error, 8)
	for _, team := range []string{"a", "b", "c", "d"} {
		wg.Add(2)
		go func() {
			defer wg.Done()
			errors <- updateTeamAgentKeyReference(path, "subject", team, SecretReference{Provider: "file", Key: TeamAgentKeyKey("subject", team)})
		}()
		go func() {
			defer wg.Done()
			output, err := nodeConfigCommand("update", path, "node-"+team).CombinedOutput()
			if err != nil {
				t.Log(string(output))
			}
			errors <- err
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(creds.AgentKeyRefs) != 9 {
		t.Fatalf("lost map entries: %d", len(creds.AgentKeyRefs))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	var future any
	if err := json.Unmarshal(document["future"], &future); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(future, map[string]any{"nested": []any{"kept"}}) {
		t.Fatal("unrelated field lost")
	}
	if output, err := nodeConfigCommand("roundtrip", path, "").CombinedOutput(); err != nil {
		t.Fatalf("Node round trip: %s: %v", output, err)
	}
	after, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(creds, after) {
		t.Fatal("Node round trip changed credentials")
	}
	goPath := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(after, goPath); err != nil {
		t.Fatal(err)
	}
	if output, err := nodeConfigCommand("roundtrip", goPath, "").CombinedOutput(); err != nil {
		t.Fatalf("Go to Node round trip: %s: %v", output, err)
	}
	final, err := ReadConfigFrom(goPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, final) {
		t.Fatal("Go to Node changed credentials")
	}
}

func TestInterruptedNodeWriterPreservesConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte(sharedConfigFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := nodeConfigCommand("hold", path, "")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(path + ".ready"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("writer did not acquire lock")
		}
		time.Sleep(25 * time.Millisecond)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != sharedConfigFixture {
		t.Fatal("interrupted writer changed config")
	}
	if _, err := ReadConfigFrom(path); err != nil {
		t.Fatal(err)
	}
	// Explicit repair after proving the process is dead; no automatic lock stealing.
	if err := os.RemoveAll(path + ".writer-lock"); err != nil {
		t.Fatal(err)
	}
	if err := updateTeamAgentKeyReference(path, "subject", "a", SecretReference{Provider: "file", Key: TeamAgentKeyKey("subject", "a")}); err != nil {
		t.Fatal(err)
	}
}
