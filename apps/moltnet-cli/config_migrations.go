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

const migrationDestinationParameter = "destination"

func newConfigMigrationEngine(migrations []configMigration, destination string) configmigrate.Engine[*SecretProviderRegistry] {
	return configmigrate.Engine[*SecretProviderRegistry]{
		GeneratedBy:    "moltnet@" + version,
		MaxConfigBytes: maxMigrationConfigBytes,
		Parameters:     map[string]string{migrationDestinationParameter: destination},
		Migrations:     migrations,
	}
}

func runConfigMigrateCmd(w io.Writer, credPath, generatePath, runPath, destination string, dryRun bool, names ...string) error {
	name := ""
	if len(names) > 0 {
		name = names[0]
	}
	registry := NewSecretProviderRegistry()
	destination, err := validateMigrationDestination(registry, destination)
	if err != nil {
		return err
	}
	// Store migration is deliberately opt-in through an explicit path. Its alias
	// is inferred from .moltnet/<alias>/moltnet.json when possible; --name is
	// only needed for a credentials document outside that legacy layout.
	if strings.TrimSpace(credPath) != "" && destination == defaultMigrationDestination && generatePath == "" && runPath == "" {
		credentialsPath, pathErr := absolutePath(credPath)
		if pathErr != nil {
			return pathErr
		}
		migrated, migrateErr := migrateLegacyIdentityStore(credentialsPath, name, dryRun)
		if migrateErr != nil {
			return migrateErr
		}
		if migrated != nil {
			if err := printJSONTo(w, migrated); err != nil {
				return err
			}
			// Relocation and secret hardening are orthogonal, and an operator
			// following the documented upgrade path wants both. Returning here
			// silently skipped the plaintext->keyring migration, leaving the
			// legacy client_secret and seed copied verbatim into the new
			// location. Continue against the relocated document instead.
			if dryRun {
				return nil
			}
			if destPath, ok := migrated["destination"].(string); ok && destPath != "" {
				credPath = destPath
			}
		}
	}
	return runConfigMigrateCmdWithRegistry(
		w,
		credPath,
		generatePath,
		runPath,
		destination,
		dryRun,
		registry,
		defaultConfigMigrations(destination),
	)
}

func runConfigMigrateCmdWithRegistry(
	w io.Writer,
	credPath, generatePath, runPath, destination string,
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
		return runAndPrintConfigMigrationPlan(w, plan, destination, secretProviders, migrations)
	}

	plan, err := buildConfigMigrationPlan(credentialsPath, destination, migrations)
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
	return runAndPrintConfigMigrationPlan(w, plan, destination, secretProviders, migrations)
}

func runAndPrintConfigMigrationPlan(
	w io.Writer,
	plan configMigrationPlan,
	destination string,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
) error {
	applied, err := applyConfigMigrationPlan(plan, destination, secretProviders, migrations)
	output := configMigrationRunOutput{
		Plan:    plan,
		Applied: applied,
		Changed: len(applied) > 0,
	}
	if err == nil && len(applied) > 0 {
		output.NextMigration = nextPendingMigration(plan.CredentialsPath, destination, migrations)
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

func buildConfigMigrationPlan(credentialsPath, destination string, migrations []configMigration) (configMigrationPlan, error) {
	return newConfigMigrationEngine(migrations, destination).BuildPlan(credentialsPath)
}

func applyConfigMigrationPlan(
	plan configMigrationPlan,
	destination string,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
) ([]string, error) {
	return newConfigMigrationEngine(migrations, destination).Apply(plan, secretProviders)
}

func writeConfigMigrationPlan(path string, plan configMigrationPlan) error {
	return configmigrate.WritePlan(path, plan)
}

// nextPendingMigration re-plans against the document this run just rewrote, so
// a caller learns immediately that the configuration is still behind instead of
// discovering it on some later command. Detection is advisory: any failure here
// must not turn a successful migration into a reported one.
func nextPendingMigration(credentialsPath, destination string, migrations []configMigration) *configmigrate.PlannedMigration {
	plan, err := buildConfigMigrationPlan(credentialsPath, destination, migrations)
	if err != nil || len(plan.Migrations) == 0 {
		return nil
	}
	next := plan.Migrations[0]
	return &next
}

// pendingConfigMigrationNotice returns the advisory line to show before a
// command runs, or "" when nothing is pending.
//
// Deliberately detect-only. A migration relocates secrets into a provider and
// the plan format exists to be inspected before it is applied, so applying one
// as a side effect of an unrelated command would move credentials without
// consent — on macOS that can raise a keychain prompt mid-command. Telling the
// user is the useful half; deciding stays theirs.
//
// Every failure path is silent: most invocations have no credentials at all,
// and a configuration check must never become the reason a command complains.
func pendingConfigMigrationNotice(explicitCredentialsPath string) string {
	credentialsPath, err := resolveCredentialsPath(explicitCredentialsPath)
	if err != nil {
		return ""
	}
	destination := defaultMigrationDestination
	// Applies() reads only the credentials document, never the engine
	// parameters, so detection does not depend on where secrets would land.
	next := nextPendingMigration(credentialsPath, destination, defaultConfigMigrations(destination))
	if next == nil {
		return ""
	}
	// Both commands, not just the plan: a pending migration usually means
	// credentials are still sitting in a weaker place than they should be, so
	// the notice has to make acting on it as easy as reading about it.
	return fmt.Sprintf(
		"warning: a MoltNet configuration migration is pending (%s).\n  inspect: moltnet config migrate --credentials %s --dry-run\n  apply:   moltnet config migrate --credentials %s\n",
		next.ID,
		credentialsPath,
		credentialsPath,
	)
}
