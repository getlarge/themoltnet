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

func agentKeyCreateStubSecret(secret string) agentKeysStubHandler {
	return agentKeysStubHandler{
		create: func(_ *moltnetapi.CreateAgentKeyReq, _ moltnetapi.CreateAgentKeyParams) moltnetapi.CreateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
		},
		rotate: func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes {
			return &moltnetapi.AgentKeyWithSecret{Key: validAgentKey("key-1"), Secret: secret}
		},
	}
}

func TestAgentsKeysCreateStoreWritesReferenceWithoutPrintingSecret(t *testing.T) {
	const secret = "sk_live_TOPSECRET_store"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	_, _, client := newTestServer(t, agentKeyCreateStubSecret(secret))

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
		store: agentKeyStoreOpts{enabled: true, secretProviders: registry},
		out:   &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(out.String(), secret) || strings.Contains(errOut.String(), secret) {
		t.Fatalf("secret leaked to output:\n%s\n%s", out.String(), errOut.String())
	}
	if provider.values[AgentKeyKey(testAgentID)] != secret {
		t.Fatal("secret was not stored under agent-key/<identity_id>")
	}
	var result storedAgentKeyOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, out.String())
	}
	if !result.CredentialsUpdated || result.AgentKeyRef.Provider != osKeyringProviderName || result.AgentKeyRef.Key != AgentKeyKey(testAgentID) || result.IdempotencyKey == "" {
		t.Fatalf("unexpected result: %+v", result)
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
	calls := 0
	handler := agentKeyCreateStubSecret("never")
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
		{"agent id mismatch", agentsKeysCreateOpts{credPath: credentialsPath, agentID: testAgentID, store: agentKeyStoreOpts{enabled: true, secretProviders: registry}}, "authenticates agent"},
		{"env destination", agentsKeysCreateOpts{credPath: credentialsPath, agentID: testAgentID, store: agentKeyStoreOpts{enabled: true, destination: "env", secretProviders: registry}}, "read-only"},
		{"missing credentials", agentsKeysCreateOpts{credPath: filepath.Join(t.TempDir(), "none.json"), agentID: testAgentID, store: agentKeyStoreOpts{enabled: true, secretProviders: registry}}, "requires a credentials file"},
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

func TestAgentsKeysCreateStoreRecoversWhenPersistenceFails(t *testing.T) {
	const secret = "sk_live_recover_me"
	t.Run("store failure returns the secret", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		registry := NewSecretProviderRegistry()
		registry.Register(osKeyringProviderName, failingWriteSecretProvider{})
		_, _, client := newTestServer(t, agentKeyCreateStubSecret(secret))
		var out, errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: agentKeyStoreOpts{enabled: true, secretProviders: registry}, out: &out, errOut: &errOut,
		})
		if err == nil || !strings.Contains(err.Error(), "store it yourself") {
			t.Fatalf("expected recovery error, got %v", err)
		}
		var result storedAgentKeyOutput
		if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || result.Secret != secret || result.CredentialsUpdated {
			t.Fatalf("recovery JSON must carry the secret: %v %+v", jerr, result)
		}
		creds, _ := ReadConfigFrom(credentialsPath)
		if creds.AgentKeyRef != nil {
			t.Fatal("agent_key_ref must not be written when the secret was not stored")
		}
	})
	t.Run("config write failure keeps the stored secret and asks for manual recovery", func(t *testing.T) {
		credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
		registry, provider := newMemorySecretProviderRegistry()
		_, _, client := newTestServer(t, agentKeyCreateStubSecret(secret))
		var out, errOut bytes.Buffer
		err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
			credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
			store: agentKeyStoreOpts{enabled: true, secretProviders: registry, writeCredentials: func(string, []byte) error { return errors.New("disk full") }},
			out:   &out, errOut: &errOut,
		})
		if err == nil || !strings.Contains(err.Error(), "add agent_key_ref manually") {
			t.Fatalf("expected manual recovery error, got %v", err)
		}
		if strings.Contains(out.String(), secret) {
			t.Fatal("secret must not be printed when it is safely stored")
		}
		var result storedAgentKeyOutput
		if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || !result.ManualRecoveryRequired || result.AgentKeyRef.Key != AgentKeyKey(testAgentID) {
			t.Fatalf("manual recovery JSON must name the reference: %v %+v", jerr, result)
		}
		if provider.values[AgentKeyKey(testAgentID)] != secret {
			t.Fatal("stored secret was lost")
		}
	})
}

