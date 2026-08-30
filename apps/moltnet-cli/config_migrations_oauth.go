package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	"github.com/joho/godotenv"
)

func newOAuth2SecretReferenceMigration(destinationProvider string) configMigration {
	const migrationID = "2026-08-oauth2-secret-reference"
	return configMigration{
		ID:          migrationID,
		Description: "Move the plaintext OAuth2 client secret into a provider-backed reference",
		Operations: []string{
			fmt.Sprintf("store and verify the OAuth2 client secret in the %q provider", destinationProvider),
			"replace oauth2.client_secret with oauth2.client_secret_ref",
		},
		Applies: func(ctx configMigrationContext) (bool, error) {
			creds, _, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return false, err
			}
			if creds.OAuth2.ClientSecret != "" && creds.OAuth2.ClientSecretRef != nil {
				return false, fmt.Errorf("oauth2 config must set exactly one of client_secret or client_secret_ref")
			}
			if creds.OAuth2.ClientSecret == "" {
				return false, nil
			}
			if creds.IdentityID == "" || creds.OAuth2.ClientID == "" {
				return false, fmt.Errorf("plaintext OAuth2 credentials require identity_id and oauth2.client_id")
			}
			return true, nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			return migrateOAuth2SecretReference(ctx, providers, destinationProvider)
		},
	}
}

func migrateOAuth2SecretReference(
	ctx configMigrationContext,
	providers *SecretProviderRegistry,
	destinationProvider string,
) error {
	creds, rawDocument, err := parseCredentialsDocument(ctx.CredentialsDocument)
	if err != nil {
		return migrationStageError("parse_credentials", configmigrate.FailureState{}, err)
	}
	ref := SecretReference{
		Provider: destinationProvider,
		Key:      OAuth2SecretKey(creds.IdentityID, creds.OAuth2.ClientID),
	}
	storedNewValue, err := providers.Ensure(ref, creds.OAuth2.ClientSecret)
	if err != nil {
		return migrationStageError("ensure_secret", retainedSecretState(storedNewValue), err)
	}

	updated, err := rewriteCredentialsSection(rawDocument, "oauth2", func(section map[string]json.RawMessage) error {
		clientIDJSON, err := json.Marshal(creds.OAuth2.ClientID)
		if err != nil {
			return err
		}
		refJSON, err := json.Marshal(ref)
		if err != nil {
			return err
		}
		section["client_id"] = clientIDJSON
		section["client_secret_ref"] = refJSON
		delete(section, "client_secret")
		return nil
	})
	if err != nil {
		return migrationStageError("prepare_credentials", retainedRetryableState(storedNewValue), err)
	}
	if err := ctx.ReplaceCredentials(updated); err != nil {
		return migrationStageError("replace_credentials", retainedRetryableState(storedNewValue), err)
	}
	return nil
}

// retainedSecretState describes a failure inside Ensure itself: when the
// value was written but could not be verified, the operator has to inspect
// the destination before retrying.
func retainedSecretState(stored bool) configmigrate.FailureState {
	return configmigrate.FailureState{
		Retryable:              !stored,
		Changed:                stored,
		ManualRecoveryRequired: stored,
	}
}

// retainedRetryableState describes a failure after Ensure verified the
// destination: the secret is retained there (Changed) but re-running is safe
// because Ensure accepts the identical stored value, so nothing needs manual
// recovery.
func retainedRetryableState(stored bool) configmigrate.FailureState {
	return configmigrate.FailureState{
		Retryable: true,
		Changed:   stored,
	}
}

func migrationStageError(stage string, state configmigrate.FailureState, err error) error {
	return configmigrate.NewStageError(stage, state, err)
}

