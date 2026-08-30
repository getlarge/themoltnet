package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func writeAgentKeyStoreFixture(t *testing.T, identityID string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "moltnet.json")
	doc := `{
  "identity_id": ` + mustJSON(t, identityID) + `,
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
	return writeRecoveryArtifact(c.dir, "agent-key-recovery-*.json", recovery)
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
	if provider.values[AgentKeyKey(testAgentID)] != secret {
		t.Fatal("secret was not stored under agent-key/<identity_id>")
	}
	var result storedAgentKeyOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, out.String())
	}
	if !result.SecretStored || !result.CredentialsUpdated || result.ManualRecoveryRequired || result.RecoveryPath != "" ||
		result.AgentKeyRef.Provider != osKeyringProviderName || result.AgentKeyRef.Key != AgentKeyKey(testAgentID) || result.IdempotencyKey == "" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(capture.written) != 0 {
		t.Fatal("success must not write a recovery artifact")
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.AgentKeyRef == nil || *creds.AgentKeyRef != result.AgentKeyRef {
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
		if len(capture.written) != 1 || capture.written[0].Secret != secret || capture.written[0].Stage != "store_secret" || capture.written[0].SecretStored {
			t.Fatalf("recovery artifact = %+v", capture.written)
		}
		data, err := os.ReadFile(result.RecoveryPath)
		if err != nil || !strings.Contains(string(data), secret) {
			t.Fatalf("recovery file must hold the secret durably: %v", err)
		}
		if info, _ := os.Stat(result.RecoveryPath); info.Mode().Perm() != privateFileMode {
			t.Fatalf("recovery file mode = %o", info.Mode().Perm())
		}
		if creds, _ := ReadConfigFrom(credentialsPath); creds.AgentKeyRef != nil {
			t.Fatal("agent_key_ref must not be written when the secret was not stored")
		}
	})

	t.Run("read-back mismatch is a storage failure", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
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
		if provider.writes != 1 || len(capture.written) != 1 || capture.written[0].Secret != secret {
			t.Fatalf("writes=%d recovery=%+v", provider.writes, capture.written)
		}
	})

	t.Run("config update failure keeps the stored secret and records the reference", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		registry, provider := newMemorySecretProviderRegistry()
		capture := newRecoveryCapture(t)
		// Swap the identity after the target was prepared: the locked
		// re-read refuses to bind the key to a different identity.
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
		if err == nil || !strings.Contains(err.Error(), "update_credentials") || !strings.Contains(err.Error(), "add agent_key_ref") {
			t.Fatalf("unexpected error: %v", err)
		}
		assertNoSecret(t, secret, &out, &errOut)
		var result storedAgentKeyOutput
		if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || !result.ManualRecoveryRequired || !result.SecretStored || result.CredentialsUpdated || result.AgentKeyRef.Key != AgentKeyKey(testAgentID) {
			t.Fatalf("result = %v %+v", jerr, result)
		}
		if provider.values[AgentKeyKey(testAgentID)] != secret {
			t.Fatal("stored secret was lost")
		}
		if len(capture.written) != 1 || capture.written[0].Secret != "" || !capture.written[0].SecretStored {
			t.Fatalf("a stored secret must not be copied into the recovery artifact: %+v", capture.written)
		}
		if creds, _ := ReadConfigFrom(credentialsPath); creds.AgentKeyRef != nil {
			t.Fatal("agent_key_ref must not be bound to a changed identity")
		}
	})

	t.Run("recovery artifact and stdout both failing still never prints the secret", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
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
		for _, want := range []string{"revoke this key and mint a new one", "recovery artifact failed", "result output failed"} {
			if !strings.Contains(err.Error(), want) {
				t.Fatalf("error %q lacks %q", err, want)
			}
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
	if !strings.Contains(string(raw), `"added_concurrently": true`) || !strings.Contains(string(raw), `"agent_key_ref"`) {
		t.Fatalf("concurrent change was not merged:\n%s", raw)
	}
}

func TestAgentsKeysRotateStoreReplacesSecretAndChecksAgent(t *testing.T) {
	const secret = "sk_live_rotated"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[AgentKeyKey(testAgentID)] = "sk_live_previous"
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
	if provider.values[AgentKeyKey(testAgentID)] != secret {
		t.Fatal("rotation must replace the stored secret")
	}
	assertNoSecret(t, secret, &out, &errOut)
	creds, _ := ReadConfigFrom(credentialsPath)
	if creds.AgentKeyRef == nil || creds.AgentKeyRef.Key != AgentKeyKey(testAgentID) {
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
	if len(capture.written) != 1 || capture.written[0].Secret != secret || capture.written[0].Stage != "verify_identity" {
		t.Fatalf("mismatch after rotation must preserve the new secret in the recovery artifact: %+v", capture.written)
	}
	if creds, _ := ReadConfigFrom(other); creds.AgentKeyRef != nil {
		t.Fatal("mismatched identity must not gain agent_key_ref")
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
