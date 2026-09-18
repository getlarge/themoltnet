package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func writeAgentKeyStoreFixture(t *testing.T, subjectID string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "moltnet.json")
	doc := `{
  "subject_id": ` + mustJSON(t, subjectID) + `,
  "subject_type": "agent",
  "oauth2": { "client_id": "cid", "client_secret_ref": { "provider": "os-keyring", "key": "oauth2/x/cid" } },
  "keys": { "public_key": "ed25519:pub", "fingerprint": "AAAA-BBBB", "private_key_ref": { "provider": "os-keyring", "key": "identity/AAAA-BBBB/seed" } },
  "endpoints": { "api": "https://api.example.test", "mcp": "https://mcp.example.test" },
  "custom": "kept"
}
`
	if err := os.WriteFile(path, []byte(doc), privateFileMode); err != nil {
		t.Fatal(err)
	}
	return path
}

func agentKeyStubSecret(secret string) agentKeysStubHandler {
	return agentKeysStubHandler{
		create: func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
		},
		rotate: func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
		},
	}
}

// recoveryCapture records recovery artifacts in a temp dir so tests can assert
// what was durably preserved without touching the user cache directory.
type recoveryCapture struct {
	dir      string
	written  []agentKeyRecovery
	failWith error
	paths    []string
}

func newRecoveryCapture(t *testing.T) *recoveryCapture {
	t.Helper()
	return &recoveryCapture{dir: t.TempDir()}
}

func (c *recoveryCapture) write(recovery agentKeyRecovery) (string, error) {
	if c.failWith != nil {
		return "", c.failWith
	}
	c.written = append(c.written, recovery)
	path, err := writeRecoveryArtifact(c.dir, "agent-key-recovery-*.json", recovery)
	c.paths = append(c.paths, path)
	return path, err
}

func (c *recoveryCapture) latest(t *testing.T) agentKeyRecovery {
	t.Helper()
	data, err := os.ReadFile(c.paths[len(c.paths)-1])
	if err != nil {
		t.Fatal(err)
	}
	var recovery agentKeyRecovery
	if err := json.Unmarshal(data, &recovery); err != nil {
		t.Fatal(err)
	}
	return recovery
}

func storeOpts(registry *SecretProviderRegistry, capture *recoveryCapture) agentKeyStoreOpts {
	return agentKeyStoreOpts{enabled: true, secretProviders: registry, writeRecovery: capture.write}
}

func assertNoSecret(t *testing.T, secret string, streams ...*bytes.Buffer) {
	t.Helper()
	for _, stream := range streams {
		if strings.Contains(stream.String(), secret) {
			t.Fatalf("secret leaked to output:\n%s", stream.String())
		}
	}
}

func TestAgentsKeysCreateStoreWritesReferenceWithoutPrintingSecret(t *testing.T) {
	const secret = "sk_live_TOPSECRET_store"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	_, _, client := newTestServer(t, agentKeyStubSecret(secret))

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
		store: storeOpts(registry, capture), out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	assertNoSecret(t, secret, &out, &errOut)
	if provider.values[TeamAgentKeyKey(testAgentID, testTeamID)] != secret {
		t.Fatal("secret was not stored under agent-key/<subject_id>")
	}
	var result storedAgentKeyOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, out.String())
	}
	if !result.SecretStored || !result.CredentialsUpdated || result.ManualRecoveryRequired || result.RecoveryPath != "" ||
		result.AgentKeyRef.Provider != osKeyringProviderName || result.AgentKeyRef.Key != TeamAgentKeyKey(testAgentID, testTeamID) || result.IdempotencyKey == "" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(capture.paths) != 1 {
		t.Fatal("recovery must be reserved before issuance")
	}
	if _, err := os.Stat(capture.paths[0]); !os.IsNotExist(err) {
		t.Fatal("success must remove recovery artifact")
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.AgentKeyRefs[testTeamID] != result.AgentKeyRef {
		t.Fatalf("agent_key_ref not written: %+v", creds.AgentKeyRef)
	}
	raw, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(raw), `"custom": "kept"`) || !strings.Contains(string(raw), "client_secret_ref") {
		t.Fatalf("rewrite dropped fields:\n%s", raw)
	}
	resolved, configured, err := resolveAgentKey(creds, registry)
	if err != nil || !configured || resolved != secret {
		t.Fatalf("stored key does not resolve through agent_key_ref: %v", err)
	}
}

