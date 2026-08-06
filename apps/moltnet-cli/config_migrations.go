package main

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"

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

func defaultConfigMigrations() []configMigration {
	return []configMigration{
		newOAuth2SecretReferenceMigration(osKeyringProviderName),
		newOAuth2EnvironmentCleanupMigration(),
	}
}

func newConfigMigrationEngine(migrations []configMigration) configmigrate.Engine[*SecretProviderRegistry] {
	return configmigrate.Engine[*SecretProviderRegistry]{
		GeneratedBy:    "moltnet@" + version,
		MaxConfigBytes: maxMigrationConfigBytes,
		Migrations:     migrations,
	}
}

func runConfigMigrateCmd(w io.Writer, credPath, generatePath, runPath string, dryRun bool) error {
	return runConfigMigrateCmdWithRegistry(
		w,
		credPath,
		generatePath,
		runPath,
		dryRun,
		NewSecretProviderRegistry(),
		defaultConfigMigrations(),
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
		if printErr := printJSONTo(w, output); printErr != nil {
			return errors.Join(err, printErr)
		}
		return err
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
