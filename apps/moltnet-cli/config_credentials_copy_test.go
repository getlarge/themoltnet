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
	recoveryDir     string
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
		recoveryDir:     t.TempDir(),
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

func (f *copyFixture) opts(kind credentialKind, destination string, move bool) credentialCopyOpts {
	return credentialCopyOpts{
		credentialsPath: f.credentialsPath,
		kind:            kind,
		destination:     destination,
		move:            move,
		providers:       f.registry,
		writeRecovery: func(recovery credentialCopyRecovery) (string, error) {
			return writeRecoveryArtifact(f.recoveryDir, "credential-copy-recovery-*.json", recovery)
		},
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

func (f *copyFixture) recoveryArtifacts(t *testing.T) []credentialCopyRecovery {
	t.Helper()
	entries, err := os.ReadDir(f.recoveryDir)
	if err != nil {
		t.Fatal(err)
	}
	var artifacts []credentialCopyRecovery
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(f.recoveryDir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var artifact credentialCopyRecovery
		if err := json.Unmarshal(data, &artifact); err != nil {
			t.Fatal(err)
		}
		artifacts = append(artifacts, artifact)
	}
	return artifacts
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
			if err := runConfigCredentialsCopyCmd(&out, &errOut, fixture.opts(kind, fileProviderName, false)); err != nil {
				t.Fatalf("copy to file: %v", err)
			}
			if ref := activeReference(fixture.readCredentials(t), kind); ref == nil || *ref != (SecretReference{Provider: fileProviderName, Key: key}) {
				t.Fatalf("config reference after copy = %+v", ref)
			}
			want := stripOneNewline(fixture.values[kind])
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
			if !result.SecretWritten || !result.CredentialsUpdated || result.SourceDeleted || result.Operation != "copy" {
				t.Fatalf("unexpected copy result: %+v", result)
			}

			// file -> keyring (move): the keyring still holds the identical
			// value, so Ensure is a no-op; the file source is deleted.
			out.Reset()
			if err := runConfigCredentialsCopyCmd(&out, &errOut, fixture.opts(kind, osKeyringProviderName, true)); err != nil {
				t.Fatalf("move to keyring: %v", err)
			}
			if ref := activeReference(fixture.readCredentials(t), kind); ref == nil || *ref != (SecretReference{Provider: osKeyringProviderName, Key: key}) {
				t.Fatalf("config reference after move = %+v", ref)
			}
			if _, err := fixture.registry.Resolve(SecretReference{Provider: fileProviderName, Key: key}); !errors.Is(err, ErrSecretNotFound) {
				t.Fatalf("move left the file source behind: %v", err)
			}
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.SecretWritten || !result.CredentialsUpdated || !result.SourceDeleted || result.Operation != "move" {
				t.Fatalf("unexpected move result: %+v", result)
			}
			assertNoSecretLeak(t, fixture, out.String(), errOut.String())
		})
	}
}