func TestAgentsKeysCreateStoreFailsBeforeNetworkOnBadTargets(t *testing.T) {
	credentialsPath := writeAgentKeyStoreFixture(t, "00000000-0000-4000-8000-00000000beef")
	legacyCredentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	legacyRaw, err := os.ReadFile(legacyCredentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	legacyRaw = bytes.Replace(legacyRaw, []byte(`"subject_id"`), []byte(`"identity_id"`), 1)
	legacyRaw = bytes.Replace(legacyRaw, []byte("  \"subject_type\": \"agent\",\n"), nil, 1)
	if err := os.WriteFile(legacyCredentialsPath, legacyRaw, privateFileMode); err != nil {
		t.Fatal(err)
	}
	registry, _ := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	calls := 0
	handler := agentKeyStubSecret("never")
	handler.create = func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
		calls++
		return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: "never"}
	}
	_, _, client := newTestServer(t, handler)

	cases := []struct {
		name string
		opts agentsKeysCreateOpts
		want string
	}{
		{"agent id mismatch", agentsKeysCreateOpts{credPath: credentialsPath, agentID: testAgentID, store: storeOpts(registry, capture)}, "authenticates agent"},
		{"env destination", agentsKeysCreateOpts{credPath: credentialsPath, agentID: testAgentID, store: agentKeyStoreOpts{enabled: true, destination: "env", secretProviders: registry}}, "read-only"},
		{"missing credentials", agentsKeysCreateOpts{credPath: filepath.Join(t.TempDir(), "none.json"), agentID: testAgentID, store: storeOpts(registry, capture)}, "requires a credentials file"},
		{"legacy credentials", agentsKeysCreateOpts{credPath: legacyCredentialsPath, agentID: testAgentID, store: storeOpts(registry, capture)}, "run `moltnet config migrate` first"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.opts.teamID = testTeamID
			tc.opts.name = "daemon"
			var out bytes.Buffer
			tc.opts.out = &out
			tc.opts.errOut = &out
			err := runAgentsKeysCreateWithClient(context.Background(), client, tc.opts)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
	if calls != 0 {
		t.Fatalf("a key was minted despite an unusable store target (%d calls)", calls)
	}
}

func TestAgentsKeysStoreFailurePathsNeverEmitTheSecret(t *testing.T) {
	const secret = "sk_live_recover_me"

	t.Run("store failure preserves the secret only in the recovery artifact", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		defer assertCredentialReferencesUnchanged(t, credentialsPath)()
		registry := NewSecretProviderRegistry()
		registry.Register(osKeyringProviderName, failingWriteSecretProvider{})
		capture := newRecoveryCapture(t)
		_, _, client := newTestServer(t, agentKeyStubSecret(secret))
		var out, errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: storeOpts(registry, capture), out: &out, errOut: &errOut,
		})
		if err == nil || !strings.Contains(err.Error(), "store_secret") || !strings.Contains(err.Error(), "protected recovery file") || strings.Contains(err.Error(), secret) {
			t.Fatalf("unexpected error: %v", err)
		}
		assertNoSecret(t, secret, &out, &errOut)
		var result storedAgentKeyOutput
		if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || !result.ManualRecoveryRequired || result.SecretStored || result.RecoveryPath == "" {
			t.Fatalf("result must point at the recovery artifact: %v %+v", jerr, result)
		}
		if len(capture.written) != 1 || capture.latest(t).Secret != secret || capture.latest(t).Stage != "store_secret" || capture.latest(t).SecretStored {
			t.Fatalf("recovery artifact = %+v", capture.written)
		}
		data, err := os.ReadFile(result.RecoveryPath)
		if err != nil || !strings.Contains(string(data), secret) {
			t.Fatalf("recovery file must hold the secret durably: %v", err)
		}
		if info, _ := os.Stat(result.RecoveryPath); info.Mode().Perm() != privateFileMode {
			t.Fatalf("recovery file mode = %o", info.Mode().Perm())
		}
		if creds, _ := ReadConfigFrom(credentialsPath); creds.AgentKeyRef != nil || len(creds.AgentKeyRefs) != 0 {
			t.Fatal("agent_key_ref must not be written when the secret was not stored")
		}
	})

	t.Run("read-back mismatch is a storage failure", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		defer assertCredentialReferencesUnchanged(t, credentialsPath)()
		registry := NewSecretProviderRegistry()
		provider := &echoingSecretProvider{}
		registry.Register(osKeyringProviderName, provider)
		capture := newRecoveryCapture(t)
		_, _, client := newTestServer(t, agentKeyStubSecret(secret))
		var out, errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: storeOpts(registry, capture), out: &out, errOut: &errOut,
		})
		if err == nil || !strings.Contains(err.Error(), "does not match") || !strings.Contains(err.Error(), "store_secret") {
			t.Fatalf("unexpected error: %v", err)
		}
		assertNoSecret(t, secret, &out, &errOut)
		if provider.writes != 1 || len(capture.written) != 1 || capture.latest(t).Secret != secret {
			t.Fatalf("writes=%d recovery=%+v", provider.writes, capture.written)
		}
	})

	t.Run("changed subject preserves recovery before touching the provider", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		defer assertCredentialReferencesUnchanged(t, credentialsPath)()
		registry, provider := newMemorySecretProviderRegistry()
		capture := newRecoveryCapture(t)
		// Swap the subject after the target was prepared: the locked
		// re-read refuses to bind the key to a different agent.
		handler := agentKeyStubSecret(secret)
		handler.create = func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
			raw, _ := os.ReadFile(credentialsPath)
			_ = os.WriteFile(credentialsPath, bytes.Replace(raw, []byte(testAgentID), []byte("00000000-0000-4000-8000-00000000beef"), 1), privateFileMode)
			return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
		}
		_, _, client := newTestServer(t, handler)
		var out, errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: storeOpts(registry, capture), out: &out, errOut: &errOut,
		})
		if err == nil || !strings.Contains(err.Error(), "update_credentials") || !strings.Contains(err.Error(), "protected recovery file") {
			t.Fatalf("unexpected error: %v", err)
		}
		assertNoSecret(t, secret, &out, &errOut)
		var result storedAgentKeyOutput
		if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || !result.ManualRecoveryRequired || result.SecretStored || result.CredentialsUpdated || result.AgentKeyRef.Key != TeamAgentKeyKey(testAgentID, testTeamID) {
			t.Fatalf("result = %v %+v", jerr, result)
		}
		if provider.values[TeamAgentKeyKey(testAgentID, testTeamID)] != "" {
			t.Fatal("changed subject must not overwrite a provider slot")
		}
		if len(capture.written) != 1 || capture.latest(t).Secret != secret || capture.latest(t).SecretStored {
			t.Fatalf("unstored secret must remain in recovery: %+v", capture.written)
		}
		if creds, _ := ReadConfigFrom(credentialsPath); creds.AgentKeyRef != nil || len(creds.AgentKeyRefs) != 0 {
			t.Fatal("agent_key_ref must not be bound to a changed subject")
		}
	})

	t.Run("recovery artifact and stdout both failing still never prints the secret", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		defer assertCredentialReferencesUnchanged(t, credentialsPath)()
		registry := NewSecretProviderRegistry()
		registry.Register(osKeyringProviderName, failingWriteSecretProvider{})
		capture := newRecoveryCapture(t)
		capture.failWith = errors.New("cache dir unavailable")
		_, _, client := newTestServer(t, agentKeyStubSecret(secret))
		var errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: storeOpts(registry, capture), out: failingWriter{}, errOut: &errOut,
		})
		if err == nil || strings.Contains(err.Error(), secret) {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(err.Error(), "issuance was not attempted") {
			t.Fatal("unavailable recovery must fail before issuance")
		}

		assertNoSecret(t, secret, &errOut)
	})
}

