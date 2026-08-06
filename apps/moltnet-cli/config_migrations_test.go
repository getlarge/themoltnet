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
