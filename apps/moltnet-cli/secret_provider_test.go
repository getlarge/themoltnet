package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

type keyringConformanceFixture struct {
	Windows []struct {
		Service string `json:"service"`
		Key     string `json:"key"`
		Target  string `json:"target"`
	} `json:"windows"`
}

type memorySecretProvider struct {
	values map[string]string
}

func (p *memorySecretProvider) Get(key string) (string, error) {
	return p.values[key], nil
}

func (p *memorySecretProvider) Set(key, value string) error {
	p.values[key] = value
	return nil
}

func (p *memorySecretProvider) Delete(key string) error {
	delete(p.values, key)
	return nil
}

func TestSecretProviderRegistryResolve(t *testing.T) {
	provider := &memorySecretProvider{values: map[string]string{"agent": "canary-secret"}}
	registry := NewSecretProviderRegistry()
	registry.Register("memory", provider)

	secret, err := registry.Resolve(SecretReference{Provider: "memory", Key: "agent"})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if secret != "canary-secret" {
		t.Fatalf("Resolve = %q, want canary secret", secret)
	}
}

func TestEnvironmentSecretProviderIsReadOnly(t *testing.T) {
	t.Setenv("MOLTNET_TEST_PROVIDER_SECRET", "environment-secret")
	provider := EnvironmentSecretProvider{}

	secret, err := provider.Get("MOLTNET_TEST_PROVIDER_SECRET")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if secret != "environment-secret" {
		t.Fatalf("Get = %q, want environment secret", secret)
	}
	if err := provider.Set("MOLTNET_TEST_PROVIDER_SECRET", "changed"); err == nil {
		t.Fatal("Set succeeded for read-only environment provider")
	}
	if err := provider.Delete("MOLTNET_TEST_PROVIDER_SECRET"); err == nil {
		t.Fatal("Delete succeeded for read-only environment provider")
	}
}

func TestOSKeyringSecretProviderRoundTrip(t *testing.T) {
	keyring.MockInit()
	provider := OSKeyringSecretProvider{}
	key := "oauth2/test-identity/test-client"

	if err := provider.Set(key, "keyring-secret"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	secret, err := provider.Get(key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if secret != "keyring-secret" {
		t.Fatalf("Get = %q, want keyring secret", secret)
	}
	if err := provider.Delete(key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := provider.Get(key); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("Get after Delete error = %v, want not found", err)
	}
}

func TestResolveOAuth2SecretRejectsAmbiguousConfig(t *testing.T) {
	creds := &CredentialsFile{OAuth2: CredentialsOAuth2{
		ClientSecret: "plaintext",
		ClientSecretRef: &SecretReference{
			Provider: environmentProviderName,
			Key:      "MOLTNET_CLIENT_SECRET",
		},
	}}

	_, err := resolveOAuth2Secret(creds, NewSecretProviderRegistry())
	if err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("resolveOAuth2Secret error = %v, want exclusive-union error", err)
	}
}

func TestOAuth2SecretKeyIsStable(t *testing.T) {
	got := OAuth2SecretKey("identity-123", "client-456")
	if got != "oauth2/identity-123/client-456" {
		t.Fatalf("OAuth2SecretKey = %q", got)
	}
}

func TestWindowsKeyringTargetMatchesCrossRuntimeConformance(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "keyring-conformance.json"))
	if err != nil {
		t.Fatalf("read conformance fixture: %v", err)
	}
	var fixture keyringConformanceFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse conformance fixture: %v", err)
	}
	if len(fixture.Windows) == 0 {
		t.Fatal("Windows keyring conformance fixture is empty")
	}
	for _, vector := range fixture.Windows {
		if got := windowsKeyringTarget(vector.Service, vector.Key); got != vector.Target {
			t.Errorf("windowsKeyringTarget(%q, %q) = %q, want %q", vector.Service, vector.Key, got, vector.Target)
		}
	}
}

func TestSecretReferenceConfigRoundTripDoesNotEmbedSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "moltnet.json")
	wantRef := &SecretReference{
		Provider: osKeyringProviderName,
		Key:      OAuth2SecretKey("identity-123", "client-456"),
	}
	config := &CredentialsFile{
		IdentityID: "identity-123",
		OAuth2: CredentialsOAuth2{
			ClientID:        "client-456",
			ClientSecretRef: wantRef,
		},
	}

	if _, err := WriteConfigTo(config, path); err != nil {
		t.Fatalf("WriteConfigTo: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if strings.Contains(string(data), "client_secret\"") {
		t.Fatalf("config contains plaintext client_secret field: %s", data)
	}
	got, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatalf("ReadConfigFrom: %v", err)
	}
	if got == nil || got.OAuth2.ClientSecretRef == nil ||
		*got.OAuth2.ClientSecretRef != *wantRef {
		t.Fatalf("round-tripped reference = %#v, want %#v", got, wantRef)
	}
}