func TestAgentsKeysStoreMergesConcurrentCredentialsChanges(t *testing.T) {
	const secret = "sk_live_merge"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, _ := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	// Another writer updates the file while the API call is in flight.
	handler := agentKeyStubSecret(secret)
	handler.create = func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
		raw, _ := os.ReadFile(credentialsPath)
		_ = os.WriteFile(credentialsPath, bytes.Replace(raw, []byte(`"custom": "kept"`), []byte(`"custom": "kept", "added_concurrently": true`), 1), privateFileMode)
		return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
		store: storeOpts(registry, capture), out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	raw, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(raw), `"added_concurrently": true`) || !strings.Contains(string(raw), `"agent_key_refs"`) {
		t.Fatalf("concurrent change was not merged:\n%s", raw)
	}
}

func TestAgentsKeysRotateStoreReplacesSecretAndChecksAgent(t *testing.T) {
	const secret = "sk_live_rotated"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[TeamAgentKeyKey(testAgentID, testTeamID)] = "sk_live_previous"
	capture := newRecoveryCapture(t)
	_, _, client := newTestServer(t, agentKeyStubSecret(secret))

	var out, errOut bytes.Buffer
	err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: credentialsPath, teamID: testTeamID, keyID: "key-1",
		store: storeOpts(registry, capture), out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.values[TeamAgentKeyKey(testAgentID, testTeamID)] != secret {
		t.Fatal("rotation must replace the stored secret")
	}
	assertNoSecret(t, secret, &out, &errOut)
	creds, _ := ReadConfigFrom(credentialsPath)
	if creds.AgentKeyRefs[testTeamID].Key != TeamAgentKeyKey(testAgentID, testTeamID) {
		t.Fatalf("agent_key_ref not written: %+v", creds.AgentKeyRef)
	}

	other := writeAgentKeyStoreFixture(t, "00000000-0000-4000-8000-00000000beef")
	out.Reset()
	err = runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: other, teamID: testTeamID, keyID: "key-1",
		store: storeOpts(registry, capture), out: &out, errOut: &errOut,
	})
	if err == nil || !strings.Contains(err.Error(), "authenticates agent") || !strings.Contains(err.Error(), "verify_identity") {
		t.Fatalf("expected agent mismatch, got %v", err)
	}
	assertNoSecret(t, secret, &out, &errOut)
	if len(capture.written) != 2 || capture.latest(t).Secret != secret || capture.latest(t).Stage != "verify_identity" {
		t.Fatalf("mismatch after rotation must preserve the new secret in the recovery artifact: %+v", capture.written)
	}
	if creds, _ := ReadConfigFrom(other); creds.AgentKeyRef != nil || len(creds.AgentKeyRefs) != 0 {
		t.Fatal("mismatched subject must not gain agent_key_ref")
	}
}