func TestAgentsKeysRotateStoreReplacesSecretAndChecksAgent(t *testing.T) {
	const secret = "sk_live_rotated"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[AgentKeyKey(testAgentID)] = "sk_live_previous"
	_, _, client := newTestServer(t, agentKeyCreateStubSecret(secret))

	var out, errOut bytes.Buffer
	err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: credentialsPath, teamID: testTeamID, keyID: "key-1",
		store: agentKeyStoreOpts{enabled: true, secretProviders: registry}, out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.values[AgentKeyKey(testAgentID)] != secret {
		t.Fatal("rotation must replace the stored secret")
	}
	if strings.Contains(out.String(), secret) {
		t.Fatal("rotated secret leaked to stdout")
	}
	creds, _ := ReadConfigFrom(credentialsPath)
	if creds.AgentKeyRef == nil || creds.AgentKeyRef.Key != AgentKeyKey(testAgentID) {
		t.Fatalf("agent_key_ref not written: %+v", creds.AgentKeyRef)
	}

	other := writeAgentKeyStoreFixture(t, "00000000-0000-4000-8000-00000000beef")
	out.Reset()
	err = runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: other, teamID: testTeamID, keyID: "key-1",
		store: agentKeyStoreOpts{enabled: true, secretProviders: registry}, out: &out, errOut: &errOut,
	})
	if err == nil || !strings.Contains(err.Error(), "authenticates agent") {
		t.Fatalf("expected agent mismatch, got %v", err)
	}
	var result storedAgentKeyOutput
	if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || result.Secret != secret {
		t.Fatalf("mismatch after rotation must hand the new secret back: %v %+v", jerr, result)
	}
	if creds, _ := ReadConfigFrom(other); creds.AgentKeyRef != nil {
		t.Fatal("mismatched identity must not gain agent_key_ref")
	}
}

type failingWriteSecretProvider struct{}

func (failingWriteSecretProvider) CanWrite() bool             { return true }
func (failingWriteSecretProvider) Get(string) (string, error) { return "", ErrSecretNotFound }
func (failingWriteSecretProvider) Set(string, string) error   { return errors.New("keyring locked") }
func (failingWriteSecretProvider) Delete(string) error        { return nil }

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
	handler := agentKeyCreateStubSecret(secret)
	handler.rotate = func(_ moltnetapi.RotateAgentKeyParams) moltnetapi.RotateAgentKeyRes {
		return &moltnetapi.AgentKeyWithSecret{Key: validIdentityAgentKey("key-id"), Secret: secret}
	}
	_, _, client := newTestServer(t, handler)

	var out, errOut bytes.Buffer
	err := runAgentsKeysRotateWithClient(context.Background(), client, agentsKeysRotateOpts{
		credPath: credentialsPath, identityScoped: true, keyID: "key-id",
		store: agentKeyStoreOpts{enabled: true, secretProviders: registry}, out: &out, errOut: &errOut,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if provider.values[AgentKeyKey(testAgentID)] != secret || strings.Contains(out.String(), secret) {
		t.Fatalf("identity-scoped rotation not stored silently: %s", out.String())
	}
	if id, ok := agentKeyAgentID(validIdentityAgentKey("x")); !ok || id != testAgentID {
		t.Fatalf("agentKeyAgentID(identity) = %q, %v", id, ok)
	}
	if _, ok := agentKeyAgentID(moltnetapi.AgentKey{}); ok {
		t.Fatal("empty union must not report an agent id")
	}
}

// echoingSecretProvider accepts writes but always reads back a different
// value, modelling a store that normalizes or truncates secrets.
type echoingSecretProvider struct{ writes int }

func (p *echoingSecretProvider) CanWrite() bool             { return true }
func (p *echoingSecretProvider) Get(string) (string, error) { return "normalized-elsewhere", nil }
func (p *echoingSecretProvider) Set(string, string) error   { p.writes++; return nil }
func (p *echoingSecretProvider) Delete(string) error        { return nil }

func TestAgentsKeysCreateStoreTreatsReadBackMismatchAsStorageFailure(t *testing.T) {
	const secret = "sk_live_readback"
	credentialsPath := writeAgentKeyStoreFixture(t, testAgentID)
	registry := NewSecretProviderRegistry()
	provider := &echoingSecretProvider{}
	registry.Register(osKeyringProviderName, provider)
	_, _, client := newTestServer(t, agentKeyCreateStubSecret(secret))

	var out, errOut bytes.Buffer
	err := runAgentsKeysCreateWithClient(context.Background(), client, agentsKeysCreateOpts{
		credPath: credentialsPath, teamID: testTeamID, agentID: testAgentID, name: "daemon",
		store: agentKeyStoreOpts{enabled: true, secretProviders: registry}, out: &out, errOut: &errOut,
	})
	if err == nil || !strings.Contains(err.Error(), "verify stored agent key") || !strings.Contains(err.Error(), "store it yourself") {
		t.Fatalf("expected verification recovery error, got %v", err)
	}
	if provider.writes != 1 {
		t.Fatalf("expected exactly one write, got %d", provider.writes)
	}
	var result storedAgentKeyOutput
	if jerr := json.Unmarshal(out.Bytes(), &result); jerr != nil || result.Secret != secret {
		t.Fatalf("recovery JSON must carry the secret: %v %+v", jerr, result)
	}
	if creds, _ := ReadConfigFrom(credentialsPath); creds.AgentKeyRef != nil {
		t.Fatal("agent_key_ref must not be written after a read-back mismatch")
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
