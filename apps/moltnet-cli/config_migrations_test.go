package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeLegacyMigrationFixture(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	agentDir := filepath.Join(root, ".moltnet", "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	credentialsPath := filepath.Join(agentDir, "moltnet.json")
	config := `{
  "identity_id": "identity-id",
  "oauth2": {
    "client_id": "client-id",
    "client_secret": "legacy-plaintext-secret"
  },
  "keys": {
    "public_key": "public",
    "private_key": "private",
    "fingerprint": "fingerprint"
  },
  "endpoints": {
    "api": "https://api.themolt.net",
    "mcp": "https://mcp.themolt.net/mcp"
  },
  "registered_at": "2026-08-06T00:00:00Z"
}`
	if err := os.WriteFile(credentialsPath, []byte(config), privateFileMode); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(agentDir, "env")
	if err := os.WriteFile(
		envPath,
		[]byte("TEST_AGENT_CLIENT_ID='client-id'\nTEST_AGENT_CLIENT_SECRET='legacy-plaintext-secret'\nCUSTOM='preserved'\n"),
		privateFileMode,
	); err != nil {
		t.Fatal(err)
	}
	return credentialsPath, envPath
}

func runNextConfigMigration(
	t *testing.T,
	credentialsPath string,
	registry *SecretProviderRegistry,
) configMigrationRunOutput {
	t.Helper()
	var output bytes.Buffer
	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("run migration: %v\n%s", err, output.String())
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestConfigMigrateUsesResumableSingleStepTransitions(t *testing.T) {
	credentialsPath, envPath := writeLegacyMigrationFixture(t)
	registry, provider := newMemorySecretProviderRegistry()

	first := runNextConfigMigration(t, credentialsPath, registry)
	if strings.Join(first.Applied, ",") != "2026-08-oauth2-secret-reference" {
		t.Fatalf("first applied migrations = %v", first.Applied)
	}
	if provider.values[OAuth2SecretKey("identity-id", "client-id")] != "legacy-plaintext-secret" {
		t.Fatal("OAuth2 secret was not stored")
	}
	credentials, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(credentials), "legacy-plaintext-secret") || !strings.Contains(string(credentials), "client_secret_ref") {
		t.Fatalf("credentials were not reference-backed:\n%s", credentials)
	}
	envAfterFirst, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(envAfterFirst), "legacy-plaintext-secret") {
		t.Fatal("fixture did not model a crash before environment cleanup")
	}

	second := runNextConfigMigration(t, credentialsPath, registry)
	if strings.Join(second.Applied, ",") != "2026-08-remove-managed-oauth2-env" {
		t.Fatalf("second applied migrations = %v", second.Applied)
	}
	envAfterSecond, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(envAfterSecond), "CLIENT_SECRET") || strings.Contains(string(envAfterSecond), "legacy-plaintext-secret") {
		t.Fatalf("environment retained plaintext secret:\n%s", envAfterSecond)
	}
	if !strings.Contains(string(envAfterSecond), "CUSTOM='preserved'") {
		t.Fatalf("environment cleanup lost user content:\n%s", envAfterSecond)
	}

	third := runNextConfigMigration(t, credentialsPath, registry)
	if third.Changed || len(third.Applied) != 0 {
		t.Fatalf("idempotent run changed state: %+v", third)
	}
}

func TestConfigMigratePreservesLegacyEnvironmentUntilReferenceIsVerified(t *testing.T) {
	for _, tt := range []struct {
		name          string
		destination   string
		wantRetryable bool
		wantRecovery  bool
	}{
		{name: "missing destination", wantRetryable: true},
		{name: "different destination", destination: "rotated-secret", wantRecovery: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			credentialsPath, envPath := writeLegacyMigrationFixture(t)
			registry, provider := newMemorySecretProviderRegistry()
			runNextConfigMigration(t, credentialsPath, registry)
			key := OAuth2SecretKey("identity-id", "client-id")
			if tt.destination == "" {
				delete(provider.values, key)
			} else {
				provider.values[key] = tt.destination
			}

			var output bytes.Buffer
			err := runConfigMigrateCmdWithRegistry(
				&output, credentialsPath, "", "", false, registry, defaultConfigMigrations(),
			)
			if err == nil || err.Error() != "configuration migration failed during verify_reference" {
				t.Fatalf("cleanup error = %v", err)
			}
			env, _ := os.ReadFile(envPath)
			if !strings.Contains(string(env), "legacy-plaintext-secret") {
				t.Fatalf("cleanup removed the fallback secret: %s", env)
			}
			var result configMigrationRunOutput
			if err := json.Unmarshal(output.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Failure == nil || result.Failure.Retryable != tt.wantRetryable ||
				result.ManualRecoveryRequired != tt.wantRecovery || result.Changed {
				t.Fatalf("failure state = %+v", result)
			}
		})
	}
}

