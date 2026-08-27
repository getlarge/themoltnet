package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testSeedAndPublicKey(t *testing.T) (string, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(priv.Seed()), "ed25519:" + base64.StdEncoding.EncodeToString(pub)
}

func TestExpectedSecretKeyAndBinding(t *testing.T) {
	t.Parallel()
	key, err := expectedSecretKey(credentialIdentitySeed, credentialBindingIDs{Fingerprint: "fp"})
	if err != nil || key != "identity/fp/seed" {
		t.Fatalf("expectedSecretKey = %q, %v", key, err)
	}
	if _, err := expectedSecretKey(credentialIdentitySeed, credentialBindingIDs{}); err == nil {
		t.Fatal("expected missing fingerprint error")
	}
	ids := credentialBindingIDs{Fingerprint: "fp"}
	accept := []SecretReference{
		{Provider: "os-keyring", Key: "identity/fp/seed"},
		{Provider: "env", Key: "MOLTNET_PRIVATE_KEY"},
		{Provider: "file", Key: "identity/fp/seed"},
		{Provider: "file", Key: "identity.fp.seed"},
	}
	for _, ref := range accept {
		if err := validateSecretReferenceBinding(credentialIdentitySeed, ref, ids); err != nil {
			t.Errorf("validateSecretReferenceBinding(%+v) = %v, want nil", ref, err)
		}
	}
	reject := []SecretReference{
		{Provider: "os-keyring", Key: "identity/other/seed"},
		{Provider: "env", Key: "MOLTNET_CLIENT_SECRET"},
		{Provider: "os-keyring", Key: "identity.fp.seed"},
	}
	for _, ref := range reject {
		if err := validateSecretReferenceBinding(credentialIdentitySeed, ref, ids); err == nil {
			t.Errorf("validateSecretReferenceBinding(%+v) = nil, want error", ref)
		}
	}
}

func TestResolveIdentitySeedFromBoundReference(t *testing.T) {
	seed, pub := testSeedAndPublicKey(t)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values["identity/fp/seed"] = seed
	creds := &CredentialsFile{Keys: CredentialsKeys{PublicKey: pub, Fingerprint: "fp",
		PrivateKeyRef: &SecretReference{Provider: osKeyringProviderName, Key: "identity/fp/seed"}}}

	got, err := resolveIdentitySeed(creds, registry)
	if err != nil || got != seed {
		t.Fatalf("resolveIdentitySeed = %q, %v", got, err)
	}
}

func TestResolveIdentitySeedLegacyWarnsOnce(t *testing.T) {
	seed, pub := testSeedAndPublicKey(t)
	resetLegacyCredentialWarnings()
	var out strings.Builder
	legacyCredentialWarningWriter = &out
	t.Cleanup(func() { legacyCredentialWarningWriter = nil; resetLegacyCredentialWarnings() })
	creds := &CredentialsFile{Keys: CredentialsKeys{PublicKey: pub, Fingerprint: "fp", PrivateKey: seed}}
	registry, _ := newMemorySecretProviderRegistry()

	for i := 0; i < 2; i++ {
		if got, err := resolveIdentitySeed(creds, registry); err != nil || got != seed {
			t.Fatalf("resolveIdentitySeed = %q, %v", got, err)
		}
	}
	if n := strings.Count(out.String(), "keys.private_key"); n != 1 {
		t.Fatalf("warning count = %d, want 1: %q", n, out.String())
	}
	if strings.Contains(out.String(), seed) {
		t.Fatal("warning leaked the seed")
	}
}

func TestResolveIdentitySeedRejectsAmbiguousMissingUnboundAndMismatch(t *testing.T) {
	seed, pub := testSeedAndPublicKey(t)
	otherSeed, _ := testSeedAndPublicKey(t)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values["identity/fp/seed"] = otherSeed
	provider.values["identity/x/seed"] = seed
	cases := map[string]CredentialsKeys{
		"ambiguous": {PublicKey: pub, Fingerprint: "fp", PrivateKey: seed, PrivateKeyRef: &SecretReference{Provider: osKeyringProviderName, Key: "identity/fp/seed"}},
		"missing":   {PublicKey: pub, Fingerprint: "fp"},
		"unbound":   {PublicKey: pub, Fingerprint: "fp", PrivateKeyRef: &SecretReference{Provider: osKeyringProviderName, Key: "identity/x/seed"}},
		"mismatch":  {PublicKey: pub, Fingerprint: "fp", PrivateKeyRef: &SecretReference{Provider: osKeyringProviderName, Key: "identity/fp/seed"}},
		"malformed": {PublicKey: pub, Fingerprint: "fp", PrivateKey: "not-base64!"},
	}
	for name, keys := range cases {
		_, err := resolveIdentitySeed(&CredentialsFile{Keys: keys}, registry)
		if err == nil {
			t.Errorf("%s: expected error", name)
			continue
		}
		if strings.Contains(err.Error(), seed) || strings.Contains(err.Error(), otherSeed) {
			t.Errorf("%s: error leaked a seed: %v", name, err)
		}
	}
	var resolutionErr *CredentialResolutionError
	_, err := resolveIdentitySeed(&CredentialsFile{Keys: cases["unbound"]}, registry)
	if !errors.As(err, &resolutionErr) || resolutionErr.Code != "unbound" {
		t.Fatalf("unbound error = %v", err)
	}
}

