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
		[]byte("TEST_AGENT_CLIENT_ID='client-id'\nTEST_AGENT_CLIENT_SECRET='legacy-plaintext-secret'\n"),
		privateFileMode,
	); err != nil {
		t.Fatal(err)
	}
	return credentialsPath, envPath
}

func TestConfigMigratePlansAndMovesLegacyOAuth2Secret(t *testing.T) {
	credentialsPath, envPath := writeLegacyMigrationFixture(t)
	registry, provider := newMemorySecretProviderRegistry()
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err != nil {
		t.Fatalf("migrate config: %v", err)
	}
	if strings.Contains(output.String(), "legacy-plaintext-secret") {
		t.Fatal("migration output leaked the secret")
	}
	if provider.values[OAuth2SecretKey("identity-id", "client-id")] != "legacy-plaintext-secret" {
		t.Fatal("OAuth2 secret was not stored in the destination provider")
	}

	data, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "legacy-plaintext-secret") || strings.Contains(string(data), `"client_secret"`) {
		t.Fatalf("credentials retained plaintext secret:\n%s", data)
	}
	if !strings.Contains(string(data), `"client_secret_ref"`) {
		t.Fatalf("credentials missing secret reference:\n%s", data)
	}
	envData, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(envData), "CLIENT_SECRET") || strings.Contains(string(envData), "legacy-plaintext-secret") {
		t.Fatalf("agent env retained plaintext secret:\n%s", envData)
	}

	output.Reset()
	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	var repeat configMigrationRunOutput
	if err := json.Unmarshal(output.Bytes(), &repeat); err != nil {
		t.Fatal(err)
	}
	if repeat.Changed || len(repeat.Applied) != 0 {
		t.Fatalf("repeat migration changed config: %+v", repeat)
	}
}

func TestConfigMigrateGeneratesBoundRedactedPlan(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, _ := newMemorySecretProviderRegistry()
	planPath := filepath.Join(t.TempDir(), "migrations.json")
	if err := os.WriteFile(planPath, []byte("replace me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(planPath, 0o644); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer

	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		planPath,
		"",
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("generate plan: %v", err)
	}
	planData, err := os.ReadFile(planPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(planData), "legacy-plaintext-secret") {
		t.Fatal("migration plan leaked the secret")
	}
	if !strings.Contains(string(planData), "2026-08-oauth2-secret-reference") {
		t.Fatalf("migration plan missing OAuth2 step:\n%s", planData)
	}
	info, err := os.Stat(planPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != privateFileMode {
		t.Fatalf("plan mode = %o, want %o", got, privateFileMode)
	}

	if err := os.WriteFile(credentialsPath, append(planData, '\n'), privateFileMode); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	err = runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		planPath,
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "changed after the migration plan") {
		t.Fatalf("run stale plan error = %v", err)
	}
}

func TestConfigMigrateDryRunDoesNotMutateState(t *testing.T) {
	credentialsPath, envPath := writeLegacyMigrationFixture(t)
	credentialsBefore, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	envBefore, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	registry, provider := newMemorySecretProviderRegistry()
	var output bytes.Buffer

	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		true,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("dry-run migration: %v", err)
	}
	if strings.Contains(output.String(), "legacy-plaintext-secret") {
		t.Fatal("dry-run output leaked the secret")
	}
	if len(provider.values) != 0 {
		t.Fatalf("dry-run stored secrets: %+v", provider.values)
	}
	credentialsAfter, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	envAfter, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(credentialsAfter, credentialsBefore) || !bytes.Equal(envAfter, envBefore) {
		t.Fatal("dry-run changed configuration files")
	}
}

func TestConfigMigrateRunsGeneratedPlan(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, provider := newMemorySecretProviderRegistry()
	planPath := filepath.Join(t.TempDir(), "migrations.json")
	var output bytes.Buffer

	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		planPath,
		"",
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("generate plan: %v", err)
	}
	output.Reset()
	if err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		planPath,
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("run plan: %v", err)
	}
	if provider.values[OAuth2SecretKey("identity-id", "client-id")] != "legacy-plaintext-secret" {
		t.Fatal("generated plan did not store the OAuth2 secret")
	}
}

