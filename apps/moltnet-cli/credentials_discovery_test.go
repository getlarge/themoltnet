package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The tests in this file pin the central identity-store boundary: every
// consumer resolves one canonical path via explicit path → process override →
// active identity → persisted default. Repository, Git, and legacy-global
// documents are deliberately distinct and must never be discovered.

type identityFixture struct {
	identityID  string
	clientID    string
	fingerprint string
	api         string
	seed        string
	publicKey   string
}

func newIdentityFixture(t *testing.T, name, api string) identityFixture {
	t.Helper()
	seed, publicKey := testSeedAndPublicKey(t)
	return identityFixture{
		identityID:  name + "-identity",
		clientID:    name + "-client",
		fingerprint: name + "-fingerprint",
		api:         api,
		seed:        seed,
		publicKey:   publicKey,
	}
}

// writeIdentityConfig writes a credentials file for the fixture at path and
// returns path, creating parent directories as needed.
func writeIdentityConfig(t *testing.T, path string, fixture identityFixture) string {
	t.Helper()
	creds := CredentialsFile{
		IdentityID: fixture.identityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     fixture.clientID,
			ClientSecret: fixture.clientID + "-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   fixture.publicKey,
			PrivateKey:  fixture.seed,
			Fingerprint: fixture.fingerprint,
		},
		Endpoints: CredentialsEndpoints{API: fixture.api},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal credentials: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// discoveryFixtures lays out a global config plus the two activated configs the
// precedence ladder can select, and clears every inherited MoltNet env var so a
// developer's own activated shell cannot leak into the test.
type discoveryFixtures struct {
	explicitPath string
	envPath      string
	activePath   string
	defaultPath  string
	legacyPath   string

	explicit identityFixture
	env      identityFixture
	active   identityFixture
	default_ identityFixture
}

func newDiscoveryFixtures(t *testing.T) *discoveryFixtures {
	t.Helper()
	home := t.TempDir()
	f := &discoveryFixtures{
		explicitPath: filepath.Join(home, "explicit", "moltnet.json"),
		envPath:      filepath.Join(home, "env", "moltnet.json"),
		activePath:   filepath.Join(home, ".config", "moltnet", "identities", "active", "moltnet.json"),
		defaultPath:  filepath.Join(home, ".config", "moltnet", "identities", "default", "moltnet.json"),
		legacyPath:   filepath.Join(home, ".config", "moltnet", "moltnet.json"),

		explicit: newIdentityFixture(t, "explicit", "https://explicit.example.com"),
		env:      newIdentityFixture(t, "env", "https://env.example.com"),
		active:   newIdentityFixture(t, "active", "https://active.example.com"),
		default_: newIdentityFixture(t, "default", "https://default.example.com"),
	}

	t.Setenv("HOME", home)
	writeIdentityConfig(t, f.explicitPath, f.explicit)
	writeIdentityConfig(t, f.envPath, f.env)
	writeIdentityConfig(t, f.activePath, f.active)
	writeIdentityConfig(t, f.defaultPath, f.default_)
	writeIdentityConfig(t, f.legacyPath, newIdentityFixture(t, "legacy", "https://legacy.example.com"))
	if err := writeIdentitySelector("default"); err != nil {
		t.Fatalf("write identity selector: %v", err)
	}

	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("MOLTNET_ACTIVE_IDENTITY", "")
	t.Setenv("GIT_CONFIG_GLOBAL", "")
	t.Setenv(apiURLEnv, "")
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	t.Setenv(signerURLEnv, "")
	return f
}

// apply sets the env vars for one rung of the precedence ladder and returns the
// explicit --credentials value for that rung.
func (f *discoveryFixtures) apply(t *testing.T, rung string) string {
	t.Helper()
	switch rung {
	case "explicit":
		t.Setenv("MOLTNET_CREDENTIALS_PATH", f.envPath)
		t.Setenv("MOLTNET_ACTIVE_IDENTITY", "active")
		return f.explicitPath
	case "env":
		t.Setenv("MOLTNET_CREDENTIALS_PATH", f.envPath)
		t.Setenv("MOLTNET_ACTIVE_IDENTITY", "active")
		return ""
	case "active":
		t.Setenv("MOLTNET_ACTIVE_IDENTITY", "active")
		return ""
	case "default":
		return ""
	default:
		t.Fatalf("unknown rung %q", rung)
		return ""
	}
}

func TestLoadCredentialsAutoDiscoveryPrecedence(t *testing.T) {
	cases := []struct {
		rung string
		want func(*discoveryFixtures) identityFixture
	}{
		{"explicit", func(f *discoveryFixtures) identityFixture { return f.explicit }},
		{"env", func(f *discoveryFixtures) identityFixture { return f.env }},
		{"active", func(f *discoveryFixtures) identityFixture { return f.active }},
		{"default", func(f *discoveryFixtures) identityFixture { return f.default_ }},
	}

	for _, tc := range cases {
		t.Run(tc.rung, func(t *testing.T) {
			f := newDiscoveryFixtures(t)
			credPath := f.apply(t, tc.rung)
			want := tc.want(f)

			creds, err := loadCredentials(credPath)
			if err != nil {
				t.Fatalf("loadCredentials(%q): %v", credPath, err)
			}
			if creds.IdentityID != want.identityID {
				t.Errorf(
					"loadCredentials loaded identity %q, want %q",
					creds.IdentityID,
					want.identityID,
				)
			}
		})
	}
}

func TestResolveAPIURLAutoDiscoveryPrecedence(t *testing.T) {
	cases := []struct {
		rung string
		want func(*discoveryFixtures) identityFixture
	}{
		{"explicit", func(f *discoveryFixtures) identityFixture { return f.explicit }},
		{"env", func(f *discoveryFixtures) identityFixture { return f.env }},
		{"active", func(f *discoveryFixtures) identityFixture { return f.active }},
		{"default", func(f *discoveryFixtures) identityFixture { return f.default_ }},
	}

	for _, tc := range cases {
		t.Run(tc.rung, func(t *testing.T) {
			f := newDiscoveryFixtures(t)
			credPath := f.apply(t, tc.rung)
			want := tc.want(f)

			cmd := newCmdWithAPIFlag(t)
			if got := resolveAPIURL(cmd, credPath); got != want.api {
				t.Errorf("resolveAPIURL = %q, want %q", got, want.api)
			}
		})
	}
}

func TestResolveSignerUsesActivatedIdentityWithoutExplicitFlag(t *testing.T) {
	f := newDiscoveryFixtures(t)
	f.apply(t, "active")

	signer, err := resolveSigner("")
	if err != nil {
		t.Fatalf("resolveSigner: %v", err)
	}
	identity, err := signer.Identity(t.Context())
	if err != nil {
		t.Fatalf("signer identity: %v", err)
	}
	if identity.Fingerprint != f.active.fingerprint {
		t.Errorf(
			"signer fingerprint = %q, want activated %q",
			identity.Fingerprint,
			f.active.fingerprint,
		)
	}
}

func TestLoadCredentialsFailsClosedWhenActivatedPathMissing(t *testing.T) {
	newDiscoveryFixtures(t)
	missing := filepath.Join(t.TempDir(), "absent", "moltnet.json")
	t.Setenv("MOLTNET_CREDENTIALS_PATH", missing)

	creds, err := loadCredentials("")
	if err == nil {
		t.Fatalf(
			"loadCredentials fell back to identity %q; want an error",
			creds.IdentityID,
		)
	}
	if strings.Contains(err.Error(), "legacy") {
		t.Errorf("error leaked legacy identity: %v", err)
	}
}

func TestLoadCredentialsFailsClosedWhenActivatedPathUnreadable(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses file permissions")
	}
	f := newDiscoveryFixtures(t)
	f.apply(t, "env")
	if err := os.Chmod(f.envPath, 0o000); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(f.envPath, 0o600) })

	creds, err := loadCredentials("")
	if err == nil {
		t.Fatalf(
			"loadCredentials fell back to identity %q; want an error",
			creds.IdentityID,
		)
	}
}