func newOAuth2EnvironmentCleanupMigration() configMigration {
	const migrationID = "2026-08-remove-managed-oauth2-env"
	return configMigration{
		ID:          migrationID,
		Description: "Remove the legacy managed OAuth2 client secret from the agent environment file",
		Operations:  []string{"atomically remove the managed client secret assignment from the agent environment file"},
		Applies: func(ctx configMigrationContext) (bool, error) {
			envPath, key, ok, err := oauth2EnvironmentCleanupTarget(ctx)
			if err != nil || !ok {
				return false, err
			}
			data, err := configmigrate.ReadOptionalBoundedRegularFile(envPath, maxMigrationConfigBytes)
			if err != nil {
				return false, err
			}
			return containsEnvAssignment(data, key), nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			envPath, key, ok, err := oauth2EnvironmentCleanupTarget(ctx)
			if err != nil {
				return migrationStageError("inspect_environment", configmigrate.FailureState{Retryable: true}, err)
			}
			if !ok {
				return migrationStageError("inspect_environment", configmigrate.FailureState{}, fmt.Errorf("credentials are not reference-backed agent credentials"))
			}
			creds, _, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return migrationStageError("inspect_credentials", configmigrate.FailureState{}, err)
			}
			ref := *creds.OAuth2.ClientSecretRef
			if err := validateOAuth2SecretReferenceBinding(creds, ref); err != nil {
				return migrationStageError("validate_reference", configmigrate.FailureState{}, err)
			}
			data, err := configmigrate.ReadOptionalBoundedRegularFile(envPath, maxMigrationConfigBytes)
			if err != nil {
				return migrationStageError("inspect_environment", configmigrate.FailureState{Retryable: true}, err)
			}
			env, err := godotenv.Unmarshal(string(data))
			if err != nil {
				return migrationStageError("parse_environment", configmigrate.FailureState{}, err)
			}
			legacyValue, found := env[key]
			if !found {
				return nil
			}
			resolved, err := providers.Resolve(ref)
			if err != nil {
				return migrationStageError("verify_reference", configmigrate.FailureState{Retryable: true}, err)
			}
			if resolved != legacyValue {
				return migrationStageError("verify_reference", configmigrate.FailureState{ManualRecoveryRequired: true}, fmt.Errorf("referenced secret does not match the legacy environment value"))
			}
			updated := removeEnvAssignment(data, key)
			if bytes.Equal(updated, data) {
				return nil
			}
			if err := configmigrate.ReplaceRegularFileAtomic(
				envPath,
				data,
				updated,
				maxMigrationConfigBytes,
			); err != nil {
				return migrationStageError("replace_environment", configmigrate.FailureState{Retryable: true}, err)
			}
			return nil
		},
	}
}

func oauth2EnvironmentCleanupTarget(ctx configMigrationContext) (string, string, bool, error) {
	creds, _, err := parseCredentialsDocument(ctx.CredentialsDocument)
	if err != nil {
		return "", "", false, err
	}
	if creds.OAuth2.ClientSecret != "" || creds.OAuth2.ClientSecretRef == nil {
		return "", "", false, nil
	}
	agentDir := filepath.Dir(ctx.CredentialsPath)
	if filepath.Base(filepath.Dir(agentDir)) != ".moltnet" {
		return "", "", false, nil
	}
	agentName := filepath.Base(agentDir)
	return filepath.Join(agentDir, "env"), toEnvPrefix(agentName) + "_CLIENT_SECRET", true, nil
}

func containsEnvAssignment(data []byte, key string) bool {
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSuffix(line, []byte("\r"))
		if bytes.HasPrefix(line, []byte(key+"=")) {
			return true
		}
	}
	return false
}

func removeEnvAssignment(data []byte, key string) []byte {
	lines := bytes.SplitAfter(data, []byte("\n"))
	result := make([]byte, 0, len(data))
	for _, line := range lines {
		trimmed := bytes.TrimSuffix(line, []byte("\n"))
		trimmed = bytes.TrimSuffix(trimmed, []byte("\r"))
		if bytes.HasPrefix(trimmed, []byte(key+"=")) {
			continue
		}
		result = append(result, line...)
	}
	return result
}

func parseCredentialsDocument(document []byte) (*CredentialsFile, map[string]json.RawMessage, error) {
	var creds CredentialsFile
	if err := json.Unmarshal(document, &creds); err != nil {
		return nil, nil, fmt.Errorf("parse credentials: %w", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(document, &raw); err != nil {
		return nil, nil, fmt.Errorf("parse credentials document: %w", err)
	}
	return &creds, raw, nil
}
