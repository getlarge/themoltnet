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

// The resolution failure is the error every user hits on upgrade, so it must
// name the sources consulted and branch the remedy on whether the store is
// empty. Pointing an upgrading user at `config identity select` when they have
// no identities sends them to a command that also fails.
func TestNoActiveIdentityErrorBranchesOnStoreContents(t *testing.T) {
	isolateIdentityEnv(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	empty := noActiveIdentityError().Error()
	for _, want := range []string{
		"MOLTNET_ACTIVE_IDENTITY",
		"identity-selector.json",
		"config migrate --credentials",
		"moltnet register",
	} {
		if !strings.Contains(empty, want) {
			t.Errorf("empty-store error %q missing %q", empty, want)
		}
	}
	if strings.Contains(empty, "config identity select") {
		t.Errorf("empty store must not suggest selecting: %q", empty)
	}

	dir := filepath.Join(home, ".config", "moltnet", "identities", "existing")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "moltnet.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	populated := noActiveIdentityError().Error()
	if !strings.Contains(populated, "config identity select") ||
		!strings.Contains(populated, "existing") {
		t.Errorf("populated-store error %q must list aliases and suggest selecting", populated)
	}
}

// `config identity show` must never emit secret material. The allowlist shape
// matters more than any single field: a denylist leaks whatever secret field is
// added to CredentialsFile next, because its author has no reason to look here.
func TestRedactedIdentityDocumentEmitsOnlyPublicFields(t *testing.T) {
	creds := &CredentialsFile{
		IdentityID:   "id-1",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "client-id", ClientSecret: "SUPER-SECRET"},
		Keys:         CredentialsKeys{PublicKey: "pub", PrivateKey: "PRIVATE-SEED", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test"},
		SSH:          &SSHSection{PrivateKeyPath: "/home/a/.config/moltnet/identities/a/ssh/id_ed25519", PublicKeyPath: "/pub.pub"},
		GitHub:       &GitHubSection{AppID: "123", InstallationID: "456", PrivateKeyPath: "/secret.pem"},
	}

	document, err := redactedIdentityDocument(creds)
	if err != nil {
		t.Fatalf("redactedIdentityDocument: %v", err)
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	rendered := string(encoded)

	for _, secret := range []string{
		"SUPER-SECRET",
		"PRIVATE-SEED",
		"/secret.pem",
		"id_ed25519",
		"private_key",
	} {
		if strings.Contains(rendered, secret) {
			t.Errorf("redacted document leaks %q: %s", secret, rendered)
		}
	}
	for _, public := range []string{"client-id", "pub", "fp", "https://api.test", "123"} {
		if !strings.Contains(rendered, public) {
			t.Errorf("redacted document dropped public field %q: %s", public, rendered)
		}
	}
}

// Migrating a different identity onto an occupied alias must be refused: that
// guard is the only thing standing between a reused alias and overwriting
// another identity's credentials.
func TestMigrateLegacyIdentityStoreRejectsAliasCollisionAndIsIdempotent(t *testing.T) {
	isolateIdentityEnv(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeLegacy := func(dir, alias string) (string, string) {
		bundle := filepath.Join(dir, ".moltnet", "shared")
		if err := os.MkdirAll(bundle, 0o700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(bundle, "moltnet.json")
		identity := newIdentityFixture(t, alias, "https://"+alias+".example.test")
		creds := &CredentialsFile{
			IdentityID: identity.identityID,
			OAuth2:     CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: identity.clientID + "-secret"},
			Keys:       CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint},
			Endpoints:  CredentialsEndpoints{API: identity.api},
			Git:        &GitSection{Name: "Bot", Email: alias + "@example.test"},
		}
		if _, err := WriteConfigTo(creds, path); err != nil {
			t.Fatal(err)
		}
		return path, identity.identityID
	}

	first, firstID := writeLegacy(t.TempDir(), "one")
	if _, err := migrateLegacyIdentityStore(first, "", false); err != nil {
		t.Fatalf("first migration: %v", err)
	}

	// Re-running the same migration is a no-op success, not a failure.
	again, err := migrateLegacyIdentityStore(first, "", false)
	if err != nil {
		t.Fatalf("idempotent re-migration: %v", err)
	}
	if again == nil || again["changed"] != false {
		t.Fatalf("re-migration should report changed=false, got %v", again)
	}

	// A different identity claiming the same alias must be refused.
	second, _ := writeLegacy(t.TempDir(), "two")
	if _, err := migrateLegacyIdentityStore(second, "", false); err == nil {
		t.Fatal("expected alias collision to be rejected")
	}

	// The first identity's material must survive the rejected attempt.
	target, err := identityCredentialsPath("shared")
	if err != nil {
		t.Fatal(err)
	}
	surviving, err := ReadConfigFrom(target)
	if err != nil || surviving == nil {
		t.Fatalf("read surviving identity: %v", err)
	}
	if surviving.IdentityID != firstID {
		t.Fatalf("collision overwrote the existing identity: %s", surviving.IdentityID)
	}
}

// A dry run that reports success for a migration which will hard-fail on the
// real run is worse than no dry run at all.
func TestMigrateLegacyIdentityStoreDryRunReportsCollision(t *testing.T) {
	isolateIdentityEnv(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	seed := func(alias string) string {
		bundle := filepath.Join(t.TempDir(), ".moltnet", "shared")
		if err := os.MkdirAll(bundle, 0o700); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(bundle, "moltnet.json")
		identity := newIdentityFixture(t, alias, "https://"+alias+".example.test")
		if _, err := WriteConfigTo(&CredentialsFile{
			IdentityID: identity.identityID,
			OAuth2:     CredentialsOAuth2{ClientID: identity.clientID, ClientSecret: identity.clientID + "-secret"},
			Keys:       CredentialsKeys{PublicKey: identity.publicKey, PrivateKey: identity.seed, Fingerprint: identity.fingerprint},
			Endpoints:  CredentialsEndpoints{API: identity.api},
			Git:        &GitSection{Name: "Bot", Email: alias + "@example.test"},
		}, path); err != nil {
			t.Fatal(err)
		}
		return path
	}

	legacy := seed("one")
	if _, err := migrateLegacyIdentityStore(legacy, "", false); err != nil {
		t.Fatalf("seed migration: %v", err)
	}
	conflictingPath := seed("two")

	if _, err := migrateLegacyIdentityStore(conflictingPath, "", true); err == nil {
		t.Fatal("dry run must surface the collision instead of reporting success")
	}
}
