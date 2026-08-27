package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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

func newMemorySecretProviderRegistry() (*SecretProviderRegistry, *memorySecretProvider) {
	provider := &memorySecretProvider{values: make(map[string]string)}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)
	return registry, provider
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

type concurrentEnsureProvider struct {
	active    atomic.Int32
	maxActive atomic.Int32
	mu        sync.Mutex
	value     string
}

func (p *concurrentEnsureProvider) enter() func() {
	active := p.active.Add(1)
	for current := p.maxActive.Load(); active > current && !p.maxActive.CompareAndSwap(current, active); current = p.maxActive.Load() {
	}
	time.Sleep(10 * time.Millisecond)
	return func() { p.active.Add(-1) }
}

func (p *concurrentEnsureProvider) Get(string) (string, error) {
	leave := p.enter()
	defer leave()
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.value, nil
}

func (p *concurrentEnsureProvider) Set(_ string, value string) error {
	leave := p.enter()
	defer leave()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.value = value
	return nil
}

func (*concurrentEnsureProvider) Delete(string) error { return nil }

func TestSecretProviderEnsureSerializesTheProviderKey(t *testing.T) {
	provider := &concurrentEnsureProvider{}
	registry := NewSecretProviderRegistry()
	registry.Register("memory", provider)
	ref := SecretReference{Provider: "memory", Key: "shared"}
	errs := make(chan error, 2)
	var started sync.WaitGroup
	started.Add(2)
	for _, value := range []string{"first", "second"} {
		go func() {
			started.Done()
			started.Wait()
			_, err := registry.Ensure(ref, value)
			errs <- err
		}()
	}
	firstErr, secondErr := <-errs, <-errs
	if (firstErr == nil) == (secondErr == nil) {
		t.Fatalf("Ensure errors = %v, %v; want one winner", firstErr, secondErr)
	}
	if provider.maxActive.Load() != 1 {
		t.Fatalf("provider operations overlapped: max active = %d", provider.maxActive.Load())
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
	if os.Getenv("MOLTNET_RUN_NATIVE_KEYRING_TESTS") != "1" {
		t.Skip("set MOLTNET_RUN_NATIVE_KEYRING_TESTS=1 to use the native credential store")
	}
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

func TestResolveOAuth2SecretRejectsUnboundReference(t *testing.T) {
	registry, provider := newMemorySecretProviderRegistry()
	provider.values["oauth2/another-identity/another-client"] = "wrong-secret"
	creds := &CredentialsFile{
		IdentityID: "identity-123",
		OAuth2: CredentialsOAuth2{
			ClientID: "client-456",
			ClientSecretRef: &SecretReference{
				Provider: osKeyringProviderName,
				Key:      "oauth2/another-identity/another-client",
			},
		},
	}

	_, err := resolveOAuth2Secret(creds, registry)
	if err == nil || !strings.Contains(err.Error(), "not bound") {
		t.Fatalf("resolveOAuth2Secret error = %v, want binding rejection", err)
	}
}

func TestOAuth2SecretKeyIsStable(t *testing.T) {
	got := OAuth2SecretKey("identity-123", "client-456")
	if got != "oauth2/identity-123/client-456" {
		t.Fatalf("OAuth2SecretKey = %q", got)
	}
}

func TestWindowsKeyringTargetMatchesCrossRuntimeConformance(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "test-fixtures", "keyring-conformance.json"))
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

func TestResolveAgentOAuth2EnvironmentFromBoundKeyringReference(t *testing.T) {
	agentDir := t.TempDir()
	key := OAuth2SecretKey("identity-123", "client-456")
	config := &CredentialsFile{
		IdentityID: "identity-123",
		OAuth2: CredentialsOAuth2{
			ClientID: "client-456",
			ClientSecretRef: &SecretReference{
				Provider: osKeyringProviderName,
				Key:      key,
			},
		},
	}
	if _, err := WriteConfigTo(config, filepath.Join(agentDir, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, &memorySecretProvider{values: map[string]string{
		key: "launch-only-secret",
	}})

	vars, err := resolveAgentOAuth2Environment(agentDir, "my-agent", registry)
	if err != nil {
		t.Fatalf("resolveAgentOAuth2Environment: %v", err)
	}
	if vars["MY_AGENT_CLIENT_ID"] != "client-456" {
		t.Fatalf("client id = %q", vars["MY_AGENT_CLIENT_ID"])
	}
	if vars["MY_AGENT_CLIENT_SECRET"] != "launch-only-secret" {
		t.Fatalf("client secret was not resolved at launch")
	}
	if vars["MOLTNET_CLIENT_ID"] != "client-456" || vars["MOLTNET_CLIENT_SECRET"] != "launch-only-secret" {
		t.Fatalf("generic SDK credentials were not resolved at launch")
	}
	if vars["MOLTNET_CREDENTIALS_PATH"] != filepath.Join(agentDir, "moltnet.json") {
		t.Fatalf("credentials path = %q", vars["MOLTNET_CREDENTIALS_PATH"])
	}
}

func TestResolveAgentOAuth2EnvironmentRejectsUnboundReference(t *testing.T) {
	agentDir := t.TempDir()
	config := &CredentialsFile{
		IdentityID: "identity-123",
		OAuth2: CredentialsOAuth2{
			ClientID: "client-456",
			ClientSecretRef: &SecretReference{
				Provider: osKeyringProviderName,
				Key:      "oauth2/another-identity/another-client",
			},
		},
	}
	if _, err := WriteConfigTo(config, filepath.Join(agentDir, "moltnet.json")); err != nil {
		t.Fatal(err)
	}
	provider := &memorySecretProvider{values: map[string]string{
		"oauth2/another-identity/another-client": "canary-secret",
	}}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)

	_, err := resolveAgentOAuth2Environment(agentDir, "my-agent", registry)
	if err == nil || !strings.Contains(err.Error(), "not bound") {
		t.Fatalf("error = %v, want binding rejection", err)
	}
}