func TestConfigMigrateDryRunDoesNotMutateState(t *testing.T) {
	credentialsPath, envPath := writeLegacyMigrationFixture(t)
	credentialsBefore, _ := os.ReadFile(credentialsPath)
	envBefore, _ := os.ReadFile(envPath)
	registry, provider := newMemorySecretProviderRegistry()
	var output bytes.Buffer

	if err := runConfigMigrateCmdWithRegistry(
		&output, credentialsPath, "", "", true, registry, defaultConfigMigrations(),
	); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "legacy-plaintext-secret") || len(provider.values) != 0 {
		t.Fatal("dry-run disclosed or stored the secret")
	}
	credentialsAfter, _ := os.ReadFile(credentialsPath)
	envAfter, _ := os.ReadFile(envPath)
	if !bytes.Equal(credentialsAfter, credentialsBefore) || !bytes.Equal(envAfter, envBefore) {
		t.Fatal("dry-run changed configuration files")
	}
}

func TestConfigMigrateNeverReturnsOrPrintsProviderSecrets(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	const disclosed = "provider-error-included-super-secret"
	migration := configMigration{
		ID:          "redaction-test",
		Description: "redaction test",
		Operations:  []string{"fail safely"},
		Applies:     func(configMigrationContext) (bool, error) { return true, nil },
		Run: func(configMigrationContext, *SecretProviderRegistry) error {
			return migrationStageError("provider", retainedSecretState(true), errors.New(disclosed))
		},
	}
	var output bytes.Buffer
	err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		NewSecretProviderRegistry(),
		[]configMigration{migration},
	)
	if err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	if strings.Contains(err.Error(), disclosed) || strings.Contains(output.String(), disclosed) {
		t.Fatalf("provider secret escaped: err=%v output=%s", err, output.String())
	}
}