func validIdentityAgentKey(id string) moltnetapi.AgentKey {
	k := moltnetapi.IdentityAgentKey{
		ID:           id,
		AgentId:      uuid.MustParse(testAgentID),
		BindingScope: moltnetapi.IdentityAgentKeyBindingScopeIdentity,
		Name:         id,
		Scopes:       []moltnetapi.CredentialScope{},
		Status:       moltnetapi.AgentKeyStatusActive,
	}
	k.CreatedAt.SetToNull()
	k.ExpiresAt.SetToNull()
	k.LastUsedAt.SetToNull()
	k.RevocationDescription.SetToNull()
	k.RevocationReason.SetToNull()
	k.UpdatedAt.SetToNull()
	return moltnetapi.NewIdentityAgentKeyAgentKey(k)
}

func TestAgentsKeysRotateStoreHandlesIdentityScopedKeys(t *testing.T) {
	const secret = "sk_live_identity_rotated"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	handler := agentKeyStubSecret(secret)
	handler.rotate = func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes {
		return &moltnetapi.AgentKeyWithSecret{Key: validIdentityAgentKey("key-id"), Secret: secret}
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: credentialsPath, identityScoped: true, keyID: "key-id",
		store: storeOpts(registry, capture), out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.values[AgentKeyKey(testAgentID)] != secret {
		t.Fatal("identity-scoped rotation not stored")
	}
	assertNoSecret(t, secret, &out, &errOut)
	if id, ok := agentKeyAgentID(validIdentityAgentKey("x")); !ok || id != testAgentID {
		t.Fatalf("agentKeyAgentID(identity) = %q, %v", id, ok)
	}
	if _, ok := agentKeyAgentID(moltnetapi.AgentKey{}); ok {
		t.Fatal("empty union must not report an agent id")
	}
}

func TestAgentsKeysStoreFlagsParseThroughCobra(t *testing.T) {
	for _, sub := range [][]string{
		{"create", "--team-id", testTeamID, "--agent-id", testAgentID, "--name", "d"},
		{"rotate", "key-1", "--team-id", testTeamID},
	} {
		t.Run(sub[0], func(t *testing.T) {
			root := NewRootCmd("test", "")
			args := append([]string{"agents", "keys"}, sub...)
			args = append(args, "--store", "--destination", "env", "--credentials", filepath.Join(t.TempDir(), "moltnet.json"), "--api-url", "https://api.example.test")
			_, _, err := executeCommand(root, args...)
			// The destination check runs before credentials or the network,
			// so a read-only destination is the first thing to fail.
			if err == nil || !strings.Contains(err.Error(), "read-only") {
				t.Fatalf("--store/--destination not wired for %s: %v", sub[0], err)
			}
		})
	}
}

func TestSecretProviderRegistryReplaceVerifiesUnderLock(t *testing.T) {
	registry := NewSecretProviderRegistry()
	provider := &echoingSecretProvider{}
	registry.Register("echo", provider)
	err := registry.Replace(SecretReference{Provider: "echo", Key: "k"}, "value")
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("Replace must verify the read-back: %v", err)
	}
	memory := &memorySecretProvider{values: map[string]string{"k": "old"}}
	registry.Register("memory", memory)
	if err := registry.Replace(SecretReference{Provider: "memory", Key: "k"}, "new"); err != nil || memory.values["k"] != "new" {
		t.Fatalf("Replace must overwrite: %v %v", err, memory.values)
	}
	if err := registry.Replace(SecretReference{Provider: "memory", Key: "k"}, ""); err == nil {
		t.Fatal("empty values must be rejected")
	}
}