type failingSecretProvider struct{}

func (failingSecretProvider) Get(string) (string, error) {
	return "", errors.New("backend said: leaked-canary")
}
func (failingSecretProvider) Set(string, string) error { return nil }
func (failingSecretProvider) Delete(string) error      { return nil }

func TestResolveIdentitySeedNormalizesProviderFailures(t *testing.T) {
	_, pub := testSeedAndPublicKey(t)
	registry := NewSecretProviderRegistry()
	registry.Register("failing", failingSecretProvider{})
	creds := &CredentialsFile{Keys: CredentialsKeys{PublicKey: pub, Fingerprint: "fp",
		PrivateKeyRef: &SecretReference{Provider: "failing", Key: "identity/fp/seed"}}}

	_, err := resolveIdentitySeed(creds, registry)
	var resolutionErr *CredentialResolutionError
	if !errors.As(err, &resolutionErr) || resolutionErr.Code != "provider_failure" {
		t.Fatalf("error = %v, want provider_failure", err)
	}
	if strings.Contains(err.Error(), "leaked-canary") {
		t.Fatalf("error leaked the provider message: %v", err)
	}
	if !strings.Contains(errors.Unwrap(err).Error(), "leaked-canary") {
		t.Fatal("cause was not retained")
	}
}

func testRSAPrivateKeyPEM(t *testing.T) []byte {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
}

func TestResolveGitHubAppPrivateKeyFromBoundReference(t *testing.T) {
	pemData := testRSAPrivateKeyPEM(t)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values["github-app/123/private-key"] = string(pemData)
	creds := &CredentialsFile{GitHub: &GitHubSection{AppID: "123", InstallationID: "456",
		PrivateKeyRef: &SecretReference{Provider: osKeyringProviderName, Key: "github-app/123/private-key"}}}

	got, err := resolveGitHubAppPrivateKey(creds, registry)
	if err != nil || string(got) != string(pemData) {
		t.Fatalf("resolveGitHubAppPrivateKey error = %v", err)
	}
}

func TestResolveGitHubAppPrivateKeyLegacyPathWarnsOnce(t *testing.T) {
	pemData := testRSAPrivateKeyPEM(t)
	path := filepath.Join(t.TempDir(), "app.pem")
	if err := os.WriteFile(path, pemData, 0o600); err != nil {
		t.Fatal(err)
	}
	resetLegacyCredentialWarnings()
	var out strings.Builder
	legacyCredentialWarningWriter = &out
	t.Cleanup(func() { legacyCredentialWarningWriter = nil; resetLegacyCredentialWarnings() })
	creds := &CredentialsFile{GitHub: &GitHubSection{AppID: "123", InstallationID: "456", PrivateKeyPath: path}}
	registry, _ := newMemorySecretProviderRegistry()

	for i := 0; i < 2; i++ {
		if got, err := resolveGitHubAppPrivateKey(creds, registry); err != nil || string(got) != string(pemData) {
			t.Fatalf("resolveGitHubAppPrivateKey error = %v", err)
		}
	}
	if n := strings.Count(out.String(), "github.private_key_path"); n != 1 {
		t.Fatalf("warning count = %d, want 1: %q", n, out.String())
	}
}

func TestResolveGitHubAppPrivateKeyRejectsInvalidUnboundAndMissing(t *testing.T) {
	registry, provider := newMemorySecretProviderRegistry()
	provider.values["github-app/123/private-key"] = "not-a-pem-canary"
	provider.values["github-app/999/private-key"] = string(testRSAPrivateKeyPEM(t))
	ref := func(key string) *SecretReference { return &SecretReference{Provider: osKeyringProviderName, Key: key} }
	cases := map[string]struct {
		github *GitHubSection
		code   string
	}{
		"missing section": {nil, "missing"},
		"invalid":         {&GitHubSection{AppID: "123", PrivateKeyRef: ref("github-app/123/private-key")}, "invalid_value"},
		"unbound":         {&GitHubSection{AppID: "123", PrivateKeyRef: ref("github-app/999/private-key")}, "unbound"},
		"ambiguous":       {&GitHubSection{AppID: "123", PrivateKeyPath: "/x.pem", PrivateKeyRef: ref("github-app/123/private-key")}, "ambiguous"},
		"neither":         {&GitHubSection{AppID: "123"}, "missing"},
	}
	for name, tc := range cases {
		_, err := resolveGitHubAppPrivateKey(&CredentialsFile{GitHub: tc.github}, registry)
		var resolutionErr *CredentialResolutionError
		if !errors.As(err, &resolutionErr) || resolutionErr.Code != tc.code {
			t.Errorf("%s: error = %v, want code %s", name, err, tc.code)
		}
		if err != nil && strings.Contains(err.Error(), "canary") {
			t.Errorf("%s: error leaked the value: %v", name, err)
		}
	}
}