func TestConfigCredentialsCopyPreservesUnrelatedFields(t *testing.T) {
	fixture := newCopyFixture(t)
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName, false)); err != nil {
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
	err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName, true))
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
	if out.Len() != 0 || len(fixture.recoveryArtifacts(t)) != 0 {
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
	if err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialIdentitySeed, fileProviderName, false)); err != nil {
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

// rollbackTrackingProvider is a writable destination whose Set, read-back,
// and Delete can each fail, and whose Set can touch the credentials file so
// the compare-and-replace rewrite fails after the secret was stored.
type rollbackTrackingProvider struct {
	values      map[string]string
	failSet     bool
	corruptRead bool
	failDelete  bool
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
	if p.failDelete {
		return errors.New("delete refused")
	}
	delete(p.values, key)
	return nil
}

func TestConfigCredentialsCopyRollsBackEachFailureStage(t *testing.T) {
	for _, tc := range []struct {
		name          string
		provider      func(credentialsPath string) *rollbackTrackingProvider
		wantStage     string
		wantDeletes   int
		wantRecovery  bool
		wantUnchanged bool
	}{
		{
			name:          "destination write",
			provider:      func(string) *rollbackTrackingProvider { return &rollbackTrackingProvider{failSet: true} },
			wantStage:     "store_destination",
			wantUnchanged: true,
		},
		{
			name:          "read-back verification",
			provider:      func(string) *rollbackTrackingProvider { return &rollbackTrackingProvider{corruptRead: true} },
			wantStage:     "store_destination",
			wantDeletes:   1,
			wantUnchanged: true,
		},
		{
			name: "config rewrite",
			provider: func(path string) *rollbackTrackingProvider {
				return &rollbackTrackingProvider{touchPath: path}
			},
			wantStage:   "update_credentials",
			wantDeletes: 1,
		},
		{
			name: "config rewrite with failed rollback",
			provider: func(path string) *rollbackTrackingProvider {
				return &rollbackTrackingProvider{touchPath: path, failDelete: true}
			},
			wantStage:    "update_credentials",
			wantDeletes:  1,
			wantRecovery: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newCopyFixture(t)
			destination := tc.provider(fixture.credentialsPath)
			destination.values = map[string]string{}
			fixture.registry.Register("staging", destination)
			key := canonicalCopyKey(t, credentialAgentKey)
			before := fixture.credentialsBytes(t)

			var out bytes.Buffer
			err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialAgentKey, "staging", true))
			if err == nil || !strings.Contains(err.Error(), tc.wantStage) {
				t.Fatalf("expected failure during %s, got %v", tc.wantStage, err)
			}
			if destination.deletes != tc.wantDeletes {
				t.Fatalf("destination deletes = %d, want %d", destination.deletes, tc.wantDeletes)
			}
			if tc.wantUnchanged && !bytes.Equal(before, fixture.credentialsBytes(t)) {
				t.Fatal("failed copy rewrote the credentials file")
			}
			if ref := fixture.readCredentials(t).AgentKeyRefs[copyFixtureTeamA]; ref.Provider != osKeyringProviderName {
				t.Fatalf("failed copy switched the active reference: %+v", ref)
			}
			if fixture.keyring.values[key] != fixture.values[credentialAgentKey] {
				t.Fatal("failed move deleted the source")
			}
			if !tc.wantRecovery {
				if _, ok := destination.values[key]; ok {
					t.Fatal("destination secret was not rolled back")
				}
				if out.Len() != 0 || len(fixture.recoveryArtifacts(t)) != 0 {
					t.Fatalf("rolled-back failure must not require manual recovery: %s", out.String())
				}
				return
			}
			var result credentialCopyOutput
			if err := json.Unmarshal(out.Bytes(), &result); err != nil {
				t.Fatalf("parse output: %v\n%s", err, out.String())
			}
			if !result.ManualRecoveryRequired || result.Stage != tc.wantStage || result.RecoveryPath == "" {
				t.Fatalf("unexpected recovery result: %+v", result)
			}
			artifacts := fixture.recoveryArtifacts(t)
			if len(artifacts) != 1 || artifacts[0].ActiveReference.Provider != osKeyringProviderName || !artifacts[0].SecretWritten {
				t.Fatalf("unexpected recovery artifact: %+v", artifacts)
			}
			assertNoSecretLeak(t, fixture, out.String(), err.Error())
		})
	}
}

// undeletableSecretProvider serves the source but refuses to delete it.
type undeletableSecretProvider struct{ memorySecretProvider }

func (p *undeletableSecretProvider) Delete(string) error { return errors.New("keyring locked") }

func TestConfigCredentialsMoveReportsSourceDeletionFailure(t *testing.T) {
	fixture := newCopyFixture(t)
	source := &undeletableSecretProvider{memorySecretProvider: *fixture.keyring}
	fixture.registry.Register(osKeyringProviderName, source)
	key := canonicalCopyKey(t, credentialOAuth2ClientSecret)

	var out bytes.Buffer
	err := runConfigCredentialsCopyCmd(&out, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName, true))
	if err == nil || !strings.Contains(err.Error(), "delete_source") {
		t.Fatalf("expected a source deletion failure, got %v", err)
	}
	var result credentialCopyOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out.String())
	}
	if !result.ManualRecoveryRequired || !result.CredentialsUpdated || result.SourceDeleted || result.Stage != "delete_source" {
		t.Fatalf("unexpected result: %+v", result)
	}
	// Both references stay usable: the config points at the verified copy and
	// the source still holds the value.
	if ref := fixture.readCredentials(t).OAuth2.ClientSecretRef; ref.Provider != fileProviderName {
		t.Fatalf("config should reference the destination: %+v", ref)
	}
	if source.values[key] != fixture.values[credentialOAuth2ClientSecret] {
		t.Fatal("source secret changed")
	}
	artifacts := fixture.recoveryArtifacts(t)
	if len(artifacts) != 1 || artifacts[0].Stage != "delete_source" || artifacts[0].ActiveReference.Provider != fileProviderName {
		t.Fatalf("unexpected recovery artifact: %+v", artifacts)
	}
	assertNoSecretLeak(t, fixture, out.String(), err.Error())
}