type failingWriteSecretProvider struct{}

func (failingWriteSecretProvider) CanWrite() bool             { return true }
func (failingWriteSecretProvider) Get(string) (string, error) { return "", ErrSecretNotFound }
func (failingWriteSecretProvider) Set(string, string) error   { return errors.New("keyring locked") }
func (failingWriteSecretProvider) Delete(string) error        { return nil }

// echoingSecretProvider accepts writes but always reads back a different
// value, modelling a store that normalizes or truncates secrets.
type echoingSecretProvider struct{ writes int }

func (p *echoingSecretProvider) CanWrite() bool             { return true }
func (p *echoingSecretProvider) Get(string) (string, error) { return "normalized-elsewhere", nil }
func (p *echoingSecretProvider) Set(string, string) error   { p.writes++; return nil }
func (p *echoingSecretProvider) Delete(string) error        { return nil }

func TestAgentKeyStoreBindingFailuresPreserveActualIssuedReference(t *testing.T) {
	for _, scenario := range []string{"subject", "team", "identity"} {
		t.Run(scenario, func(t *testing.T) {
			path := writeAgentKeyStoreFixture(t, testAgentID)
			before, _ := os.ReadFile(path)
			registry, provider := newMemorySecretProviderRegistry()
			capture := newRecoveryCapture(t)
			target, err := prepareAgentKeyStore(storeOpts(registry, capture), path)
			if err != nil {
				t.Fatal(err)
			}
			target.enrollment = true
			target.expectedTeam = testTeamID
			key := validAgentKey("issued-id")
			expected := TeamAgentKeyKey(testAgentID, testTeamID)
			switch scenario {
			case "subject":
				team, _ := key.GetTeamAgentKey()
				team.AgentId = uuid.MustParse("00000000-0000-4000-8000-00000000beef")
				key = moltnetapi.NewTeamAgentKeyAgentKey(team)
				expected = TeamAgentKeyKey(team.AgentId.String(), testTeamID)
			case "team":
				target.expectedTeam = "00000000-0000-4000-8000-00000000beef"
			case "identity":
				key = validIdentityAgentKey("issued-id")
				expected = AgentKeyKey(testAgentID)
			}
			var out bytes.Buffer
			err = target.persist(&out, &out, storedAgentKeyOutput{Key: key}, "one-time-secret")
			if err == nil {
				t.Fatal("binding mismatch accepted")
			}
			recovered := capture.latest(t)
			if recovered.AgentKeyRef.Key != expected || recovered.IssuedKey == nil {
				t.Fatal("recovery lost actual issued binding")
			}
			if len(provider.values) != 0 {
				t.Fatal("mismatched credential stored")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("binding rejection changed credential document")
			}
			assertNoSecret(t, "one-time-secret", &out)
		})
	}
}