func TestConfigMigrateGeneratesAndRunsBoundRedactedPlan(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, provider := newMemorySecretProviderRegistry()
	planPath := filepath.Join(t.TempDir(), "migrations.json")
	if err := os.WriteFile(planPath, []byte("replace me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(planPath, 0o644); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer

	if err := runConfigMigrateCmdWithRegistry(
		&output, credentialsPath, planPath, "", false, registry, defaultConfigMigrations(),
	); err != nil {
		t.Fatal(err)
	}
	planData, err := os.ReadFile(planPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(planData), "legacy-plaintext-secret") || !strings.Contains(string(planData), "2026-08-oauth2-secret-reference") {
		t.Fatalf("plan was not redacted or complete:\n%s", planData)
	}
	info, err := os.Stat(planPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != privateFileMode {
		t.Fatalf("plan mode = %o", info.Mode().Perm())
	}

	output.Reset()
	if err := runConfigMigrateCmdWithRegistry(
		&output, credentialsPath, "", planPath, false, registry, defaultConfigMigrations(),
	); err != nil {
		t.Fatal(err)
	}
	if provider.values[OAuth2SecretKey("identity-id", "client-id")] != "legacy-plaintext-secret" {
		t.Fatal("generated plan did not store the secret")
	}
}

func TestConfigMigrateRejectsInvalidCommandModesAndPlanFiles(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, _ := newMemorySecretProviderRegistry()

	modeTests := []struct {
		generatePath string
		runPath      string
		dryRun       bool
		want         string
	}{
		{generatePath: "plan.json", dryRun: true, want: "--dry-run cannot be combined"},
		{runPath: "plan.json", dryRun: true, want: "--dry-run cannot be combined"},
		{generatePath: "one.json", runPath: "two.json", want: "mutually exclusive"},
	}
	for _, tt := range modeTests {
		err := runConfigMigrateCmdWithRegistry(
			io.Discard, credentialsPath, tt.generatePath, tt.runPath, tt.dryRun, registry, defaultConfigMigrations(),
		)
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Fatalf("mode error = %v, want %q", err, tt.want)
		}
	}

	malformedPath := filepath.Join(t.TempDir(), "malformed.json")
	if err := os.WriteFile(malformedPath, []byte("{"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	err := runConfigMigrateCmdWithRegistry(
		io.Discard, credentialsPath, "", malformedPath, false, registry, defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "parse migration plan") {
		t.Fatalf("malformed plan error = %v", err)
	}

	otherCredentialsPath, _ := writeLegacyMigrationFixture(t)
	plan, err := buildConfigMigrationPlan(otherCredentialsPath, defaultConfigMigrations())
	if err != nil {
		t.Fatal(err)
	}
	wrongTargetPath := filepath.Join(t.TempDir(), "wrong-target.json")
	if err := writeConfigMigrationPlan(wrongTargetPath, plan); err != nil {
		t.Fatal(err)
	}
	err = runConfigMigrateCmdWithRegistry(
		io.Discard, credentialsPath, "", wrongTargetPath, false, registry, defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "migration plan targets") {
		t.Fatalf("wrong-target plan error = %v", err)
	}
}

type concurrentWriteSecretProvider struct {
	path   string
	value  string
	stored string
}

func (p *concurrentWriteSecretProvider) Get(string) (string, error) {
	if p.stored == "" {
		return "", ErrSecretNotFound
	}
	return p.stored, nil
}

func (p *concurrentWriteSecretProvider) Set(_ string, value string) error {
	p.stored = value
	return os.WriteFile(p.path, []byte(p.value), privateFileMode)
}

func (p *concurrentWriteSecretProvider) Delete(string) error {
	p.stored = ""
	return nil
}

func TestConfigMigrateDoesNotOverwriteConcurrentCredentialsChange(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	provider := &concurrentWriteSecretProvider{
		path:  credentialsPath,
		value: `{"concurrent":true}`,
	}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output, credentialsPath, "", "", false, registry, defaultConfigMigrations(),
	)
	if err == nil || err.Error() != "configuration migration failed during replace_credentials" {
		t.Fatalf("concurrent migration error = %v", err)
	}
	if provider.stored != "legacy-plaintext-secret" {
		t.Fatal("migration deleted the only stored secret after the source changed")
	}
	current, _ := os.ReadFile(credentialsPath)
	if string(current) != provider.value {
		t.Fatalf("migration overwrote concurrent credentials: %s", current)
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Failure == nil || result.Failure.Stage != "replace_credentials" ||
		!result.Failure.ManualRecoveryRequired || result.Failure.Retryable ||
		!result.Changed || !result.ManualRecoveryRequired {
		t.Fatalf("failure envelope = %+v", result.Failure)
	}
}

type failedRollbackSecretProvider struct {
	stored bool
}

func (p *failedRollbackSecretProvider) Get(string) (string, error) {
	if !p.stored {
		return "", ErrSecretNotFound
	}
	return "wrong-after-store", nil
}

func (p *failedRollbackSecretProvider) Set(string, string) error {
	p.stored = true
	return nil
}

func (*failedRollbackSecretProvider) Delete(string) error {
	return errors.New("keyring unavailable")
}

func TestConfigMigrateRetainsUnverifiedSecretForManualRecovery(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	provider := &failedRollbackSecretProvider{}
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, provider)
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output, credentialsPath, "", "", false, registry, defaultConfigMigrations(),
	)
	if err == nil || err.Error() != "configuration migration failed during ensure_secret" {
		t.Fatalf("migration error = %v", err)
	}
	credentials, _ := os.ReadFile(credentialsPath)
	if !strings.Contains(string(credentials), "legacy-plaintext-secret") {
		t.Fatal("failed migration removed the source secret")
	}
	var result configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Failure == nil || result.Failure.Stage != "ensure_secret" ||
		!result.Failure.ManualRecoveryRequired || result.Failure.Retryable ||
		!result.Changed || !result.ManualRecoveryRequired {
		t.Fatalf("failure envelope = %+v", result.Failure)
	}
}

func TestConfigMigrateRejectsConflictingUnavailableAndAmbiguousSecrets(t *testing.T) {
	tests := []struct {
		name      string
		provider  SecretProvider
		mutate    func(t *testing.T, path string)
		want      string
		sanitized bool
	}{
		{name: "conflicting destination", provider: mismatchingSecretProvider{}, want: "different secret", sanitized: true},
		{name: "unavailable destination", provider: failingReadSecretProvider{}, want: "inspect destination secret", sanitized: true},
		{
			name:     "ambiguous source",
			provider: &memorySecretProvider{values: map[string]string{}},
			mutate: func(t *testing.T, path string) {
				data, _ := os.ReadFile(path)
				data = bytes.Replace(data, []byte(`"client_secret": "legacy-plaintext-secret"`), []byte(`"client_secret": "legacy-plaintext-secret", "client_secret_ref": {"provider":"os-keyring","key":"existing"}`), 1)
				if err := os.WriteFile(path, data, privateFileMode); err != nil {
					t.Fatal(err)
				}
			},
			want: "exactly one",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			credentialsPath, _ := writeLegacyMigrationFixture(t)
			if tt.mutate != nil {
				tt.mutate(t, credentialsPath)
			}
			registry := NewSecretProviderRegistry()
			registry.Register(osKeyringProviderName, tt.provider)
			var output bytes.Buffer
			err := runConfigMigrateCmdWithRegistry(
				&output, credentialsPath, "", "", false, registry, defaultConfigMigrations(),
			)
			if err == nil {
				t.Fatal("migration unexpectedly succeeded")
			}
			if !tt.sanitized && !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("migration error = %v, want %q", err, tt.want)
			}
			if tt.sanitized && (strings.Contains(err.Error(), tt.want) || strings.Contains(output.String(), tt.want)) {
				t.Fatalf("migration output exposed internal provider detail %q", tt.want)
			}
		})
	}
}