func TestConfigCredentialsMoveRejectsEnvSource(t *testing.T) {
	fixture := newCopyFixture(t)
	t.Setenv(environmentSecretKey, fixture.values[credentialOAuth2ClientSecret])
	fixture.editDocument(t, func(document map[string]any) {
		oauth := document["oauth2"].(map[string]any)
		oauth["client_secret_ref"] = map[string]string{"provider": environmentProviderName, "key": environmentSecretKey}
	})
	before := fixture.credentialsBytes(t)
	err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName, true))
	if err == nil || !strings.Contains(err.Error(), "use copy") {
		t.Fatalf("expected env move rejection, got %v", err)
	}
	if !bytes.Equal(before, fixture.credentialsBytes(t)) {
		t.Fatal("rejected move rewrote the credentials file")
	}
	if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialOAuth2ClientSecret, fileProviderName, false)); err != nil {
		t.Fatalf("copy from env: %v", err)
	}
	if ref := fixture.readCredentials(t).OAuth2.ClientSecretRef; ref.Provider != fileProviderName {
		t.Fatalf("copy from env did not switch the reference: %+v", ref)
	}
}

func TestConfigCredentialsCopySelectsAgentKeyTeam(t *testing.T) {
	fixture := newCopyFixture(t)
	fixture.keyring.values[TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamB)] = "canary-agent-key-b"
	fixture.editDocument(t, func(document map[string]any) {
		refs := document["agent_key_refs"].(map[string]any)
		refs[copyFixtureTeamB] = map[string]string{"provider": osKeyringProviderName, "key": TeamAgentKeyKey(copyFixtureSubject, copyFixtureTeamB)}
	})

	opts := fixture.opts(credentialAgentKey, fileProviderName, false)
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
		t.Fatalf("only team B should move: %+v", refs)
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
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName, false))
		if err == nil || !strings.Contains(err.Error(), "config migrate") {
			t.Fatalf("expected a migrate hint, got %v", err)
		}
	})
	t.Run("same provider", func(t *testing.T) {
		fixture := newCopyFixture(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, osKeyringProviderName, false))
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
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialGitHubAppPrivateKey, fileProviderName, false))
		if err == nil || !strings.Contains(err.Error(), "not bound") {
			t.Fatalf("expected a binding error, got %v", err)
		}
	})
	t.Run("corrupt source value", func(t *testing.T) {
		fixture := newCopyFixture(t)
		fixture.keyring.values[IdentitySeedKey(copyFixtureFinger)] = "bm90IGEgc2VlZA=="
		before := fixture.credentialsBytes(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName, false))
		if err == nil || !strings.Contains(err.Error(), "resolve_source") {
			t.Fatalf("expected a source validation failure, got %v", err)
		}
		if !bytes.Equal(before, fixture.credentialsBytes(t)) {
			t.Fatal("corrupt source was propagated")
		}
	})
	t.Run("move from read-only file root", func(t *testing.T) {
		fixture := newCopyFixture(t)
		if err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, fileProviderName, false)); err != nil {
			t.Fatal(err)
		}
		fixture.registry.Register(fileProviderName, FileSecretProvider{Root: fixture.fileRoot})
		before := fixture.credentialsBytes(t)
		err := runConfigCredentialsCopyCmd(&bytes.Buffer{}, nil, fixture.opts(credentialIdentitySeed, osKeyringProviderName, true))
		if err == nil || !strings.Contains(err.Error(), "read-only") {
			t.Fatalf("expected a read-only source rejection, got %v", err)
		}
		if !bytes.Equal(before, fixture.credentialsBytes(t)) {
			t.Fatal("rejected move rewrote the credentials file")
		}
	})
	t.Run("team flag on another kind", func(t *testing.T) {
		fixture := newCopyFixture(t)
		opts := fixture.opts(credentialIdentitySeed, fileProviderName, false)
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