func TestAgentKeyStoreCleanupFailureReportsCompletedCredential(t *testing.T) {
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	opts := storeOpts(registry, capture)
	opts.removeRecovery = func(string) error { return errors.New("remove denied") }
	target, err := prepareAgentKeyStore(opts, path)
	if err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if err = target.persist(&out, &errOut, storedAgentKeyOutput{Key: validAgentKey("issued")}, "saved-secret"); err != nil {
		t.Fatal(err)
	}
	var result storedAgentKeyOutput
	if err = json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.SecretStored || !result.CredentialsUpdated || !result.CleanupRequired || result.ManualRecoveryRequired || result.RecoveryPath == "" {
		t.Fatalf("wrong completed result: %+v", result)
	}
	if provider.values[TeamAgentKeyKey(testAgentID, testTeamID)] != "saved-secret" {
		t.Fatal("secret not saved")
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if creds.AgentKeyRefs[testTeamID] != result.AgentKeyRef {
		t.Fatal("credential not usable")
	}
	if !strings.Contains(errOut.String(), "no credential restoration is needed") {
		t.Fatal("cleanup guidance missing")
	}
	assertNoSecret(t, "saved-secret", &out, &errOut)
}

func TestCredentialUpdateGuardRunsBeforeSecretSideEffect(t *testing.T) {
	path := writeAgentKeyStoreFixture(t, testAgentID)
	before, _ := os.ReadFile(path)
	changed := append(append([]byte(nil), before...), ' ')
	called := false
	err := updateLockedCredentialsBytes(path, func(raw []byte) ([]byte, error) {
		if err := os.WriteFile(path, changed, 0600); err != nil {
			return nil, err
		}
		return raw, nil
	}, func() error { called = true; return nil })
	if err == nil || called {
		t.Fatal("stale document allowed secret side effect")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(after, changed) {
		t.Fatal("concurrent change lost")
	}
}

func assertCredentialReferencesUnchanged(t *testing.T, path string) func() {
	t.Helper()
	read := func() map[string]json.RawMessage {
		t.Helper()
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var doc map[string]json.RawMessage
		if err = json.Unmarshal(data, &doc); err != nil {
			t.Fatal(err)
		}
		return doc
	}
	before := read()
	return func() {
		after := read()
		for _, field := range []string{"agent_key_ref", "agent_key_refs"} {
			if !bytes.Equal(before[field], after[field]) {
				t.Errorf("failed storage changed %s", field)
			}
		}
	}
}

func TestEnrollmentCaptureFailureDoesNotClaimMetadataContainsSecret(t *testing.T) {
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	opts := storeOpts(registry, capture)
	target, err := prepareAgentKeyStore(opts, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = target.capture(agentKeyRecovery{Stage: "issuance_outcome_unknown", Enrollment: &enrollmentRecoveryRequest{Code: "private-code", IdempotencyKey: "stable"}}); err != nil {
		t.Fatal(err)
	}
	target.replaceRecovery = func(string, []byte) error { return errors.New("injected replace failure") }
	var out bytes.Buffer
	err = target.persist(&out, &out, storedAgentKeyOutput{Key: validAgentKey("issued")}, "new-secret")
	if err == nil || strings.Contains(err.Error(), "secret was written") {
		t.Fatalf("false capture claim: %v", err)
	}
	var result storedAgentKeyOutput
	if e := json.Unmarshal(out.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if result.SecretCaptured || result.SecretStored || result.RecoveryPath == "" {
		t.Fatalf("incorrect capture state: %+v", result)
	}
	if artifact := capture.latest(t); artifact.Secret != "" || artifact.Stage != "issuance_outcome_unknown" {
		t.Fatal("metadata unexpectedly replaced")
	}
	if len(provider.values) != 0 {
		t.Fatal("provider called after failed capture")
	}
	assertNoSecret(t, "new-secret", &out)
}

func TestEnrollmentStoreReportsUnverifiedDestinationWrite(t *testing.T) {
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	registry.Register(osKeyringProviderName, &unverifiedTeamCopyProvider{memorySecretProvider: provider})
	capture := newRecoveryCapture(t)
	target, err := prepareAgentKeyStore(storeOpts(registry, capture), path)
	if err != nil {
		t.Fatal(err)
	}
	target.enrollment = true
	var out bytes.Buffer
	err = target.persist(&out, &out, storedAgentKeyOutput{Key: validAgentKey("issued")}, "new-secret")
	if err == nil || !strings.Contains(err.Error(), "write occurred but was not verified") {
		t.Fatalf("missing partial write guidance: %v", err)
	}
	var result storedAgentKeyOutput
	if e := json.Unmarshal(out.Bytes(), &result); e != nil {
		t.Fatal(e)
	}
	if !result.SecretWritten || result.SecretStored || !result.SecretCaptured || result.CredentialsUpdated {
		t.Fatalf("wrong state: %+v", result)
	}
	artifact := capture.latest(t)
	if !artifact.SecretWritten || artifact.SecretStored || artifact.Secret != "new-secret" {
		t.Fatal("partial write state not retained")
	}
}

func TestRotationLostResponseReconcilesReplacement(t *testing.T) {
	path := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	capture := newRecoveryCapture(t)
	key := TeamAgentKeyKey(testAgentID, testTeamID)
	provider.values[key] = "old-secret"
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls > 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": "Conflict", "status": 409, "code": "CONFLICT", "conflict": map[string]any{"target": map[string]any{"resource": "agent-key", "keys": map[string]string{"keyId": "replacement-key", "previousKeyId": "existing-key", "subjectId": testAgentID, "teamId": testTeamID, "bindingScope": "team"}}}})
			return
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close()
	}))
	defer server.Close()
	client, err := newAgentKeyAuthenticatedClient(server.URL, "independent-manager")
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	err = runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{apiURL: server.URL, credPath: path, teamID: testTeamID, keyID: "existing-key", store: storeOpts(registry, capture), out: &out, errOut: &out})
	if err == nil || !strings.Contains(err.Error(), "rotation outcome is unknown") {
		t.Fatalf("unexpected rotation result: %v", err)
	}
	artifact := capture.latest(t)
	if artifact.Stage != "rotation_outcome_unknown" || artifact.Rotation == nil || artifact.Rotation.KeyID != "existing-key" || artifact.Rotation.TeamID != testTeamID || artifact.Rotation.APIURL != server.URL {
		t.Fatal("rotation context missing")
	}
	if provider.values[key] != "old-secret" {
		t.Fatal("unknown rotation changed provider")
	}
	out.Reset()
	err = runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{apiURL: server.URL, credPath: path, teamID: testTeamID, keyID: "existing-key", store: storeOpts(registry, capture), out: &out, errOut: &out})
	if err == nil || !strings.Contains(err.Error(), "replacement key replacement-key") {
		t.Fatalf("missing replacement identifier: %v", err)
	}
	artifact = capture.latest(t)
	if artifact.Stage != "rotated_secret_unavailable" || artifact.Reconciliation == nil || artifact.Reconciliation.KeyID != "replacement-key" || artifact.Reconciliation.TeamID != testTeamID || calls != 2 {
		t.Fatal("replacement not reconciled")
	}
	if provider.values[key] != "old-secret" {
		t.Fatal("reconciliation changed provider")
	}
	assertNoSecret(t, "old-secret", &out)
}

