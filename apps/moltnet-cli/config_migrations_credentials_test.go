package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeReferenceBackedFixture models an agent that already migrated its
// OAuth2 secret but still carries a plaintext seed and a GitHub PEM path.
func writeReferenceBackedFixture(t *testing.T, seed, publicKey string, withGitHub bool) (string, string) {
	t.Helper()
	root := t.TempDir()
	agentDir := filepath.Join(root, ".moltnet", "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	pemPath := ""
	github := ""
	if withGitHub {
		pemPath = filepath.Join(agentDir, "github-app.pem")
		if err := os.WriteFile(pemPath, testRSAPrivateKeyPEM(t), privateFileMode); err != nil {
			t.Fatal(err)
		}
		github = `,
  "github": {
    "app_id": "123",
    "installation_id": "456",
    "private_key_path": ` + mustJSON(t, pemPath) + `,
    "custom": "kept"
  }`
	}
	config := `{
  "identity_id": "identity-id",
  "oauth2": {
    "client_id": "client-id",
    "client_secret_ref": { "provider": "os-keyring", "key": "oauth2/identity-id/client-id" }
  },
  "keys": {
    "public_key": ` + mustJSON(t, publicKey) + `,
    "private_key": ` + mustJSON(t, seed) + `,
    "fingerprint": "fingerprint",
    "extra": "kept"
  },
  "endpoints": { "api": "https://api.themolt.net", "mcp": "https://mcp.themolt.net/mcp" },
  "unknown_top_level": true` + github + `
}`
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	if err := os.WriteFile(credentialsPath, []byte(config), privateFileMode); err != nil {
		t.Fatal(err)
	}
	return credentialsPath, pemPath
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func runMigrationExpectingFailure(t *testing.T, credentialsPath string, registry *SecretProviderRegistry) configMigrationRunOutput {
	t.Helper()
	var output bytes.Buffer
	err := runConfigMigrateCmdWithRegistry(&output, credentialsPath, "", "", osKeyringProviderName, false, registry, defaultConfigMigrations(osKeyringProviderName))
	if err == nil {
		t.Fatalf("migration unexpectedly succeeded:\n%s", output.String())
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatalf("parse failure output: %v\n%s", err, output.String())
	}
	return result
}

func TestConfigMigrateMovesIdentitySeedThenGitHubPEM(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, pemPath := writeReferenceBackedFixture(t, seed, publicKey, true)
	registry, provider := newMemorySecretProviderRegistry()
	originalPEM, _ := os.ReadFile(pemPath)

	first := runNextConfigMigration(t, credentialsPath, registry)
	if strings.Join(first.Applied, ",") != "2026-09-identity-seed-reference" {
		t.Fatalf("first applied = %v", first.Applied)
	}
	if provider.values[IdentitySeedKey("fingerprint")] != seed {
		t.Fatal("identity seed was not stored under the bound key")
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.Keys.PrivateKey != "" || creds.Keys.PrivateKeyRef == nil || creds.Keys.PrivateKeyRef.Key != IdentitySeedKey("fingerprint") {
		t.Fatalf("keys section not rewritten: %+v", creds.Keys)
	}
	if _, err := resolveIdentitySeed(creds, registry); err != nil {
		t.Fatalf("migrated seed does not resolve: %v", err)
	}
	raw, _ := os.ReadFile(credentialsPath)
	for _, kept := range []string{`"extra": "kept"`, `"unknown_top_level": true`, `"custom": "kept"`, `"client_secret_ref"`} {
		if !strings.Contains(string(raw), kept) {
			t.Fatalf("rewrite dropped %s:\n%s", kept, raw)
		}
	}
	if strings.Contains(string(raw), seed) {
		t.Fatal("plaintext seed retained in credentials")
	}

	second := runNextConfigMigration(t, credentialsPath, registry)
	if strings.Join(second.Applied, ",") != "2026-09-github-pem-reference" {
		t.Fatalf("second applied = %v", second.Applied)
	}
	if provider.values[GitHubAppPrivateKeyKey("123")] != strings.TrimRight(string(originalPEM), "\n") {
		t.Fatal("PEM was not stored under the bound key without its trailing newline")
	}
	creds, err = ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.GitHub.PrivateKeyPath != "" || creds.GitHub.PrivateKeyRef == nil || creds.GitHub.PrivateKeyRef.Key != GitHubAppPrivateKeyKey("123") {
		t.Fatalf("github section not rewritten: %+v", creds.GitHub)
	}
	if _, err := resolveGitHubAppPrivateKey(creds, registry); err != nil {
		t.Fatalf("migrated PEM does not resolve: %v", err)
	}
	afterPEM, err := os.ReadFile(pemPath)
	if err != nil || !bytes.Equal(afterPEM, originalPEM) {
		t.Fatalf("original PEM file must be left untouched (err=%v)", err)
	}
	found := false
	for _, op := range second.Plan.Migrations[0].Operations {
		if strings.Contains(op, "leave the original PEM file in place") {
			found = true
		}
	}
	if !found {
		t.Fatalf("plan must tell the operator the PEM stays: %+v", second.Plan.Migrations[0].Operations)
	}

	third := runNextConfigMigration(t, credentialsPath, registry)
	if third.Changed || len(third.Applied) != 0 {
		t.Fatalf("idempotent run changed state: %+v", third)
	}
}

func TestConfigMigrateStoresSeedAndPEMInWritableFileRoot(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, pemPath := writeReferenceBackedFixture(t, seed, publicKey, true)
	root := t.TempDir()
	registry := NewSecretProviderRegistry()
	registry.Register(fileProviderName, FileSecretProvider{Root: root, Writable: true, MaxBytes: defaultSecretMaxBytes})
	migrations := defaultConfigMigrations(fileProviderName)
	run := func() configMigrationRunOutput {
		var output bytes.Buffer
		if err := runConfigMigrateCmdWithRegistry(&output, credentialsPath, "", "", fileProviderName, false, registry, migrations); err != nil {
			t.Fatalf("run migration: %v\n%s", err, output.String())
		}
		var result configMigrationRunOutput
		if err := json.Unmarshal(output.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	if got := run().Applied; strings.Join(got, ",") != "2026-09-identity-seed-reference" {
		t.Fatalf("first applied = %v", got)
	}
	if got := run().Applied; strings.Join(got, ",") != "2026-09-github-pem-reference" {
		t.Fatalf("second applied = %v", got)
	}
	if third := run(); third.Changed || len(third.Applied) != 0 {
		t.Fatalf("file-backed migrations are not idempotent: %+v", third)
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if creds.Keys.PrivateKeyRef == nil || creds.Keys.PrivateKeyRef.Provider != fileProviderName ||
		creds.GitHub.PrivateKeyRef == nil || creds.GitHub.PrivateKeyRef.Provider != fileProviderName {
		t.Fatalf("references do not target the file provider: %+v %+v", creds.Keys.PrivateKeyRef, creds.GitHub.PrivateKeyRef)
	}
	if _, err := resolveIdentitySeed(creds, registry); err != nil {
		t.Fatalf("seed does not resolve from the file root: %v", err)
	}
	pemData, err := resolveGitHubAppPrivateKey(creds, registry)
	if err != nil {
		t.Fatalf("PEM does not resolve from the file root: %v", err)
	}
	original, _ := os.ReadFile(pemPath)
	if strings.TrimSpace(string(pemData)) != strings.TrimSpace(string(original)) {
		t.Fatal("resolved PEM differs from the original file")
	}
	if _, err := os.Stat(filepath.Join(root, "github-app", "123", "private-key")); err != nil {
		t.Fatalf("PEM not stored under the canonical file key: %v", err)
	}
}

func TestConfigMigrateSeedFailsBeforeStoringWhenItDoesNotDerivePublicKey(t *testing.T) {
	seed, _ := testSeedAndPublicKey(t)
	_, otherPublic := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, otherPublic, false)
	registry, provider := newMemorySecretProviderRegistry()

	result := runMigrationExpectingFailure(t, credentialsPath, registry)
	if result.Failure == nil || result.Failure.Stage != "verify_seed" || result.Changed || result.ManualRecoveryRequired {
		t.Fatalf("unexpected failure: %+v", result.Failure)
	}
	if len(provider.values) != 0 {
		t.Fatal("seed must not be stored when it does not match the public key")
	}
	raw, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(raw), seed) {
		t.Fatal("credentials must be untouched on verification failure")
	}
}

func TestConfigMigrateSeedConflictLeavesBothSidesIntact(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, false)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[IdentitySeedKey("fingerprint")] = "different-seed"

	result := runMigrationExpectingFailure(t, credentialsPath, registry)
	if result.Failure == nil || result.Failure.Stage != "ensure_secret" || result.Changed {
		t.Fatalf("unexpected failure: %+v", result.Failure)
	}
	if provider.values[IdentitySeedKey("fingerprint")] != "different-seed" {
		t.Fatal("conflicting destination value was overwritten")
	}
	if strings.Contains(result.Failure.Message, seed) || strings.Contains(result.Failure.Message, "different-seed") {
		t.Fatal("failure output leaked a secret value")
	}
	raw, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(raw), seed) {
		t.Fatal("credentials must be untouched on a destination conflict")
	}
}

func TestConfigMigratePEMFailsBeforeStoringWhenFileIsNotRSA(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, pemPath := writeReferenceBackedFixture(t, seed, publicKey, true)
	registry, provider := newMemorySecretProviderRegistry()
	runNextConfigMigration(t, credentialsPath, registry) // seed first
	if err := os.WriteFile(pemPath, []byte("not a pem"), privateFileMode); err != nil {
		t.Fatal(err)
	}

	result := runMigrationExpectingFailure(t, credentialsPath, registry)
	if result.Failure == nil || result.Failure.Stage != "verify_pem" || result.Changed {
		t.Fatalf("unexpected failure: %+v", result.Failure)
	}
	if _, stored := provider.values[GitHubAppPrivateKeyKey("123")]; stored {
		t.Fatal("invalid PEM must not be stored")
	}

	if err := os.Remove(pemPath); err != nil {
		t.Fatal(err)
	}
	result = runMigrationExpectingFailure(t, credentialsPath, registry)
	if result.Failure == nil || result.Failure.Stage != "read_pem" || !result.Failure.Retryable {
		t.Fatalf("missing PEM should be a retryable read failure: %+v", result.Failure)
	}
}

func TestConfigMigrateRejectsAmbiguousSeedAndPEMForms(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, true)
	raw, _ := os.ReadFile(credentialsPath)
	ambiguous := strings.Replace(string(raw), `"fingerprint": "fingerprint",`, `"fingerprint": "fingerprint", "private_key_ref": {"provider":"os-keyring","key":"identity/fingerprint/seed"},`, 1)
	if err := os.WriteFile(credentialsPath, []byte(ambiguous), privateFileMode); err != nil {
		t.Fatal(err)
	}
	_, err := buildConfigMigrationPlan(credentialsPath, osKeyringProviderName, defaultConfigMigrations(osKeyringProviderName))
	if err == nil || !strings.Contains(err.Error(), "exactly one of private_key or private_key_ref") {
		t.Fatalf("expected ambiguity error, got %v", err)
	}
}

func TestValidateMigrationDestination(t *testing.T) {
	registry := NewSecretProviderRegistry()
	root := t.TempDir()
	cases := []struct {
		name        string
		destination string
		writable    bool
		wantErr     string
	}{
		{"default", "", false, ""},
		{"os-keyring", "os-keyring", false, ""},
		{"env", "env", false, "read-only"},
		{"file read-only", "file", false, "MOLTNET_SECRET_ROOT_WRITABLE=1"},
		{"file writable", "file", true, ""},
		{"unknown", "vault", false, "not a writable secret provider"},
		{"undeclared write support", "memory", false, "not a writable secret provider"},
	}
	registry.Register("memory", readOnlyByOmissionProvider{})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			registry.Register(fileProviderName, FileSecretProvider{Root: root, Writable: tc.writable, MaxBytes: defaultSecretMaxBytes})
			got, err := validateMigrationDestination(registry, tc.destination)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				want := tc.destination
				if want == "" {
					want = defaultMigrationDestination
				}
				if got != want {
					t.Fatalf("destination = %q, want %q", got, want)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestConfigMigrateRunRejectsPlanGeneratedForAnotherDestination(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, false)
	registry, _ := newMemorySecretProviderRegistry()
	registry.Register(fileProviderName, FileSecretProvider{Root: t.TempDir(), Writable: true, MaxBytes: defaultSecretMaxBytes})
	plan, err := buildConfigMigrationPlan(credentialsPath, osKeyringProviderName, defaultConfigMigrations(osKeyringProviderName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(plan.Migrations[0].Operations, "\n"), `"os-keyring"`) {
		t.Fatalf("plan must name its destination: %+v", plan.Migrations[0].Operations)
	}
	if plan.Parameters[migrationDestinationParameter] != osKeyringProviderName {
		t.Fatalf("plan must record its destination as a parameter: %+v", plan.Parameters)
	}
	_, err = applyConfigMigrationPlan(plan, fileProviderName, registry, defaultConfigMigrations(fileProviderName))
	if err == nil || !strings.Contains(err.Error(), "parameters do not match") {
		t.Fatalf("expected destination mismatch to be rejected, got %v", err)
	}
}

func TestConfigMigratePlanningRejectsIncompleteLegacyForms(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	cases := []struct {
		name   string
		mutate func(string) string
		want   string
	}{
		{"seed without fingerprint", func(doc string) string {
			return strings.Replace(doc, `"fingerprint": "fingerprint",`, `"fingerprint": "",`, 1)
		}, "requires keys.fingerprint and keys.public_key"},
		{"seed without public key", func(doc string) string {
			return strings.Replace(doc, mustJSON(t, publicKey), `""`, 1)
		}, "requires keys.fingerprint and keys.public_key"},
		{"pem without app id", func(doc string) string {
			doc = strings.Replace(doc, mustJSON(t, seed), mustJSON(t, ""), 1) // seed already migrated → PEM is next
			return strings.Replace(doc, `"app_id": "123"`, `"app_id": ""`, 1)
		}, "requires github.app_id"},
		{"pem with both forms", func(doc string) string {
			doc = strings.Replace(doc, mustJSON(t, seed), mustJSON(t, ""), 1)
			return strings.Replace(doc, `"installation_id": "456",`, `"installation_id": "456", "private_key_ref": {"provider":"os-keyring","key":"github-app/123/private-key"},`, 1)
		}, "exactly one of private_key_path or private_key_ref"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, true)
			raw, _ := os.ReadFile(credentialsPath)
			if err := os.WriteFile(credentialsPath, []byte(tc.mutate(string(raw))), privateFileMode); err != nil {
				t.Fatal(err)
			}
			_, err := buildConfigMigrationPlan(credentialsPath, osKeyringProviderName, defaultConfigMigrations(osKeyringProviderName))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestConfigMigratePlansNothingWithoutLegacyForms(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, false)
	raw, _ := os.ReadFile(credentialsPath)
	migrated := strings.Replace(string(raw), `"private_key": `+mustJSON(t, seed)+`,`, `"private_key_ref": {"provider":"os-keyring","key":"identity/fingerprint/seed"},`, 1)
	if err := os.WriteFile(credentialsPath, []byte(migrated), privateFileMode); err != nil {
		t.Fatal(err)
	}
	plan, err := buildConfigMigrationPlan(credentialsPath, osKeyringProviderName, defaultConfigMigrations(osKeyringProviderName))
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Migrations) != 0 {
		t.Fatalf("reference-backed config without a github section planned %+v", plan.Migrations)
	}
}

func TestConfigMigrateCommandValidatesDestinationBeforeReadingCredentials(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, false)
	missing := filepath.Join(t.TempDir(), "missing.json")
	for _, tc := range []struct{ dest, path, want string }{
		{"env", credentialsPath, "read-only"},
		{"vault", credentialsPath, "not a writable secret provider"},
		{"file", missing, "MOLTNET_SECRET_ROOT_WRITABLE=1"}, // destination error wins over the missing file
	} {
		t.Run(tc.dest, func(t *testing.T) {
			t.Setenv(secretRootEnv, "")
			t.Setenv(secretRootWritableEnv, "")
			root := NewRootCmd("test", "")
			_, _, err := executeCommand(root, "config", "migrate", "--credentials", tc.path, "--destination", tc.dest, "--dry-run")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
	t.Run("writable file root reaches planning", func(t *testing.T) {
		t.Setenv(secretRootEnv, t.TempDir())
		t.Setenv(secretRootWritableEnv, "1")
		root := NewRootCmd("test", "")
		stdout, _, err := executeCommand(root, "config", "migrate", "--credentials", credentialsPath, "--destination", "file", "--dry-run")
		if err != nil {
			t.Fatalf("dry-run: %v", err)
		}
		if !strings.Contains(stdout, `2026-09-identity-seed-reference`) || !strings.Contains(stdout, `\"file\" provider`) {
			t.Fatalf("plan should target the file provider:\n%s", stdout)
		}
		if strings.Contains(stdout, seed) {
			t.Fatal("dry-run output leaked the seed")
		}
	})
}

// readOnlyByOmissionProvider accepts Set but never declares write support.
type readOnlyByOmissionProvider struct{}

func (readOnlyByOmissionProvider) Get(string) (string, error) { return "", ErrSecretNotFound }
func (readOnlyByOmissionProvider) Set(string, string) error   { return nil }
func (readOnlyByOmissionProvider) Delete(string) error        { return nil }

func TestFileSecretProviderCanWriteMatchesOpenRootPrerequisites(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		provider FileSecretProvider
		want     bool
	}{
		{"writable existing dir", FileSecretProvider{Root: dir, Writable: true}, true},
		{"not writable", FileSecretProvider{Root: dir}, false},
		{"relative root", FileSecretProvider{Root: "secrets", Writable: true}, false},
		{"missing root", FileSecretProvider{Root: filepath.Join(dir, "missing"), Writable: true}, false},
		{"root is a file", FileSecretProvider{Root: file, Writable: true}, false},
		{"empty root", FileSecretProvider{Writable: true}, false},
	} {
		if got := tc.provider.CanWrite(); got != tc.want {
			t.Errorf("%s: CanWrite = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// touchingSecretProvider stores values in memory and, on every Set, appends a
// newline to the credentials file so the migration's compare-and-swap
// replacement fails after the secret was stored and verified.
type touchingSecretProvider struct {
	memorySecretProvider
	path string
}

func (p *touchingSecretProvider) Set(key, value string) error {
	data, err := os.ReadFile(p.path)
	if err != nil {
		return err
	}
	if err := os.WriteFile(p.path, append(data, '\n'), privateFileMode); err != nil {
		return err
	}
	return p.memorySecretProvider.Set(key, value)
}

func TestConfigMigrateReplacementFailureAfterStoreIsRetryable(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, true)
	provider := &touchingSecretProvider{memorySecretProvider: memorySecretProvider{values: map[string]string{}}, path: credentialsPath}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)

	for _, step := range []struct{ id, key string }{
		{"2026-09-identity-seed-reference", IdentitySeedKey("fingerprint")},
		{"2026-09-github-pem-reference", GitHubAppPrivateKeyKey("123")},
	} {
		t.Run(step.id, func(t *testing.T) {
			result := runMigrationExpectingFailure(t, credentialsPath, registry)
			if result.Failure == nil || result.Failure.Migration != step.id || result.Failure.Stage != "replace_credentials" {
				t.Fatalf("unexpected failure: %+v", result.Failure)
			}
			if !result.Failure.Retryable || result.Failure.ManualRecoveryRequired || result.ManualRecoveryRequired || !result.Changed {
				t.Fatalf("post-store replacement failure must be retryable with the secret retained: %+v", result.Failure)
			}
			if _, stored := provider.values[step.key]; !stored {
				t.Fatal("secret must be retained in the destination")
			}
			// Re-running is the recovery path: Ensure accepts the identical
			// value without writing again, so the file is not touched and the
			// replacement succeeds.
			retry := runNextConfigMigration(t, credentialsPath, registry)
			if strings.Join(retry.Applied, ",") != step.id {
				t.Fatalf("retry applied = %v", retry.Applied)
			}
		})
	}
}

func TestConfigMigrateRunRejectsGeneratedPlanForAnotherDestinationThroughCommand(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, _ := writeReferenceBackedFixture(t, seed, publicKey, false)
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	t.Setenv(secretRootWritableEnv, "1")
	planPath := filepath.Join(t.TempDir(), "plan.json")

	generate := NewRootCmd("test", "")
	if _, _, err := executeCommand(generate, "config", "migrate", "--credentials", credentialsPath, "--generate", planPath); err != nil {
		t.Fatalf("generate: %v", err)
	}
	planData, _ := os.ReadFile(planPath)
	if !strings.Contains(string(planData), `"parameters"`) || !strings.Contains(string(planData), `"destination": "os-keyring"`) {
		t.Fatalf("generated plan must carry the destination parameter:\n%s", planData)
	}

	run := NewRootCmd("test", "")
	_, _, err := executeCommand(run, "config", "migrate", "--credentials", credentialsPath, "--run", planPath, "--destination", "file")
	if err == nil || !strings.Contains(err.Error(), "parameters do not match") {
		t.Fatalf("run with another destination must be rejected before applying: %v", err)
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatalf("rejected plan wrote into the file root: %v", entries)
	}
	raw, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(raw), seed) {
		t.Fatal("rejected plan mutated the credentials file")
	}
}

func TestConfigMigrateStoresPEMWithExactlyOneTrailingNewlineStripped(t *testing.T) {
	seed, publicKey := testSeedAndPublicKey(t)
	credentialsPath, pemPath := writeReferenceBackedFixture(t, seed, publicKey, true)
	// A PEM that ends in CRLF followed by an extra blank line: the shared
	// stripOneNewline contract removes exactly one line ending, so the
	// stored value keeps the CRLF and drops only the final "\n".
	original, _ := os.ReadFile(pemPath)
	padded := append(bytes.TrimRight(original, "\n"), []byte("\r\n\n")...)
	if err := os.WriteFile(pemPath, padded, privateFileMode); err != nil {
		t.Fatal(err)
	}
	registry, provider := newMemorySecretProviderRegistry()
	runNextConfigMigration(t, credentialsPath, registry) // seed
	runNextConfigMigration(t, credentialsPath, registry) // pem
	want := string(bytes.TrimRight(original, "\n")) + "\r\n"
	if got := provider.values[GitHubAppPrivateKeyKey("123")]; got != want {
		t.Fatalf("stored PEM normalization differs from stripOneNewline:\n got tail %q\nwant tail %q", got[len(got)-6:], want[len(want)-6:])
	}
}

func TestConfigMigrateOAuth2RewritePreservesUnknownFields(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	raw, _ := os.ReadFile(credentialsPath)
	withUnknown := strings.Replace(string(raw), `"client_id": "client-id",`, `"client_id": "client-id", "oauth2_extra": "kept",`, 1)
	withUnknown = strings.Replace(withUnknown, `"identity_id": "identity-id",`, `"identity_id": "identity-id", "top_level_extra": {"nested": true},`, 1)
	if err := os.WriteFile(credentialsPath, []byte(withUnknown), privateFileMode); err != nil {
		t.Fatal(err)
	}
	registry, _ := newMemorySecretProviderRegistry()
	first := runNextConfigMigration(t, credentialsPath, registry)
	if strings.Join(first.Applied, ",") != "2026-08-oauth2-secret-reference" {
		t.Fatalf("applied = %v", first.Applied)
	}
	after, _ := os.ReadFile(credentialsPath)
	for _, kept := range []string{`"oauth2_extra": "kept"`, `"nested": true`, `"registered_at": "2026-08-06T00:00:00Z"`, `"client_secret_ref"`} {
		if !strings.Contains(string(after), kept) {
			t.Fatalf("OAuth2 rewrite dropped %s:\n%s", kept, after)
		}
	}
	if strings.Contains(string(after), `"client_secret":`) {
		t.Fatalf("plaintext client_secret retained:\n%s", after)
	}
}
