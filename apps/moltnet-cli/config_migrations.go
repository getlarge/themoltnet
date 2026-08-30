package main

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

const (
	maxMigrationPlanBytes   = 1 << 20
	maxMigrationConfigBytes = 4 << 20
)

type configMigration = configmigrate.Migration[*SecretProviderRegistry]
type configMigrationContext = configmigrate.Context
type configMigrationPlan = configmigrate.Plan
type configMigrationRunOutput = configmigrate.RunOutput

const defaultMigrationDestination = osKeyringProviderName

// defaultConfigMigrations returns the ordered transitions. Secret-moving
// migrations store values in the destination provider; the destination is
// part of each planned operation text, so a plan generated for one
// destination cannot be run against another.
func defaultConfigMigrations(destination string) []configMigration {
	return []configMigration{
		newOAuth2SecretReferenceMigration(destination),
		newOAuth2EnvironmentCleanupMigration(),
		newIdentitySeedReferenceMigration(destination),
		newGitHubPEMReferenceMigration(destination),
	}
}

// validateMigrationDestination rejects destinations that cannot receive
// secrets before any credentials are read.
func validateMigrationDestination(registry *SecretProviderRegistry, destination string) (string, error) {
	destination = strings.TrimSpace(destination)
	if destination == "" {
		destination = defaultMigrationDestination
	}
	if registry == nil || !registry.CanWrite(destination) {
		switch destination {
		case environmentProviderName:
			return "", fmt.Errorf("--destination %q is read-only; choose a provider that stores secrets", destination)
		case fileProviderName:
			return "", fmt.Errorf("--destination %q requires %s and %s=1", destination, secretRootEnv, secretRootWritableEnv)
		default:
			return "", fmt.Errorf("--destination %q is not a writable secret provider", destination)
		}
	}
	return destination, nil
}

func newConfigMigrationEngine(migrations []configMigration) configmigrate.Engine[*SecretProviderRegistry] {
	return configmigrate.Engine[*SecretProviderRegistry]{
		GeneratedBy:    "moltnet@" + version,
		MaxConfigBytes: maxMigrationConfigBytes,
		Migrations:     migrations,
	}
}

func runConfigMigrateCmd(w io.Writer, credPath, generatePath, runPath, destination string, dryRun bool) error {
	registry := NewSecretProviderRegistry()
	destination, err := validateMigrationDestination(registry, destination)
	if err != nil {
		return err
	}
	return runConfigMigrateCmdWithRegistry(
		w,
		credPath,
		generatePath,
		runPath,
		dryRun,
		registry,
		defaultConfigMigrations(destination),
	)
}

func runConfigMigrateCmdWithRegistry(
	w io.Writer,
	credPath, generatePath, runPath string,
	dryRun bool,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
) error {
	if dryRun && (generatePath != "" || runPath != "") {
		return fmt.Errorf("--dry-run cannot be combined with --generate or --run")
	}
	if generatePath != "" && runPath != "" {
		return fmt.Errorf("--generate and --run are mutually exclusive")
	}
	credentialsPath, err := resolveCredentialsPath(credPath)
	if err != nil {
		return err
	}

	if runPath != "" {
		plan, err := configmigrate.ReadPlan(runPath, maxMigrationPlanBytes)
		if err != nil {
			return err
		}
		if filepath.Clean(plan.CredentialsPath) != filepath.Clean(credentialsPath) {
			return fmt.Errorf("migration plan targets %s, not %s", plan.CredentialsPath, credentialsPath)
		}
		return runAndPrintConfigMigrationPlan(w, plan, secretProviders, migrations)
	}

	plan, err := buildConfigMigrationPlan(credentialsPath, migrations)
	if err != nil {
		return err
	}
	if dryRun {
		return printJSONTo(w, plan)
	}
	if generatePath != "" {
		if err := configmigrate.WritePlan(generatePath, plan); err != nil {
			return err
		}
		return printJSONTo(w, plan)
	}
	return runAndPrintConfigMigrationPlan(w, plan, secretProviders, migrations)
}

func runAndPrintConfigMigrationPlan(
	w io.Writer,
	plan configMigrationPlan,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
) error {
	applied, err := applyConfigMigrationPlan(plan, secretProviders, migrations)
	output := configMigrationRunOutput{
		Plan:    plan,
		Applied: applied,
		Changed: len(applied) > 0,
	}
	if err != nil {
		output.Failure = configmigrate.FailureFromError(plan, err)
		output.ManualRecoveryRequired = output.Failure.ManualRecoveryRequired
		output.Changed = output.Changed || output.Failure.Changed
		if printErr := printJSONTo(w, output); printErr != nil {
			return errors.Join(errors.New("configuration migration failed"), printErr)
		}
		return errors.New(output.Failure.Message)
	}
	return printJSONTo(w, output)
}

func buildConfigMigrationPlan(credentialsPath string, migrations []configMigration) (configMigrationPlan, error) {
	return newConfigMigrationEngine(migrations).BuildPlan(credentialsPath)
}

func applyConfigMigrationPlan(
	plan configMigrationPlan,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
) ([]string, error) {
	return newConfigMigrationEngine(migrations).Apply(plan, secretProviders)
}

func writeConfigMigrationPlan(path string, plan configMigrationPlan) error {
	return configmigrate.WritePlan(path, plan)
}