func TestConfigMigrateRejectsInvalidCommandModes(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, _ := newMemorySecretProviderRegistry()

	tests := []struct {
		name         string
		generatePath string
		runPath      string
		dryRun       bool
		want         string
	}{
		{name: "dry-run and generate", generatePath: "plan.json", dryRun: true, want: "--dry-run cannot be combined"},
		{name: "dry-run and run", runPath: "plan.json", dryRun: true, want: "--dry-run cannot be combined"},
		{name: "generate and run", generatePath: "one.json", runPath: "two.json", want: "mutually exclusive"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := runConfigMigrateCmdWithRegistry(
				io.Discard,
				credentialsPath,
				tt.generatePath,
				tt.runPath,
				tt.dryRun,
				registry,
				defaultConfigMigrations(),
			)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("migration error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestConfigMigrateRejectsInvalidPlanFiles(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, _ := newMemorySecretProviderRegistry()
	root := t.TempDir()

	malformedPath := filepath.Join(root, "malformed.json")
	if err := os.WriteFile(malformedPath, []byte("{"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	err := runConfigMigrateCmdWithRegistry(
		io.Discard,
		credentialsPath,
		"",
		malformedPath,
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "parse migration plan") {
		t.Fatalf("malformed plan error = %v", err)
	}

	otherCredentialsPath, _ := writeLegacyMigrationFixture(t)
	plan, err := buildConfigMigrationPlan(otherCredentialsPath, defaultConfigMigrations())
	if err != nil {
		t.Fatal(err)
	}
	wrongTargetPath := filepath.Join(root, "wrong-target.json")
	if err := writeConfigMigrationPlan(wrongTargetPath, plan); err != nil {
		t.Fatal(err)
	}
	err = runConfigMigrateCmdWithRegistry(
		io.Discard,
		credentialsPath,
		"",
		wrongTargetPath,
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "migration plan targets") {
		t.Fatalf("wrong-target plan error = %v", err)
	}
}

func TestApplyConfigMigrationPlanRejectsTamperingBeforeMutation(t *testing.T) {
	credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(credentialsPath, []byte("{}\n"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	var ran []string
	migrations := []configMigration{
		newTestConfigMigration("first", &ran),
		newTestConfigMigration("second", &ran),
	}
	original, err := buildConfigMigrationPlan(credentialsPath, migrations)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		mutate func(*configMigrationPlan)
		want   string
	}{
		{name: "unsupported format", mutate: func(plan *configMigrationPlan) { plan.FormatVersion++ }, want: "unsupported migration plan format"},
		{name: "different generator", mutate: func(plan *configMigrationPlan) { plan.GeneratedBy = "moltnet@other" }, want: "migration plan was generated by"},
		{name: "omitted migration", mutate: func(plan *configMigrationPlan) { plan.Migrations = plan.Migrations[:1] }, want: "does not match"},
		{name: "unknown migration", mutate: func(plan *configMigrationPlan) { plan.Migrations[1].ID = "unknown" }, want: "does not match"},
		{name: "duplicate migration", mutate: func(plan *configMigrationPlan) { plan.Migrations[1] = plan.Migrations[0] }, want: "does not match"},
		{name: "reordered migrations", mutate: func(plan *configMigrationPlan) {
			plan.Migrations[0], plan.Migrations[1] = plan.Migrations[1], plan.Migrations[0]
		}, want: "does not match"},
		{name: "changed description", mutate: func(plan *configMigrationPlan) { plan.Migrations[1].Description = "tampered" }, want: "does not match"},
		{name: "changed operations", mutate: func(plan *configMigrationPlan) { plan.Migrations[1].Operations = []string{"tampered"} }, want: "does not match"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ran = nil
			plan := cloneConfigMigrationPlan(t, original)
			tt.mutate(&plan)
			_, err := applyConfigMigrationPlan(plan, NewSecretProviderRegistry(), migrations)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("apply plan error = %v, want %q", err, tt.want)
			}
			if len(ran) != 0 {
				t.Fatalf("invalid plan ran migrations: %v", ran)
			}
		})
	}
}

func TestApplyConfigMigrationPlanRunsMigrationsInRegistryOrder(t *testing.T) {
	credentialsPath := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(credentialsPath, []byte("{}\n"), privateFileMode); err != nil {
		t.Fatal(err)
	}
	var ran []string
	migrations := []configMigration{
		newTestConfigMigration("first", &ran),
		newTestConfigMigration("second", &ran),
	}
	plan, err := buildConfigMigrationPlan(credentialsPath, migrations)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := applyConfigMigrationPlan(plan, NewSecretProviderRegistry(), migrations)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(ran, ",") != "first,second" || strings.Join(applied, ",") != "first,second" {
		t.Fatalf("migration order ran=%v applied=%v", ran, applied)
	}
}

func newTestConfigMigration(id string, ran *[]string) configMigration {
	return configMigration{
		ID:          id,
		Description: "migration " + id,
		Operations:  []string{"run " + id},
		Applies: func([]byte) (bool, error) {
			return true, nil
		},
		Run: func(configMigrationContext) error {
			*ran = append(*ran, id)
			return nil
		},
	}
}

func cloneConfigMigrationPlan(t *testing.T, plan configMigrationPlan) configMigrationPlan {
	t.Helper()
	data, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var clone configMigrationPlan
	if err := json.Unmarshal(data, &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}

type mismatchingSecretProvider struct{}

func (mismatchingSecretProvider) Get(string) (string, error) {
	return "different-value", nil
}

func (mismatchingSecretProvider) Set(string, string) error { return nil }

func (mismatchingSecretProvider) Delete(string) error { return nil }

func TestConfigMigrateRefusesToOverwriteDifferentDestination(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, mismatchingSecretProvider{})
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "different secret") {
		t.Fatalf("migration error = %v", err)
	}
	data, readErr := os.ReadFile(credentialsPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !strings.Contains(string(data), "legacy-plaintext-secret") {
		t.Fatal("failed migration changed the source credentials")
	}
}

func TestConfigMigrateResumesWhenDestinationAlreadyMatches(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry, provider := newMemorySecretProviderRegistry()
	provider.values[OAuth2SecretKey("identity-id", "client-id")] = "legacy-plaintext-secret"

	if err := runConfigMigrateCmdWithRegistry(
		io.Discard,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	); err != nil {
		t.Fatalf("resume migration: %v", err)
	}
	data, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "legacy-plaintext-secret") || !strings.Contains(string(data), "client_secret_ref") {
		t.Fatalf("resume did not migrate credentials:\n%s", data)
	}
}

func TestConfigMigrateRejectsAmbiguousOAuth2SecretForms(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	data, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	data = bytes.Replace(data, []byte(`"client_secret": "legacy-plaintext-secret"`), []byte(`"client_secret": "legacy-plaintext-secret", "client_secret_ref": {"provider":"os-keyring","key":"existing"}`), 1)
	if err := os.WriteFile(credentialsPath, data, privateFileMode); err != nil {
		t.Fatal(err)
	}
	registry, provider := newMemorySecretProviderRegistry()

	err = runConfigMigrateCmdWithRegistry(
		io.Discard,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("ambiguous credentials error = %v", err)
	}
	if len(provider.values) != 0 {
		t.Fatalf("ambiguous credentials stored secrets: %+v", provider.values)
	}
}

func TestConfigMigrateRollsBackWhenEnvironmentWriteFails(t *testing.T) {
	credentialsPath, envPath := writeLegacyMigrationFixture(t)
	original, err := os.ReadFile(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(envPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(envPath, 0o700); err != nil {
		t.Fatal(err)
	}
	registry, provider := newMemorySecretProviderRegistry()

	err = runConfigMigrateCmdWithRegistry(
		io.Discard,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "remove plaintext secret from agent env") {
		t.Fatalf("environment write error = %v", err)
	}
	restored, readErr := os.ReadFile(credentialsPath)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !bytes.Equal(restored, original) {
		t.Fatalf("credentials were not restored:\n%s", restored)
	}
	if len(provider.values) != 0 {
		t.Fatalf("stored secret was not rolled back: %+v", provider.values)
	}
}

func TestConfigMigrateRejectsUnavailableDestination(t *testing.T) {
	credentialsPath, _ := writeLegacyMigrationFixture(t)
	registry := NewSecretProviderRegistry()
	registry.Register(osKeyringProviderName, failingReadSecretProvider{})
	var output bytes.Buffer

	err := runConfigMigrateCmdWithRegistry(
		&output,
		credentialsPath,
		"",
		"",
		false,
		registry,
		defaultConfigMigrations(),
	)
	if err == nil || !strings.Contains(err.Error(), "inspect destination secret") {
		t.Fatalf("migration error = %v", err)
	}
}

type failingReadSecretProvider struct{}

func (failingReadSecretProvider) Get(string) (string, error) {
	return "", errors.New("provider unavailable")
}

func (failingReadSecretProvider) Set(string, string) error { return nil }

func (failingReadSecretProvider) Delete(string) error { return nil }

func TestConfigMigrateHelp(t *testing.T) {
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
