package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	copyFixtureSubject = "00000000-0000-4000-8000-00000000c0de"
	copyFixtureClient  = "copy-client"
	copyFixtureFinger  = "COPY-FING-ERPR-INT0"
	copyFixtureAppID   = "4242"
	copyFixtureTeamA   = "00000000-0000-4000-8000-0000000000a1"
	copyFixtureTeamB   = "00000000-0000-4000-8000-0000000000b2"
)

// copyFixture is a reference-backed identity document whose four credential
// kinds all resolve from the "os-keyring" provider, backed here by memory.
type copyFixture struct {
	credentialsPath string
	keyring         *memorySecretProvider
	fileRoot        string
	registry        *SecretProviderRegistry
	values          map[credentialKind]string
}

func newCopyFixture(t *testing.T) *copyFixture {
	t.Helper()
	seed, publicKey := testSeedAndPublicKey(t)
	pem := string(testRSAPrivateKeyPEM(t))
	if !strings.HasSuffix(pem, "\n") {
		pem += "\n"
	}
	dir := t.TempDir()
	fixture := &copyFixture{
		credentialsPath: filepath.Join(dir, "moltnet.json"),
		keyring:         &memorySecretProvider{values: map[string]string{}},
		fileRoot:        t.TempDir(),
		values: map[credentialKind]string{
			credentialOAuth2ClientSecret: "canary-oauth-secret",
			credentialIdentitySeed:       seed,
			// Deliberately newline-terminated: the file provider strips one
			// trailing newline on read, so the copy must store the stripped form.
			credentialGitHubAppPrivateKey: pem,
			credentialAgentKey:            "canary-agent-key-a",
		},
	}
	fixture.keyring.values[OAuth2SecretKey(copyFixtureSubject, copyFixtureClient)] = fixture.values[credentialOAuth2ClientSecret]
	fixture.keyring.values[IdentitySeedKey(copyFixtureFinger)] = seed
	fixture.keyring.values[GitHubAppPrivateKeyKey(copyFixtureAppID)] = pem
	fixture.keyring.values[TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamA)] = fixture.values[credentialAgentKey]

	fixture.registry = NewSecretProviderRegistry()
	fixture.registry.Register(osKeyringProviderName, fixture.keyring)
	fixture.registry.Register(fileProviderName, FileSecretProvider{Root: fixture.fileRoot, Writable: true})

	keyring := func(key string) map[string]string {
		return map[string]string{"provider": osKeyringProviderName, "key": key}
	}
	document := map[string]any{
		"subject_id":   copyFixtureSubject,
		"subject_type": "agent",
		"agent_key_refs": map[string]any{
			copyFixtureTeamA: keyring(TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamA)),
		},
		"oauth2": map[string]any{
			"client_id":         copyFixtureClient,
			"client_secret_ref": keyring(OAuth2SecretKey(copyFixtureSubject, copyFixtureClient)),
		},
		"keys": map[string]any{
			"public_key":      publicKey,
			"fingerprint":     copyFixtureFinger,
			"private_key_ref": keyring(IdentitySeedKey(copyFixtureFinger)),
			"extra":           "kept",
		},
		"github": map[string]any{
			"app_id":          copyFixtureAppID,
			"installation_id": "1",
			"private_key_ref": keyring(GitHubAppPrivateKeyKey(copyFixtureAppID)),
		},
		"endpoints":         map[string]any{"api": "https://api.themolt.net", "mcp": "https://mcp.themolt.net/mcp"},
		"registered_at":     "2026-01-01T00:00:00Z",
		"unknown_top_level": true,
	}
	fixture.writeDocument(t, document)
	return fixture
}

func (f *copyFixture) writeDocument(t *testing.T, document map[string]any) {
	t.Helper()
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.credentialsPath, append(data, '\n'), privateFileMode); err != nil {
		t.Fatal(err)
	}
}

