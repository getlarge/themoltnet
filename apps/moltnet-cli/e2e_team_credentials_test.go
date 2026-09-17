//go:build e2e

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestE2E_CLI_TeamCredentialSelectionAndMigration(t *testing.T) {
	h := newCLIHarness(t)
	t.Setenv(agentKeyRefEnv, "")
	for _, name := range []string{"MOLTNET_CREDENTIALS_PATH", "MOLTNET_CLIENT_ID", "MOLTNET_CLIENT_SECRET"} {
		t.Setenv(name, "")
	}
	t.Setenv("MOLTNET_TEAM_ID", "")
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	t.Setenv(secretRootWritableEnv, "1")
	provider := FileSecretProvider{Root: root, Writable: true}
	createTeam := func() string {
		out, _ := h.run(t, "teams", "create", "--name", "key-selection-"+uuid.NewString())
		var result struct {
			ID string `json:"id"`
		}
		decodeJSON(t, out, &result)
		return result.ID
	}
	createKey := func(team string) string {
		out, _ := h.run(t, "agents", "keys", "create", "--team-id", team, "--agent-id", e2eAgentID, "--name", "selection-test")
		var result e2eAgentKeyResult
		decodeJSON(t, out, &result)
		if result.Secret == "" {
			t.Fatal("missing key")
		}
		return result.Secret
	}
	a, b := createTeam(), createTeam()
	secretA, secretB := createKey(a), createKey(b)
	refA := SecretReference{Provider: fileProviderName, Key: TeamAgentKeyKey(e2eAgentID, a)}
	refB := SecretReference{Provider: fileProviderName, Key: TeamAgentKeyKey(e2eAgentID, b)}
	for ref, value := range map[SecretReference]string{refA: secretA, refB: secretB} {
		if err := provider.Set(ref.Key, value); err != nil {
			t.Fatal(err)
		}
	}
	config := *e2eCreds
	config.SubjectID = e2eAgentID
	config.SubjectType = SubjectTypeAgent
	config.OAuth2 = CredentialsOAuth2{}
	seedRef := SecretReference{Provider: fileProviderName, Key: IdentitySeedKey(config.Keys.Fingerprint)}
	if err := provider.Set(seedRef.Key, config.Keys.PrivateKey); err != nil {
		t.Fatal(err)
	}
	config.Keys.PrivateKey = ""
	config.Keys.PrivateKeyRef = &seedRef
	config.AgentKeyRef = nil
	config.AgentKeyRefs = map[string]SecretReference{a: refA, b: refB}
	path := filepath.Join(t.TempDir(), "moltnet.json")
	if _, err := WriteConfigTo(&config, path); err != nil {
		t.Fatal(err)
	}
	for _, team := range []string{a, b} {
		out, stderr, err := runE2ECLI(h.bin, path, "teams", "get", team)
		if err != nil {
			t.Fatalf("selected team request failed: %v: %s", err, stderr)
		}
		if !strings.Contains(out, team) {
			t.Fatal("wrong team response")
		}
	}
	if _, stderr, err := runE2ECLI(h.bin, path, "agents", "whoami"); err == nil || !strings.Contains(stderr, "select a team") {
		t.Fatalf("expected selection diagnostic: %v %s", err, stderr)
	}
	t.Setenv("MOLTNET_TEAM_ID", a)
	if _, stderr, err := runE2ECLI(h.bin, path, "agents", "whoami"); err != nil {
		t.Fatalf("ambient team selection: %v %s", err, stderr)
	}
	fallback := SecretReference{Provider: fileProviderName, Key: AgentKeyKey(e2eAgentID)}
	if err := provider.Set(fallback.Key, secretB); err != nil {
		t.Fatal(err)
	}
	config.AgentKeyRef = &fallback
	if _, err := WriteConfigTo(&config, path); err != nil {
		t.Fatal(err)
	}
	if err := provider.Delete(refA.Key); err != nil {
		t.Fatal(err)
	}
	if _, stderr, err := runE2ECLI(h.bin, path, "agents", "whoami"); err == nil || strings.Contains(stderr, secretA) {
		t.Fatal("failed selected key fell back or leaked")
	}
	if _, stderr, err := runE2ECLI(h.bin, path, "teams", "get", b); err != nil {
		t.Fatalf("independent B key failed: %v %s", err, stderr)
	}
	// Migration uses the exact fallback, despite an ambient selected team and
	// a different explicit process credential. Existing unrelated entries survive.
	config.AgentKeyRefs = map[string]SecretReference{a: refA}
	if _, err := WriteConfigTo(&config, path); err != nil {
		t.Fatal(err)
	}
	t.Setenv(agentKeyEnv, secretA)
	out, stderr, err := runE2eCLIWithAuth(h.bin, path, secretA, "config", "migrate", "--destination", "file")
	if err != nil {
		t.Fatalf("migration failed: %v %s %s", err, out, stderr)
	}
	migrated, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.AgentKeyRef == nil || *migrated.AgentKeyRef != fallback || migrated.AgentKeyRefs[b] != refB || migrated.AgentKeyRefs[a] != refA {
		t.Fatal("migration did not preserve fallback and unrelated team")
	}
	if value, err := provider.Get(fallback.Key); err != nil || value != secretB {
		t.Fatal("migration removed fallback")
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, stderr, err := runE2ECLI(h.bin, path, "config", "migrate", "--destination", "file"); err != nil {
		t.Fatalf("repeat migration: %v %s", err, stderr)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("repeat migration changed config")
	}
	// A real Node SDK consumes the Go-written map and connects with the B key.
	script := `import {connect,FileSecretProvider} from '../../libs/sdk/src/node.ts'; import {SecretProviderRegistry} from '../../libs/sdk/src/secrets.ts'; const agent=await connect({configDir:process.argv[1],teamId:process.argv[2],secretProviders:new SecretProviderRegistry().register(new FileSecretProvider({root:process.env.MOLTNET_SECRET_ROOT}))}); const result=await agent.agents.whoami(); if(result.subjectId!==process.argv[3])throw Error('wrong subject');`
	cmd := exec.Command("node", "--import", "tsx", "--input-type=module", "-e", script, filepath.Dir(path), b, e2eAgentID)
	cmd.Env = withoutEnv(os.Environ(), agentKeyEnv)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("SDK reconnect: %v %s", err, output)
	}
	// Saved output and metadata never contain either grant.
	for _, value := range []string{out, stderr, string(after)} {
		if strings.Contains(value, secretA) || strings.Contains(value, secretB) {
			t.Fatal("credential leaked in migration output")
		}
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(after, &raw); err != nil {
		t.Fatal(err)
	}
	// Compiled plan application rejects edits made after generation.
	config.AgentKeyRefs = nil
	if _, err := WriteConfigTo(&config, path); err != nil {
		t.Fatal(err)
	}
	planPath := filepath.Join(t.TempDir(), "plan.json")
	if _, stderr, err := runE2ECLI(h.bin, path, "config", "migrate", "--destination", "file", "--generate", planPath); err != nil {
		t.Fatalf("generate: %v %s", err, stderr)
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(" "); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runE2ECLI(h.bin, path, "config", "migrate", "--destination", "file", "--run", planPath); err == nil {
		t.Fatal("stale saved plan accepted")
	}
	if err := provider.Set(refB.Key, secretA); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runE2ECLI(h.bin, path, "config", "migrate", "--destination", "file"); err == nil {
		t.Fatal("conflicting destination overwritten")
	}
	if value, err := provider.Get(fallback.Key); err != nil || value != secretB {
		t.Fatal("conflict changed fallback")
	}
	// Real identity-scoped credentials remain fallbacks after migration.
	identityOut, _ := h.run(t, "agents", "keys", "create", "--identity-scoped", "--agent-id", e2eAgentID, "--name", "identity-migration")
	var identityKey e2eAgentKeyResult
	decodeJSON(t, identityOut, &identityKey)
	if err := provider.Set(fallback.Key, identityKey.Secret); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteConfigTo(&config, path); err != nil {
		t.Fatal(err)
	}
	if _, stderr, err := runE2ECLI(h.bin, path, "config", "migrate", "--destination", "file"); err != nil {
		t.Fatalf("identity migration: %v %s", err, stderr)
	}
	identityConfig, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(identityConfig.AgentKeyRefs) != 0 || identityConfig.AgentKeyRef == nil {
		t.Fatal("identity fallback changed into team slot")
	}

}