func TestIdentityScopedLifecycleRejectsTeamResponse(t *testing.T) {
	for _, operation := range []string{"create", "rotate"} {
		t.Run(operation, func(t *testing.T) {
			path := writeAgentKeyStoreFixture(t, testAgentID)
			before, _ := os.ReadFile(path)
			registry, provider := newMemorySecretProviderRegistry()
			capture := newRecoveryCapture(t)
			_, _, client := newTestServer(t, agentKeyStubSecret("unexpected-team-secret"))
			var out bytes.Buffer
			var err error
			if operation == "create" {
				err = runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{credPath: path, identityScoped: true, agentID: testAgentID, name: "test", store: storeOpts(registry, capture), out: &out, errOut: &out})
			} else {
				err = runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{credPath: path, identityScoped: true, keyID: "old-key", store: storeOpts(registry, capture), out: &out, errOut: &out})
			}
			if err == nil || !strings.Contains(err.Error(), "expected an identity-scoped credential") {
				t.Fatalf("unexpected result: %v", err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) || len(provider.values) != 0 {
				t.Fatal("binding mismatch changed credentials")
			}
			artifact := capture.latest(t)
			if artifact.IssuedKey == nil || artifact.Secret != "unexpected-team-secret" || artifact.AgentKeyRef.Key != TeamAgentKeyKey(testAgentID, testTeamID) {
				t.Fatal("actual issued credential not retained")
			}
			assertNoSecret(t, "unexpected-team-secret", &out)
		})
	}
}