func (f *copyFixture) editDocument(t *testing.T, edit func(document map[string]any)) {
	t.Helper()
	data, err := os.ReadFile(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	edit(document)
	f.writeDocument(t, document)
}

func (f *copyFixture) opts(kind credentialKind, destination string) credentialCopyOpts {
	return credentialCopyOpts{
		credentialsPath: f.credentialsPath,
		kind:            kind,
		destination:     destination,
		providers:       f.registry,
	}
}

func (f *copyFixture) readCredentials(t *testing.T) *CredentialsFile {
	t.Helper()
	creds, err := ReadConfigFrom(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	return creds
}

func (f *copyFixture) credentialsBytes(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func activeReference(creds *CredentialsFile, kind credentialKind) *SecretReference {
	switch kind {
	case credentialOAuth2ClientSecret:
		return creds.OAuth2.ClientSecretRef
	case credentialIdentitySeed:
		return creds.Keys.PrivateKeyRef
	case credentialGitHubAppPrivateKey:
		return creds.GitHub.PrivateKeyRef
	case credentialAgentKey:
		ref := creds.AgentKeyRefs[copyFixtureTeamA]
		return &ref
	}
	return nil
}

func canonicalCopyKey(t *testing.T, kind credentialKind) string {
	t.Helper()
	key, err := expectedSecretKey(kind, credentialBindingIDs{
		SubjectID:   copyFixtureSubject,
		ClientID:    copyFixtureClient,
		Fingerprint: copyFixtureFinger,
		AppID:       copyFixtureAppID,
		TeamID:      copyFixtureTeamA,
	})
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func assertNoSecretLeak(t *testing.T, fixture *copyFixture, streams ...string) {
	t.Helper()
	for _, stream := range streams {
		for kind, value := range fixture.values {
			needle := strings.TrimSpace(value)
			if kind == credentialGitHubAppPrivateKey {
				needle = "PRIVATE KEY-----\n" // any PEM body fragment
			}
			if strings.Contains(stream, needle) {
				t.Fatalf("%s value leaked into output:\n%s", kind, stream)
			}
		}
	}
}

func TestConfigCredentialsCopyRoundTripsEveryKindThroughFileProvider(t *testing.T) {
	for _, kind := range credentialCopyKinds {
		t.Run(string(kind), func(t *testing.T) {
			fixture := newCopyFixture(t)
			key := canonicalCopyKey(t, kind)
			var out, errOut bytes.Buffer

			// keyring -> file (copy): config switches, source stays.
			if err := runConfigCredentialsCopyCmd(&out, &errOut, fixture.opts(kind, fileProviderName)); err != nil {
				t.Fatalf("copy to file: %v", err)
			}
			if ref := activeReference(fixture.readCredentials(t), kind); ref == nil || *ref != (SecretReference{Provider: fileProviderName, Key: key}) {
				t.Fatalf("config reference after copy = %+v", ref)
			}
			want := fixture.values[kind]
			if kind == credentialGitHubAppPrivateKey {
				// The PEM reader parses the key, so the trailing newline the
				// file provider strips is not part of the credential.
				want = stripOneNewline(want)
			}
			stored, err := fixture.registry.Resolve(SecretReference{Provider: fileProviderName, Key: key})
			if err != nil || stored != want {
				t.Fatalf("file provider holds %q (%v), want the source value", stored, err)
			}
			if fixture.keyring.values[key] == "" {
				t.Fatal("copy deleted the source secret")
			}
			var result credentialCopyOutput
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatalf("parse output: %v\n%s", err, out.String())
			}
			if !result.SecretWritten || !result.CredentialsUpdated {
				t.Fatalf("unexpected copy result: %+v", result)
			}

			// file -> keyring: the keyring still holds a value its reader
			// treats identically, so nothing is written; the file copy stays.
			out.Reset()
			if err := runConfigCredentialsCopyCmd(&out, &errOut, fixture.opts(kind, osKeyringProviderName)); err != nil {
				t.Fatalf("copy back to keyring: %v", err)
			}
			if ref := activeReference(fixture.readCredentials(t), kind); ref == nil || *ref != (SecretReference{Provider: osKeyringProviderName, Key: key}) {
				t.Fatalf("config reference after copy back = %+v", ref)
			}
			if got, err := fixture.registry.Resolve(SecretReference{Provider: fileProviderName, Key: key}); err != nil || got != want {
				t.Fatalf("copy back must not delete the file copy: %q %v", got, err)
			}
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.SecretWritten || !result.CredentialsUpdated {
				t.Fatalf("unexpected copy-back result: %+v", result)
			}
			assertNoSecretLeak(t, fixture, out.String(), errOut.String())
		})
	}
}

func TestConfigCredentialsCopyPreservesUnrelatedFields(t *testing.T) {
	fixture := newCopyFixture(t)
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName)); err != nil {
		t.Fatal(err)
	}
	var document struct {
		Unknown bool `json:"unknown_top_level"`
		Keys    struct {
			Extra string `json:"extra"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(fixture.credentialsBytes(t), &document); err != nil {
		t.Fatal(err)
	}
	if !document.Unknown || document.Keys.Extra != "kept" {
		t.Fatalf("unrelated fields were not preserved: %s", fixture.credentialsBytes(t))
	}
}

// countingSecretProvider records reads so tests can prove none happened.
type countingSecretProvider struct {
	memorySecretProvider
	reads int
}

func (p *countingSecretProvider) Get(key string) (string, error) {
	p.reads++
	return p.memorySecretProvider.Get(key)
}

func TestConfigCredentialsCopyRejectsReadOnlyDestinationBeforeAnyRead(t *testing.T) {
	for _, tc := range []struct {
		name        string
		destination string
		file        FileSecretProvider
	}{
		{"env", environmentProviderName, FileSecretProvider{}},
		{"read-only file root", fileProviderName, FileSecretProvider{Root: t.TempDir()}},
		{"unset file root", fileProviderName, FileSecretProvider{Writable: true}},
		{"unknown provider", "vault", FileSecretProvider{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := &countingSecretProvider{memorySecretProvider: memorySecretProvider{values: map[string]string{}}}
			registry := NewSecretProviderRegistry()
			registry.Register(osKeyringProviderName, source)
			registry.Register(fileProviderName, tc.file)
			// A missing credentials file proves the config is not read either.
			err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, credentialCopyOpts{
				credentialsPath: filepath.Join(t.TempDir(), "missing.json"),
				kind:            credentialIdentitySeed,
				destination:     tc.destination,
				providers:       registry,
			})
			if err == nil || !strings.Contains(err.Error(), "destination_read_only") {
				t.Fatalf("expected destination_read_only, got %v", err)
			}
			if source.reads != 0 {
				t.Fatalf("source was read %d times before the destination check", source.reads)
			}
		})
	}
}

func TestConfigCredentialsCopyConflictLeavesBothSidesIntact(t *testing.T) {
	fixture := newCopyFixture(t)
	key := canonicalCopyKey(t, credentialOAuth2ClientSecret)
	target := SecretReference{Provider: fileProviderName, Key: key}
	if err := fixture.registry.Store(target, "a-different-secret"); err != nil {
		t.Fatal(err)
	}
	before := fixture.credentialsBytes(t)
	var out bytes.Buffer
	err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName))
	if err == nil || !strings.Contains(err.Error(), "different secret") {
		t.Fatalf("expected a conflict, got %v", err)
	}
	if !bytes.Equal(before, fixture.credentialsBytes(t)) {
		t.Fatal("conflict rewrote the credentials file")
	}
	if got, _ := fixture.registry.Resolve(target); got != "a-different-secret" {
		t.Fatalf("conflict overwrote the destination: %q", got)
	}
	if fixture.keyring.values[key] != fixture.values[credentialOAuth2ClientSecret] {
		t.Fatal("conflict touched the source")
	}
	if out.Len() != 0 {
		t.Fatalf("a clean failure must not report manual recovery: %s", out.String())
	}
}

func TestConfigCredentialsCopyRerunAfterInterruptedCopyIsIdempotent(t *testing.T) {
	fixture := newCopyFixture(t)
	key := canonicalCopyKey(t, credentialIdentitySeed)
	// A previous run stored the destination and died before the rewrite.
	if err := fixture.registry.Store(SecretReference{Provider: fileProviderName, Key: key}, fixture.values[credentialIdentitySeed]); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialIdentitySeed, fileProviderName)); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	var result credentialCopyOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.SecretWritten || !result.CredentialsUpdated {
		t.Fatalf("rerun should store nothing and rewrite the config: %+v", result)
	}
	if ref := fixture.readCredentials(t).Keys.PrivateKeyRef; ref.Provider != fileProviderName {
		t.Fatalf("config not switched: %+v", ref)
	}
}

// rollbackTrackingProvider is a writable destination whose Set or read-back
// can fail, and whose Set can touch the credentials file so the
// compare-and-replace rewrite fails after the secret was stored. It counts
// Delete calls so tests can assert a failed copy never deletes.
type rollbackTrackingProvider struct {
	values      map[string]string
	failSet     bool
	corruptRead bool
	touchPath   string
	deletes     int
}

func (p *rollbackTrackingProvider) CanWrite() bool { return true }

func (p *rollbackTrackingProvider) Get(key string) (string, error) {
	value, ok := p.values[key]
	if !ok {
		return "", ErrSecretNotFound
	}
	if p.corruptRead {
		return value + "-corrupted", nil
	}
	return value, nil
}

func (p *rollbackTrackingProvider) Set(key, value string) error {
	if p.failSet {
		return errors.New("destination unavailable")
	}
	if p.touchPath != "" {
		data, err := os.ReadFile(p.touchPath)
		if err != nil {
			return err
		}
		if err := os.WriteFile(p.touchPath, append(data, '\n'), privateFileMode); err != nil {
			return err
		}
	}
	p.values[key] = value
	return nil
}

func (p *rollbackTrackingProvider) Delete(key string) error {
	p.deletes++
	delete(p.values, key)
	return nil
}

func TestConfigCredentialsCopyKeepsTheSourceActiveAtEachFailureStage(t *testing.T) {
	for _, tc := range []struct {
		name         string
		provider     func(credentialsPath string) *rollbackTrackingProvider
		wantStage    string
		wantRetained bool
	}{
		{
			name:      "destination write",
			provider:  func(string) *rollbackTrackingProvider { return &rollbackTrackingProvider{failSet: true} },
			wantStage: "store_destination",
		},
		{
			name:         "read-back verification",
			provider:     func(string) *rollbackTrackingProvider { return &rollbackTrackingProvider{corruptRead: true} },
			wantStage:    "store_destination",
			wantRetained: true,
		},
		{
			name: "config rewrite",
			provider: func(path string) *rollbackTrackingProvider {
				return &rollbackTrackingProvider{touchPath: path}
			},
			wantStage:    "update_credentials",
			wantRetained: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newCopyFixture(t)
			destination := tc.provider(fixture.credentialsPath)
			destination.values = map[string]string{}
			fixture.registry.Register("staging", destination)
			key := canonicalCopyKey(t, credentialAgentKey)

			var out bytes.Buffer
			err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialAgentKey, "staging"))
			if err == nil || !strings.Contains(err.Error(), tc.wantStage) {
				t.Fatalf("expected failure during %s, got %v", tc.wantStage, err)
			}
			// Another copy may have adopted the destination entry, so a failed
			// copy never deletes it.
			if destination.deletes != 0 {
				t.Fatalf("a failed copy deleted the destination %d times", destination.deletes)
			}
			if _, stored := destination.values[key]; stored != tc.wantRetained {
				t.Fatalf("destination stored = %v, want %v", stored, tc.wantRetained)
			}
			if strings.Contains(err.Error(), "left in place") != tc.wantRetained {
				t.Fatalf("error must name a retained destination exactly when one exists: %v", err)
			}
			if ref := fixture.readCredentials(t).AgentKeyRefs[copyFixtureTeamA]; ref.Provider != osKeyringProviderName {
				t.Fatalf("failed copy switched the active reference: %+v", ref)
			}
			if fixture.keyring.values[key] != fixture.values[credentialAgentKey] {
				t.Fatal("failed copy changed the source")
			}
			if out.Len() != 0 {
				t.Fatalf("a failed copy printed a result: %s", out.String())
			}
			assertNoSecretLeak(t, fixture, err.Error())
		})
	}
}

func TestConfigCredentialsCopyFromEnvUsesCanonicalKey(t *testing.T) {
	fixture := newCopyFixture(t)
	t.Setenv(environmentSecretKey, fixture.values[credentialOAuth2ClientSecret])
	fixture.editDocument(t, func(document map[string]any) {
		oauth := document["oauth2"].(map[string]any)
		oauth["client_secret_ref"] = map[string]string{"provider": environmentProviderName, "key": environmentSecretKey}
	})
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName)); err != nil {
		t.Fatalf("copy from env: %v", err)
	}
	want := SecretReference{Provider: fileProviderName, Key: canonicalCopyKey(t, credentialOAuth2ClientSecret)}
	if ref := fixture.readCredentials(t).OAuth2.ClientSecretRef; *ref != want {
		t.Fatalf("copy from env should switch to the canonical key: %+v", ref)
	}
}

func TestConfigCredentialsCopyKeepsOAuth2SecretBytesExact(t *testing.T) {
	const secret = "canary-oauth-secret\n"
	t.Run("file destination cannot represent a trailing newline", func(t *testing.T) {
		fixture := newCopyFixture(t)
		fixture.keyring.values[OAuth2SecretKey(copyFixtureSubject, copyFixtureClient)] = secret
		before := fixture.credentialsBytes(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName))
		if err == nil || !strings.Contains(err.Error(), "destination_unrepresentable") {
			t.Fatalf("expected destination_unrepresentable, got %v", err)
		}
		if !bytes.Equal(before, fixture.credentialsBytes(t)) {
			t.Fatal("rejected copy rewrote the credentials file")
		}
		if _, err := fixture.registry.Resolve(SecretReference{Provider: fileProviderName, Key: canonicalCopyKey(t, credentialOAuth2ClientSecret)}); !errors.Is(err, ErrSecretNotFound) {
			t.Fatalf("rejected copy stored a value: %v", err)
		}
	})
	t.Run("keyring destination stores the exact bytes", func(t *testing.T) {
		fixture := newCopyFixture(t)
		t.Setenv(environmentSecretKey, secret)
		fixture.editDocument(t, func(document map[string]any) {
			oauth := document["oauth2"].(map[string]any)
			oauth["client_secret_ref"] = map[string]string{"provider": environmentProviderName, "key": environmentSecretKey}
		})
		delete(fixture.keyring.values, OAuth2SecretKey(copyFixtureSubject, copyFixtureClient))
		if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, osKeyringProviderName)); err != nil {
			t.Fatalf("copy: %v", err)
		}
		if got := fixture.keyring.values[OAuth2SecretKey(copyFixtureSubject, copyFixtureClient)]; got != secret {
			t.Fatalf("stored %q, want the exact source bytes", got)
		}
	})
	t.Run("a destination differing only by a newline is a conflict", func(t *testing.T) {
		fixture := newCopyFixture(t)
		key := OAuth2SecretKey(copyFixtureSubject, copyFixtureClient)
		if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName)); err != nil {
			t.Fatal(err)
		}
		fixture.keyring.values[key] = fixture.values[credentialOAuth2ClientSecret] + "\n"
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, osKeyringProviderName))
		if err == nil || !strings.Contains(err.Error(), "different secret") {
			t.Fatalf("expected a conflict, got %v", err)
		}
		if ref := fixture.readCredentials(t).OAuth2.ClientSecretRef; ref.Provider != fileProviderName {
			t.Fatalf("conflict switched the reference: %+v", ref)
		}
	})
}

func TestConfigCredentialsCopySelectsAgentKeyTeam(t *testing.T) {
	fixture := newCopyFixture(t)
	fixture.keyring.values[TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamB)] = "canary-agent-key-b"
	fixture.editDocument(t, func(document map[string]any) {
		refs := document["agent_key_refs"].(map[string]any)
		refs[copyFixtureTeamB] = map[string]string{"provider": osKeyringProviderName, "key": TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamB)}
	})

	opts := fixture.opts(credentialAgentKey, fileProviderName)
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, opts); err == nil || !strings.Contains(err.Error(), "--team") {
		t.Fatalf("expected an explicit team requirement, got %v", err)
	}
	opts.team = "00000000-0000-4000-8000-0000000000ff"
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, opts); err == nil || !strings.Contains(err.Error(), "no agent key configured") {
		t.Fatalf("expected an unknown-team error, got %v", err)
	}
	opts.team = copyFixtureTeamB
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, opts); err != nil {
		t.Fatalf("copy team B: %v", err)
	}
	refs := fixture.readCredentials(t).AgentKeyRefs
	if refs[copyFixtureTeamB].Provider != fileProviderName || refs[copyFixtureTeamA].Provider != osKeyringProviderName {
		t.Fatalf("only team B should switch: %+v", refs)
	}
}

func TestConfigCredentialsCopyRejectsUnsupportedSources(t *testing.T) {
	t.Run("legacy plaintext", func(t *testing.T) {
		fixture := newCopyFixture(t)
		fixture.editDocument(t, func(document map[string]any) {
			keys := document["keys"].(map[string]any)
			delete(keys, "private_key_ref")
			keys["private_key"] = fixture.values[credentialIdentitySeed]
		})
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName))
		if err == nil || !strings.Contains(err.Error(), "config migrate") {
			t.Fatalf("expected a migrate hint, got %v", err)
		}
	})
	for _, tc := range []struct {
		kind  credentialKind
		field string
		edit  func(document map[string]any)
	}{
		{credentialOAuth2ClientSecret, "oauth2.client_secret", func(d map[string]any) {
			d["oauth2"].(map[string]any)["client_secret"] = "inline-secret"
		}},
		{credentialIdentitySeed, "keys.private_key", func(d map[string]any) {
			d["keys"].(map[string]any)["private_key"] = "inline-seed"
		}},
		{credentialGitHubAppPrivateKey, "github.private_key_path", func(d map[string]any) {
			d["github"].(map[string]any)["private_key_path"] = "/tmp/app.pem"
		}},
	} {
		t.Run("reference beside "+tc.field, func(t *testing.T) {
			fixture := newCopyFixture(t)
			fixture.editDocument(t, tc.edit)
			before := fixture.credentialsBytes(t)
			err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(tc.kind, fileProviderName))
			if err == nil || !strings.Contains(err.Error(), tc.field) {
				t.Fatalf("expected an ambiguity error naming %s, got %v", tc.field, err)
			}
			if !bytes.Equal(before, fixture.credentialsBytes(t)) {
				t.Fatal("an ambiguous config was rewritten")
			}
		})
	}
	t.Run("same provider", func(t *testing.T) {
		fixture := newCopyFixture(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, osKeyringProviderName))
		if err == nil || !strings.Contains(err.Error(), "already stored") {
			t.Fatalf("expected same-provider rejection, got %v", err)
		}
	})
	t.Run("unbound source", func(t *testing.T) {
		fixture := newCopyFixture(t)
		fixture.editDocument(t, func(document map[string]any) {
			github := document["github"].(map[string]any)
			github["private_key_ref"] = map[string]string{"provider": osKeyringProviderName, "key": GitHubAppPrivateKeyKey("999")}
		})
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialGitHubAppPrivateKey, fileProviderName))
		if err == nil || !strings.Contains(err.Error(), "not bound") {
			t.Fatalf("expected a binding error, got %v", err)
		}
	})
	t.Run("corrupt source value", func(t *testing.T) {
		fixture := newCopyFixture(t)
		fixture.keyring.values[IdentitySeedKey(copyFixtureFinger)] = "bm90IGEgc2VlZA=="
		before := fixture.credentialsBytes(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName))
		if err == nil || !strings.Contains(err.Error(), "resolve_source") {
			t.Fatalf("expected a source validation failure, got %v", err)
		}
		if !bytes.Equal(before, fixture.credentialsBytes(t)) {
			t.Fatal("corrupt source was propagated")
		}
	})
	t.Run("team flag on another kind", func(t *testing.T) {
		fixture := newCopyFixture(t)
		opts := fixture.opts(credentialIdentitySeed, fileProviderName)
		opts.team = copyFixtureTeamA
		if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, opts); err == nil || !strings.Contains(err.Error(), "--team applies only") {
			t.Fatalf("expected --team rejection, got %v", err)
		}
	})
}

func TestConfigCredentialsCopyInvalidatesActivationCache(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	storeFixtureFileSecret(t, OAuth2SecretKey(fixtureSubjectID, "cid"), "oauth-secret")
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2.ClientSecret = ""
		creds.OAuth2.ClientSecretRef = &SecretReference{Provider: fileProviderName, Key: OAuth2SecretKey(fixtureSubjectID, "cid")}
	})
	if err := runAgentsActivationRefreshCmd(&bytes.Buffer{}, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	ctx, err := resolveActivationContext("test-agent")
	if err != nil {
		t.Fatal(err)
	}
	if result, err := validateActivationCache(ctx); err != nil || !result.Valid {
		t.Fatalf("fresh cache should validate: %+v %v", result, err)
	}

	registry, keyring := newMemorySecretProviderRegistry()
	err = runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, credentialCopyOpts{
		kind:        credentialOAuth2ClientSecret,
		destination: osKeyringProviderName,
		providers:   registry,
	})
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	if keyring.values[OAuth2SecretKey(fixtureSubjectID, "cid")] != "oauth-secret" {
		t.Fatal("secret was not copied into the keyring")
	}

	// The rewrite changes moltnet.json, an activation input, and the recorded
	// provider map; either invalidates the cache so the next refresh records
	// the new provider.
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || (result.Reason != "input_hash_mismatch" && result.Reason != "cache_metadata_mismatch") {
		t.Fatalf("cache survived a provider change: %+v", result)
	}
	creds, err := ReadConfigFrom(filepath.Join(dir, ".config", "moltnet", "identities", "test-agent", "moltnet.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := activationCredentialProviders(creds)[activationCredentialOAuth2]; got != osKeyringProviderName {
		t.Fatalf("next refresh would record oauth2 provider %q", got)
	}
}

// TestConfigCredentialsCopyCommand runs the user-facing command: its required
// flags, --kind parsing and --credentials wiring. The source is an env
// reference so no real keyring is involved.
func TestConfigCredentialsCopyCommand(t *testing.T) {
	fixture := newCopyFixture(t)
	t.Setenv(environmentSecretKey, fixture.values[credentialOAuth2ClientSecret])
	fixture.editDocument(t, func(document map[string]any) {
		document["oauth2"].(map[string]any)["client_secret_ref"] = map[string]string{"provider": environmentProviderName, "key": environmentSecretKey}
	})
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	t.Setenv(secretRootWritableEnv, "1")

	for _, args := range [][]string{
		{"config", "credentials", "copy", "--to", "file"},
		{"config", "credentials", "copy", "--kind", "oauth2-client-secret"},
		{"config", "credentials", "copy", "--kind", "password", "--to", "file"},
		{"config", "credentials", "copy", "--kind", "identity-seed", "--team", copyFixtureTeamA, "--to", "file"},
	} {
		if _, _, err := executeCommand(NewRootCmd("test", ""), append([]string{"--credentials", fixture.credentialsPath}, args...)...); err == nil {
			t.Fatalf("%v must be rejected", args)
		}
	}

	stdout, stderr, err := executeCommand(NewRootCmd("test", ""),
		"--credentials", fixture.credentialsPath,
		"config", "credentials", "copy", "--kind", "oauth2-client-secret", "--to", "file")
	if err != nil {
		t.Fatalf("copy: %v\n%s", err, stderr)
	}
	key := canonicalCopyKey(t, credentialOAuth2ClientSecret)
	if stored, err := (FileSecretProvider{Root: root}).Get(key); err != nil || stored != fixture.values[credentialOAuth2ClientSecret] {
		t.Fatalf("the file root does not hold the copied secret: %v", err)
	}
	if ref := fixture.readCredentials(t).OAuth2.ClientSecretRef; *ref != (SecretReference{Provider: fileProviderName, Key: key}) {
		t.Fatalf("the reference was not switched: %+v", ref)
	}
	assertNoSecretLeak(t, fixture, stdout, stderr)
}
