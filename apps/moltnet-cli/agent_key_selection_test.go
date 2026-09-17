package main

import (
	"encoding/json"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
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
	assertBusy := func() {
		t.Helper()
		err := updateTeamAgentKeyReference(path, "subject", "a", SecretReference{Provider: "file", Key: TeamAgentKeyKey("subject", "a")})
		if err == nil || !strings.Contains(err.Error(), "lock busy") {
			t.Fatalf("expected busy lock: %v", err)
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != sharedConfigFixture {
			t.Fatal("blocked writer changed config")
		}
	}
	assertBusy()
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	assertBusy()
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

// Exercise the actual setup/repair writers alongside the other runtime's
// team updater, not only two calls to the new team helper.
func TestConfigCommandsPreserveConcurrentNodeTeamUpdates(t *testing.T) {
	for _, operation := range []string{"git", "ssh", "repair", "sdk-repair"} {
		t.Run(operation, func(t *testing.T) {
			cliDir, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			t.Chdir(dir) // Repair must never inspect the developer checkout's Git config.
			t.Setenv("HOME", dir)
			t.Setenv(signerURLEnv, "http://signer.invalid") // SSH exports public material only.
			path := filepath.Join(dir, "moltnet.json")
			var document map[string]any
			if err := json.Unmarshal([]byte(sharedConfigFixture), &document); err != nil {
				t.Fatal(err)
			}
			document["keys"].(map[string]any)["public_key"] = loadSSHVectors(t)[0].PublicKeyMoltnet
			document["endpoints"].(map[string]any)["mcp"] = ""
			document["endpoints"].(map[string]any)["future"] = "preserved"
			publicPath := filepath.Join(dir, "key.pub")
			if err := os.WriteFile(publicPath, []byte(loadSSHVectors(t)[0].PublicKeySSH), 0o600); err != nil {
				t.Fatal(err)
			}
			document["ssh"] = map[string]any{"public_key_path": publicPath}
			raw, err := json.Marshal(document)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			writes := make(chan error, 5)
			for _, team := range []string{"a", "b", "c", "d"} {
				go func() {
					if operation == "sdk-repair" {
						writes <- updateTeamAgentKeyReference(path, "subject", team, SecretReference{Provider: "file", Key: TeamAgentKeyKey("subject", team)})
						return
					}
					command := nodeConfigCommand("update", path, team)
					command.Dir = cliDir
					output, err := command.CombinedOutput()
					if err != nil {
						t.Log(string(output))
					}
					writes <- err
				}()
			}
			go func() {
				switch operation {
				case "git":
					writes <- runGitSetupCmd(io.Discard, path, "Test", "test@example.test")
				case "ssh":
					writes <- runSSHKeyExportCmd(io.Discard, path, "")
				case "repair":
					writes <- runConfigRepairCmd(path, false)
				case "sdk-repair":
					command := exec.Command("node", "--import", "tsx", "../../libs/sdk/__tests__/fixtures/config-repair.ts", dir)
					command.Dir = cliDir
					output, err := command.CombinedOutput()
					if err != nil {
						t.Log(string(output))
					}
					writes <- err
				}
			}()
			for i := 0; i < 5; i++ {
				if err := <-writes; err != nil {
					t.Fatal(err)
				}
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]json.RawMessage
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatal(err)
			}
			creds, err := ReadConfigFrom(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(creds.AgentKeyRefs) != 5 {
				t.Fatalf("lost team entries: %d", len(creds.AgentKeyRefs))
			}
			if string(result["future"]) == "" {
				t.Fatal("lost unrelated section")
			}
			var endpoints map[string]any
			if err := json.Unmarshal(result["endpoints"], &endpoints); err != nil {
				t.Fatal(err)
			}
			if endpoints["future"] != "preserved" {
				t.Fatal("lost nested unknown field")
			}
			if operation == "git" && creds.Git == nil {
				t.Fatal("git update missing")
			}
			if operation == "ssh" && creds.SSH.PublicKeyPath == publicPath {
				t.Fatal("ssh update missing")
			}
			if (operation == "repair" || operation == "sdk-repair") && creds.Endpoints.MCP == "" {
				t.Fatal("repair missing")
			}
		})
	}
}

func TestConfigMutationReloadsAndChecksIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte(sharedConfigFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	stale, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if output, err := nodeConfigCommand("update", path, "new").CombinedOutput(); err != nil {
		t.Fatalf("%s: %v", output, err)
	}
	if err := updateCredentials(path, stale, func(current *CredentialsFile) error {
		current.RegisteredAt = "updated"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	current, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.AgentKeyRefs) != 2 || current.RegisteredAt != "updated" {
		t.Fatal("stale mutation lost a concurrent update")
	}
	stale.SubjectID = "other"
	if err := updateCredentials(path, stale, func(current *CredentialsFile) error { current.RegisteredAt = "wrong"; return nil }); err == nil {
		t.Fatal("accepted changed identity")
	}
}

func TestInlineRotationPreservesNodeUpdatesAndRejectsChangedSource(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	var original map[string]json.RawMessage
	if err := json.Unmarshal([]byte(sharedConfigFixture), &original); err != nil {
		t.Fatal(err)
	}
	original["oauth2"] = json.RawMessage(`{"client_id":"client","client_secret":"before","future":"kept"}`)
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := nodeConfigCommand("update", path, "new").CombinedOutput(); err != nil {
		t.Fatalf("%s: %v", output, err)
	}
	if err := persistRotatedInlineCredentials(path, original, "client", "after"); err != nil {
		t.Fatal(err)
	}
	current, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.AgentKeyRefs) != 2 || current.OAuth2.ClientSecret != "after" {
		t.Fatal("rotation lost concurrent config")
	}
	if err := persistRotatedInlineCredentials(path, original, "client", "stale"); err == nil {
		t.Fatal("rotation replaced a changed OAuth2 source")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var updated map[string]json.RawMessage
	if err := json.Unmarshal(data, &updated); err != nil {
		t.Fatal(err)
	}
	var oauth map[string]any
	if err := json.Unmarshal(updated["oauth2"], &oauth); err != nil {
		t.Fatal(err)
	}
	if oauth["future"] != "kept" {
		t.Fatal("rotation lost unknown OAuth2 field")
	}
}

func TestGoNodeSelectorSeedingKeepsChosenIdentity(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	root, err := identityStoreDir()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "identities", "node", "moltnet.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(sharedConfigFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() {
		output, err := nodeConfigCommand("roundtrip", path, "").CombinedOutput()
		if err != nil {
			t.Log(string(output))
		}
		finished <- err
	}()
	if err := seedIdentitySelectorIfUnset("go"); err != nil {
		t.Fatal(err)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	selected, err := readIdentitySelector()
	if err != nil || selected == nil {
		t.Fatalf("missing selector: %v", err)
	}
	if selected.DefaultIdentity != "node" && selected.DefaultIdentity != "go" {
		t.Fatal("invalid selector")
	}
	if err := seedIdentitySelectorIfUnset("later"); err != nil {
		t.Fatal(err)
	}
	if output, err := nodeConfigCommand("roundtrip", path, "").CombinedOutput(); err != nil {
		t.Fatalf("%s: %v", output, err)
	}
	after, err := readIdentitySelector()
	if err != nil {
		t.Fatal(err)
	}
	if after.DefaultIdentity != selected.DefaultIdentity {
		t.Fatal("replaced an existing selection")
	}
}

func TestNodeRespectsGoWriterLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(path, []byte(sharedConfigFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	lock, err := safefile.Acquire(path)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	output, err := nodeConfigCommand("update", path, "node").CombinedOutput()
	if err == nil || !strings.Contains(string(output), "lock busy") {
		t.Fatalf("expected busy lock: %v %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != sharedConfigFixture {
		t.Fatal("blocked Node writer changed config")
	}
}

func TestRejectEmptyTeamAuthenticationAndPaddedTeamID(t *testing.T) {
	config := &CredentialsFile{AgentKeyRefs: map[string]SecretReference{}}
	if _, err := WriteConfigTo(config, filepath.Join(t.TempDir(), "moltnet.json")); err == nil {
		t.Fatal("empty authentication accepted")
	}
	if err := updateTeamAgentKeyReference("unused", "subject", " a ", SecretReference{Provider: "file", Key: TeamAgentKeyKey("subject", " a ")}); err == nil {
		t.Fatal("padded team accepted")
	}
}

func TestSelectedTeamResolutionNeverFallsBack(t *testing.T) {
	registry, provider := newMemorySecretProviderRegistry()
	fallback := SecretReference{Provider: osKeyringProviderName, Key: AgentKeyKey("subject")}
	selected := SecretReference{Provider: osKeyringProviderName, Key: TeamAgentKeyKey("subject", "team")}
	provider.values[fallback.Key] = "fallback-secret"
	config := &CredentialsFile{SubjectID: "subject", SubjectType: SubjectTypeAgent, AgentKeyRef: &fallback, AgentKeyRefs: map[string]SecretReference{"team": selected}}
	if _, configured, err := resolveAgentKey(config, registry, "team"); !configured || err == nil {
		t.Fatal("missing selected key fell back")
	}
	provider.values[selected.Key] = "selected-secret"
	if value, _, err := resolveAgentKey(config, registry, "team"); err != nil || value != "selected-secret" {
		t.Fatal("selected team not used")
	}
	if value, _, err := resolveAgentKey(config, registry, "absent"); err != nil || value != "fallback-secret" {
		t.Fatal("absent team did not use fallback")
	}
	config.AgentKeyRefs["team"] = SecretReference{Provider: "unknown", Key: selected.Key}
	if _, _, err := resolveAgentKey(config, registry, "team"); err == nil {
		t.Fatal("unknown provider fell back")
	}
	config.AgentKeyRefs["team"] = SecretReference{Provider: osKeyringProviderName, Key: TeamAgentKeyKey("other", "team")}
	if _, _, err := resolveAgentKey(config, registry, "team"); err == nil {
		t.Fatal("subject mismatch fell back")
	}
}
