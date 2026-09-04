package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func centralIdentityFixture(alias string) *CredentialsFile {
	return &CredentialsFile{
		IdentityID: alias + "-identity",
		OAuth2:     CredentialsOAuth2{ClientID: alias + "-client"},
		Keys: CredentialsKeys{
			PublicKey: "ed25519:test", Fingerprint: alias + "-fingerprint",
		},
		Endpoints: CredentialsEndpoints{API: "https://" + alias + ".example.test"},
	}
}

func TestRedactedIdentityDocumentOmitsPlaintextSecrets(t *testing.T) {
	document, err := redactedIdentityDocument(&CredentialsFile{
		IdentityID: "identity",
		OAuth2:     CredentialsOAuth2{ClientID: "client", ClientSecret: "oauth-secret"},
		Keys:       CredentialsKeys{PublicKey: "public", PrivateKey: "seed-secret", Fingerprint: "fingerprint"},
		GitHub:     &GitHubSection{AppID: "app", PrivateKeyPath: "/private/key.pem"},
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"oauth-secret", "seed-secret", "/private/key.pem"} {
		if strings.Contains(string(data), secret) {
			t.Fatalf("redacted identity document revealed %q: %s", secret, data)
		}
	}
}

func TestCentralIdentityStoreSelectsWithoutRepositoryOrLegacyFallback(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "")
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(home, "repo", ".moltnet", "old", "gitconfig"))

	if _, err := writeCentralIdentityConfig("first", centralIdentityFixture("first")); err != nil {
		t.Fatal(err)
	}
	if _, err := writeCentralIdentityConfig("second", centralIdentityFixture("second")); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(home, ".config", "moltnet", "moltnet.json")
	if err := os.WriteFile(legacy, []byte(`{"identity_id":"legacy"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeIdentitySelector("second"); err != nil {
		t.Fatal(err)
	}

	got, err := resolveCredentialsPath("")
	if err != nil {
		t.Fatal(err)
	}
	want, _ := identityCredentialsPath("second")
	if got != want {
		t.Fatalf("resolved path = %q, want %q", got, want)
	}

	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "first")
	got, err = resolveCredentialsPath("")
	if err != nil {
		t.Fatal(err)
	}
	want, _ = identityCredentialsPath("first")
	if got != want {
		t.Fatalf("active identity path = %q, want %q", got, want)
	}
}

func TestCentralIdentityStorePreservesExistingDefault(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if _, err := writeCentralIdentityConfig("first", centralIdentityFixture("first")); err != nil {
		t.Fatal(err)
	}
	if _, err := writeCentralIdentityConfig("second", centralIdentityFixture("second")); err != nil {
		t.Fatal(err)
	}
	selector, err := readIdentitySelector()
	if err != nil {
		t.Fatal(err)
	}
	if selector == nil || selector.DefaultIdentity != "first" {
		t.Fatalf("default = %#v, want first", selector)
	}
}

func TestCentralIdentityStoreRejectsInvalidAliases(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	for _, alias := range []string{"", "../escape", "contains space"} {
		if _, err := identityCredentialsPath(alias); err == nil {
			t.Errorf("identityCredentialsPath(%q) succeeded", alias)
		}
	}
}
