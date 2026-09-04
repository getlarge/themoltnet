package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyIdentityStoreInfersAliasAndPreservesDefault(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if _, err := writeCentralIdentityConfig("current", centralIdentityFixture("current")); err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(home, "repo", ".moltnet", "legacy", "moltnet.json")
	identity := newIdentityFixture(t, "legacy", "https://legacy.example.test")
	legacy := &CredentialsFile{
		IdentityID: identity.identityID,
		OAuth2:     CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: identity.clientID + "-secret"},
		Keys:       CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint},
		Endpoints:  CredentialsEndpoints{API: identity.api},
		Git:        &GitSection{Name: "Legacy Bot", Email: "legacy@example.test"},
	}
	if _, err := WriteConfigTo(legacy, legacyPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(legacyPath), "env"), []byte("CUSTOM_VALUE='kept'\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := migrateLegacyIdentityStore(legacyPath, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if result["alias"] != "legacy" || result["changed"] != true {
		t.Fatalf("migration result = %#v", result)
	}
	target, _ := identityCredentialsPath("legacy")
	if copied, err := ReadConfigFrom(target); err != nil || copied.IdentityID != legacy.IdentityID {
		t.Fatalf("copied config = %#v, %v", copied, err)
	} else {
		if copied.SSH == nil || filepath.Dir(copied.SSH.PublicKeyPath) != filepath.Join(filepath.Dir(target), "ssh") {
			t.Fatalf("SSH was not regenerated centrally: %#v", copied.SSH)
		}
		if copied.Git == nil || copied.Git.ConfigPath != filepath.Join(filepath.Dir(target), "gitconfig") {
			t.Fatalf("Git config was not regenerated centrally: %#v", copied.Git)
		}
	}
	if env, err := os.ReadFile(filepath.Join(filepath.Dir(target), "env")); err != nil || string(env) != "CUSTOM_VALUE='kept'\n" {
		t.Fatalf("copied env = %q, %v", env, err)
	}
	selector, err := readIdentitySelector()
	if err != nil || selector.DefaultIdentity != "current" {
		t.Fatalf("selector = %#v, %v", selector, err)
	}
}

func TestMigrateLegacyIdentityStoreRequiresNameOutsideLegacyLayout(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	path := filepath.Join(t.TempDir(), "credentials.json")
	if _, err := WriteConfigTo(centralIdentityFixture("external"), path); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateLegacyIdentityStore(path, "", true); err == nil {
		t.Fatal("migration without --name unexpectedly succeeded")
	}
	result, err := migrateLegacyIdentityStore(path, "external", true)
	if err != nil || result["alias"] != "external" {
		t.Fatalf("named migration = %#v, %v", result, err)
	}
}

func TestMigrateLegacyIdentityStoreRejectsIncompleteOnboarding(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	legacyDir := filepath.Join(t.TempDir(), ".moltnet", "pending")
	path := filepath.Join(legacyDir, "moltnet.json")
	if _, err := WriteConfigTo(centralIdentityFixture("pending"), path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacyDir, agentsInitStateFile), []byte(`{"workflowId":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateLegacyIdentityStore(path, "", false); err == nil {
		t.Fatal("incomplete onboarding unexpectedly migrated")
	}
}
