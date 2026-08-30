package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func TestGitHubAppPrivateKeyBindingAcceptsEnvAndFlattenedForms(t *testing.T) {
	binding, err := githubAppPrivateKeyBinding("123")
	if err != nil {
		t.Fatal(err)
	}
	for _, ref := range []SecretReference{
		{Provider: osKeyringProviderName, Key: "github-app/123/private-key"},
		{Provider: environmentProviderName, Key: githubAppPrivateKeyEnvKey},
		{Provider: fileProviderName, Key: "github-app.123.private-key"},
	} {
		if err := validateSecretReferenceBoundTo(ref, binding); err != nil {
			t.Errorf("%+v: %v", ref, err)
		}
	}
	for _, ref := range []SecretReference{
		{Provider: osKeyringProviderName, Key: "github-app/999/private-key"},
		{Provider: environmentProviderName, Key: "OTHER"},
		{Provider: fileProviderName, Key: "github-app/999/private-key"},
	} {
		if err := validateSecretReferenceBoundTo(ref, binding); err == nil || !strings.Contains(err.Error(), "not bound") {
			t.Errorf("%+v: expected not-bound error, got %v", ref, err)
		}
	}
	if _, err := githubAppPrivateKeyBinding(" "); err == nil {
		t.Fatal("empty app id must be rejected")
	}
}
