package main

import (
	"os"
	"path/filepath"
	"strings"
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
	if err := os.WriteFile(filepath.Join(filepath.Dir(legacyPath), "env"), []byte("GIT_CONFIG_GLOBAL='/old/repository/gitconfig'\nCUSTOM_VALUE='kept'\n"), 0o600); err != nil {
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
	if env, err := os.ReadFile(filepath.Join(filepath.Dir(target), "env")); err != nil {
		t.Fatalf("read migrated env: %v", err)
	} else if got := string(env); !strings.Contains(got, "CUSTOM_VALUE='kept'") || strings.Contains(got, "/old/repository") || !strings.Contains(got, "MOLTNET_ACTIVE_IDENTITY='legacy'") {
		t.Fatalf("migrated env = %q", got)
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

func TestMigrateLegacyIdentityStoreInfersAliasFromDaemonAgentDocument(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyPath := filepath.Join(home, ".config", "moltnet", "agents", "daemon-agent.json")
	identity := newIdentityFixture(t, "daemon-agent", "https://daemon.example.test")
	legacy := &CredentialsFile{
		IdentityID: identity.identityID,
		OAuth2:     CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: "daemon-secret"},
		Keys:       CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint},
		Endpoints:  CredentialsEndpoints{API: identity.api},
	}
	if _, err := WriteConfigTo(legacy, legacyPath); err != nil {
		t.Fatal(err)
	}

	result, err := migrateLegacyIdentityStore(legacyPath, "", false)
	if err != nil {
		t.Fatal(err)
	}
	if result["alias"] != "daemon-agent" {
		t.Fatalf("migration result = %#v", result)
	}
	target, err := identityCredentialsPath("daemon-agent")
	if err != nil {
		t.Fatal(err)
	}
	if copied, err := ReadConfigFrom(target); err != nil || copied == nil || copied.IdentityID != legacy.IdentityID {
		t.Fatalf("migrated daemon document = %#v, %v", copied, err)
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

func TestMigrateLegacyIdentityStoreLeavesNoPartialIdentityOnRegenerationFailure(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	legacyDir := filepath.Join(home, "repo", ".moltnet", "broken")
	legacyPath := filepath.Join(legacyDir, "moltnet.json")
	broken := centralIdentityFixture("broken")
	broken.Keys.PublicKey = "not-an-ed25519-public-key"
	if _, err := WriteConfigTo(broken, legacyPath); err != nil {
		t.Fatal(err)
	}

	if _, err := migrateLegacyIdentityStore(legacyPath, "", false); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	target, err := identityDir("broken")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("partial central identity remains at %s: %v", target, err)
	}
}
