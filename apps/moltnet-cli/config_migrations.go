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

func subjectAwareConfigMigrations(destination string) []configMigration {
	return append(defaultConfigMigrations(destination), newSubjectAnchorMigration(nil))
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

const (
	migrationSubjectIDParameter   = "subject_id"
	migrationSubjectTypeParameter = "subject_type"
)

func newConfigMigrationEngine(migrations []configMigration, destination string, verified ...*subjectVerification) configmigrate.Engine[*SecretProviderRegistry] {
	parameters := map[string]string{migrationDestinationParameter: destination}
	if len(verified) > 0 && verified[0] != nil {
		parameters[migrationSubjectIDParameter] = verified[0].SubjectID
		parameters[migrationSubjectTypeParameter] = string(verified[0].SubjectType)
	}
	return configmigrate.Engine[*SecretProviderRegistry]{
		GeneratedBy:    "moltnet@" + version,
		MaxConfigBytes: maxMigrationConfigBytes,
		Parameters:     parameters,
		Migrations:     migrations,
	}
}

func runConfigMigrateCmd(w, errOut io.Writer, credPath, generatePath, runPath, destination string, dryRun bool, names ...string) error {
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
	relocatable := strings.TrimSpace(credPath) != ""
	if relocatable && !(destination == defaultMigrationDestination && generatePath == "" && runPath == "") {
		// Relocation is silent otherwise, so `--destination file` or a
		// generated plan reports a successful migration while the identity
		// stays where it was.
		// Advisory, so it follows the same discipline as the pending-migration
		// notice: the command's own error stream, and only for a human at a
		// terminal. A raw os.Stderr write would surface in a script's 2>&1.
		if isTerminalWriter(errOut) {
			fmt.Fprintf(errOut,
				"note: central identity relocation skipped (it runs only with the default "+
					"destination and without --generate/--run); run 'moltnet config migrate "+
					"--credentials %s' on its own to relocate.\n", credPath)
		}
	}
	if relocatable && destination == defaultMigrationDestination && generatePath == "" && runPath == "" {
		credentialsPath, pathErr := absolutePath(credPath)
		if pathErr != nil {
			return pathErr
		}
		migrated, migrateErr := migrateLegacyIdentityStore(credentialsPath, name, dryRun)
		if migrateErr != nil {
			return migrateErr
		}
		if migrated != nil {
			if dryRun {
				// Nothing follows, so the relocation plan IS the result.
				if err := printJSONTo(w, migrated); err != nil {
					return err
				}
				return nil
			}
			// The secret migration below writes the command's single parseable
			// result to stdout. Relocation is an outcome, not a second result:
			// emitting both left automation parsing two concatenated JSON
			// documents. It goes to the command's error stream — deliberately
			// NOT terminal-gated, unlike the advisory above, because a script
			// still needs to know the identity moved.
			if err := printJSONTo(errOut, migrated); err != nil {
				return err
			}
			// Relocation and secret hardening are orthogonal, and an operator
			// following the documented upgrade path wants both. Returning here
			// silently skipped the plaintext->keyring migration, leaving the
			// legacy client_secret and seed copied verbatim into the new
			// location. Continue against the relocated document instead.
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
		subjectAwareConfigMigrations(destination),
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
		verified, boundMigrations, err := bindSubjectMigrationPlan(plan, credentialsPath, secretProviders, migrations)
		if err != nil {
			return err
		}
		return runAndPrintConfigMigrationPlan(w, plan, destination, secretProviders, boundMigrations, verified)
	}

	plan, err := buildConfigMigrationPlan(credentialsPath, destination, migrations)
	if err != nil {
		return err
	}
	verified, migrations, err := bindSubjectMigrationPlan(plan, credentialsPath, secretProviders, migrations)
	if err != nil {
		return err
	}
	if verified != nil {
		plan, err = buildConfigMigrationPlan(credentialsPath, destination, migrations, verified)
		if err != nil {
			return err
		}
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
	return runAndPrintConfigMigrationPlan(w, plan, destination, secretProviders, migrations, verified)
}

func runAndPrintConfigMigrationPlan(
	w io.Writer,
	plan configMigrationPlan,
	destination string,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
	verified ...*subjectVerification,
) error {
	applied, err := applyConfigMigrationPlan(plan, destination, secretProviders, migrations, verified...)
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

func buildConfigMigrationPlan(credentialsPath, destination string, migrations []configMigration, verified ...*subjectVerification) (configMigrationPlan, error) {
	return newConfigMigrationEngine(migrations, destination, verified...).BuildPlan(credentialsPath)
}

func applyConfigMigrationPlan(
	plan configMigrationPlan,
	destination string,
	secretProviders *SecretProviderRegistry,
	migrations []configMigration,
	verified ...*subjectVerification,
) ([]string, error) {
	return newConfigMigrationEngine(migrations, destination, verified...).Apply(plan, secretProviders)
}

func bindSubjectMigrationPlan(plan configMigrationPlan, credentialsPath string, registry *SecretProviderRegistry, migrations []configMigration) (*subjectVerification, []configMigration, error) {
	if len(plan.Migrations) == 0 || plan.Migrations[0].ID != subjectAnchorMigrationID {
		return nil, migrations, nil
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return nil, nil, fmt.Errorf("read credentials for subject migration: %w", err)
	}
	if creds == nil {
		return nil, nil, fmt.Errorf("read credentials for subject migration: config not found at %s", credentialsPath)
	}
	apiURL := strings.TrimSpace(creds.Endpoints.API)
	if apiURL == "" {
		return nil, nil, fmt.Errorf("subject migration requires endpoints.api")
	}
	verified, err := verifyConfigIdentityAgainstServer(apiURL, credentialsPath, creds, registry)
	if err != nil {
		return nil, nil, err
	}
	bound := append([]configMigration(nil), migrations...)
	for index := range bound {
		if bound[index].ID == subjectAnchorMigrationID {
			bound[index] = newSubjectAnchorMigration(verified)
		}
	}
	return verified, bound, nil
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
	next := nextPendingMigration(credentialsPath, destination, subjectAwareConfigMigrations(destination))
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
