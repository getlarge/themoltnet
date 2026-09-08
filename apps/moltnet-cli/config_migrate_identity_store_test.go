package main

import (
	"bytes"
	"io"
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
	legacy := legacyCredentialsForTest(identity.identityID)
	legacy.OAuth2 = CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: identity.clientID + "-secret"}
	legacy.Keys = CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint}
	legacy.Endpoints = CredentialsEndpoints{API: identity.api}
	legacy.Git = &GitSection{Name: "Legacy Bot", Email: "legacy@example.test"}
	if _, err := WriteConfigTo(legacy, legacyPath); err != nil {
		t.Fatal(err)
	}
	addLegacyIdentityToConfigFile(t, legacyPath, identity.identityID)
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
	if copied, err := ReadConfigFrom(target); err != nil || copied.legacyIdentityID != identity.identityID {
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

func TestMigrateIdentityStoreKeepsStagingPathsOutOfOutput(t *testing.T) {
	// Arrange: relocation configures Git inside a staging directory named
	// .<alias>-<random>, then renames it into place. That name leaked into the
	// operator-facing summary, presenting a path that stops existing moments
	// later as though it were their identity.
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	bundle := filepath.Join(dir, "repo", ".moltnet", "legreffier")
	if err := os.MkdirAll(bundle, 0o700); err != nil {
		t.Fatal(err)
	}
	credsPath := filepath.Join(bundle, "moltnet.json")
	if _, err := WriteConfigTo(&CredentialsFile{
		IdentityID: "11111111-1111-4111-8111-111111111111",
		OAuth2:     CredentialsOAuth2{ClientID: "cid", ClientSecret: "secret"},
		Keys: CredentialsKeys{
			PublicKey:   testPublicKey,
			PrivateKey:  testPrivateKey,
			Fingerprint: "SHA256:stagingfingerprint",
		},
		Endpoints: CredentialsEndpoints{API: "https://api.example.test"},
	}, credsPath); err != nil {
		t.Fatal(err)
	}

	// Act, capturing the process stderr: the leak was in what migration
	// *printed*, not in what it wrote to disk, so asserting on files alone
	// would not have caught it.
	realStderr := os.Stderr
	r, w, pipeErr := os.Pipe()
	if pipeErr != nil {
		t.Fatal(pipeErr)
	}
	os.Stderr = w
	captured := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		captured <- buf.String()
	}()
	migrated, err := migrateLegacyIdentityStore(credsPath, "", false)
	os.Stderr = realStderr
	_ = w.Close()
	printed := <-captured
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if strings.Contains(printed, ".legreffier-") {
		t.Fatalf("staging directory surfaced in operator output:\n%s", printed)
	}

	// Assert: the published destination is the real alias directory, and no
	// staging name survives anywhere in the reported result.
	dest, _ := migrated["destination"].(string)
	if !strings.Contains(dest, filepath.Join("identities", "legreffier")) {
		t.Fatalf("destination = %q, want the alias directory", dest)
	}
	if strings.Contains(dest, ".legreffier-") {
		t.Fatalf("staging directory leaked into the destination: %q", dest)
	}
	for _, path := range []string{
		filepath.Join(dir, ".config", "moltnet", "identities", "legreffier", "gitconfig"),
		filepath.Join(dir, ".config", "moltnet", "identities", "legreffier", "env"),
	} {
		body, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read %s: %v", path, readErr)
		}
		if strings.Contains(string(body), ".legreffier-") {
			t.Fatalf("%s references the staging directory:\n%s", path, body)
		}
	}
}