func TestLifecycleStoreReportsUnverifiedReplacement(t *testing.T) {
	for _, mode := range []string{"mismatch", "read-error"} {
		t.Run(mode, func(t *testing.T) {
			path := writeAgentKeyStoreFixture(t, testAgentID)
			before, _ := os.ReadFile(path)
			registry, memory := newMemorySecretProviderRegistry()
			provider := &echoingSecretProvider{}
			registry.Register(osKeyringProviderName, provider)
			if mode == "read-error" {
				registry.Register(osKeyringProviderName, &unverifiedTeamCopyProvider{memorySecretProvider: memory})
			}
			capture := newRecoveryCapture(t)
			target, err := prepareAgentKeyStore(storeOpts(registry, capture), path)
			if err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			err = target.persist(&out, &out, storedAgentKeyOutput{Key: validAgentKey("replacement")}, "replacement-secret")
			if err == nil || !strings.Contains(err.Error(), "write occurred but was not verified") {
				t.Fatalf("missing partial write guidance: %v", err)
			}
			var result storedAgentKeyOutput
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			artifact := capture.latest(t)
			after, _ := os.ReadFile(path)
			if (mode == "mismatch" && provider.writes != 1) || !result.SecretWritten || result.SecretStored || result.CredentialsUpdated || !artifact.SecretWritten || artifact.SecretStored || artifact.Secret != "replacement-secret" || !bytes.Equal(before, after) {
				t.Fatal("incorrect partial replacement state")
			}
			assertNoSecret(t, "replacement-secret", &out)
		})
	}
}