type mismatchingSecretProvider struct{}

func (mismatchingSecretProvider) Get(string) (string, error) { return "different", nil }
func (mismatchingSecretProvider) Set(string, string) error   { return nil }
func (mismatchingSecretProvider) Delete(string) error        { return nil }

type failingReadSecretProvider struct{}

func (failingReadSecretProvider) Get(string) (string, error) {
	return "", errors.New("provider unavailable")
}
func (failingReadSecretProvider) Set(string, string) error { return nil }
func (failingReadSecretProvider) Delete(string) error      { return nil }

func TestConfigMigrateRejectsSymlinkedCredentialsAndEnvironment(t *testing.T) {
	t.Run("credentials", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join(root, "target.json")
		link := filepath.Join(root, "moltnet.json")
		if err := os.WriteFile(target, []byte(`{}`), privateFileMode); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		_, err := buildConfigMigrationPlan(link, defaultConfigMigrations())
		if err == nil || !strings.Contains(err.Error(), "symbolic link") {
			t.Fatalf("symlinked credentials error = %v", err)
		}
	})

	t.Run("environment", func(t *testing.T) {
		credentialsPath, envPath := writeLegacyMigrationFixture(t)
		registry, _ := newMemorySecretProviderRegistry()
		runNextConfigMigration(t, credentialsPath, registry)
		target := filepath.Join(t.TempDir(), "target-env")
		original := []byte("TEST_AGENT_CLIENT_SECRET='do-not-touch'\nCUSTOM='preserved'\n")
		if err := os.WriteFile(target, original, privateFileMode); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(envPath); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, envPath); err != nil {
			t.Fatal(err)
		}
		_, err := buildConfigMigrationPlan(credentialsPath, defaultConfigMigrations())
		if err == nil || !strings.Contains(err.Error(), "symbolic link") {
			t.Fatalf("symlinked environment error = %v", err)
		}
		current, _ := os.ReadFile(target)
		if !bytes.Equal(current, original) {
			t.Fatalf("symlink target changed: %s", current)
		}
	})
}

func TestConfigMigrateRejectsStalePlanAndShowsHelp(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	plan, err := buildConfigMigrationPlan(credentialsPath, defaultConfigMigrations())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credentialsPath, []byte(`{"changed":true}`), privateFileMode); err != nil {
		t.Fatal(err)
	}
	_, err = applyConfigMigrationPlan(plan, NewSecretProviderRegistry(), defaultConfigMigrations())
	if err == nil || !strings.Contains(err.Error(), "changed after") {
		t.Fatalf("stale plan error = %v", err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "migrate", "--help")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"--dry-run", "--generate", "--run"} {
		if !strings.Contains(stdout, expected) {
			t.Fatalf("help missing %s:\n%s", expected, stdout)
		}
	}
}
