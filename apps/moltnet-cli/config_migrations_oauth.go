package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

func newOAuth2SecretReferenceMigration(destinationProvider string) configMigration {
	const migrationID = "2026-08-oauth2-secret-reference"
	return configMigration{
		ID:          migrationID,
		Description: "Move the plaintext OAuth2 client secret into a provider-backed reference",
		Operations: []string{
			"store and verify the OAuth2 client secret in the destination provider",
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
		return migrationStageError("parse_credentials", "not-required", false, err)
	}
	ref := SecretReference{
		Provider: destinationProvider,
		Key:      OAuth2SecretKey(creds.IdentityID, creds.OAuth2.ClientID),
	}
	storedNewValue := false
	existing, resolveErr := providers.Resolve(ref)
	switch {
	case resolveErr == nil && existing != creds.OAuth2.ClientSecret:
		return migrationStageError("inspect_destination", "not-required", false, fmt.Errorf("destination already contains a different secret"))
	case resolveErr == nil:
		// Resume safely when an interrupted run already stored the same value.
	case errors.Is(resolveErr, ErrSecretNotFound):
		if err := providers.Store(ref, creds.OAuth2.ClientSecret); err != nil {
			return migrationStageError("store_secret", "not-required", true, fmt.Errorf("store OAuth2 client secret: %w", err))
		}
		storedNewValue = true
	default:
		return migrationStageError("inspect_destination", "not-required", true, fmt.Errorf("inspect destination secret: %w", resolveErr))
	}

	verified, err := providers.Resolve(ref)
	if err != nil || verified != creds.OAuth2.ClientSecret {
		rollback := rollbackNewSecret(providers, ref, storedNewValue)
		if err != nil {
			return migrationStageError("verify_secret", rollback, true, fmt.Errorf("verify destination secret: %w", err))
		}
		return migrationStageError("verify_secret", rollback, true, fmt.Errorf("verify destination secret: stored value does not match"))
	}

	updated, err := updateCredentialsDocumentReference(rawDocument, creds.OAuth2.ClientID, ref)
	if err != nil {
		rollback := rollbackNewSecret(providers, ref, storedNewValue)
		return migrationStageError("prepare_credentials", rollback, true, err)
	}
	if err := ctx.ReplaceCredentials(updated); err != nil {
		rollback := rollbackSecretIfSourceUnchanged(ctx, providers, ref, storedNewValue)
		return migrationStageError("replace_credentials", rollback, true, err)
	}
	return nil
}

func rollbackSecretIfSourceUnchanged(
	ctx configMigrationContext,
	providers *SecretProviderRegistry,
	ref SecretReference,
	storedNewValue bool,
) string {
	if !storedNewValue {
		return "not-required"
	}
	current, err := configmigrate.ReadBoundedRegularFile(ctx.CredentialsPath, maxMigrationConfigBytes)
	if err != nil || !bytes.Equal(current, ctx.CredentialsDocument) {
		return "secret-retained-source-changed"
	}
	return rollbackNewSecret(providers, ref, true)
}

func rollbackNewSecret(registry *SecretProviderRegistry, ref SecretReference, stored bool) string {
	if !stored {
		return "not-required"
	}
	if err := registry.Delete(ref); err != nil {
		return "failed-secret-retained"
	}
	return "completed"
}

func migrationStageError(stage, rollback string, retryable bool, err error) error {
	return configmigrate.NewStageError(stage, rollback, retryable, err)
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
		Run: func(ctx configMigrationContext, _ *SecretProviderRegistry) error {
			envPath, key, ok, err := oauth2EnvironmentCleanupTarget(ctx)
			if err != nil {
				return migrationStageError("inspect_environment", "not-required", true, err)
			}
			if !ok {
				return migrationStageError("inspect_environment", "not-required", false, fmt.Errorf("credentials are not reference-backed agent credentials"))
			}
			data, err := configmigrate.ReadOptionalBoundedRegularFile(envPath, maxMigrationConfigBytes)
			if err != nil {
				return migrationStageError("inspect_environment", "not-required", true, err)
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
				".moltnet-env-*",
			); err != nil {
				return migrationStageError("replace_environment", "not-required", true, err)
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

func updateCredentialsDocumentReference(
	document map[string]json.RawMessage,
	clientID string,
	ref SecretReference,
) ([]byte, error) {
	updated := make(map[string]json.RawMessage, len(document))
	for key, value := range document {
		updated[key] = value
	}
	var oauth2 map[string]json.RawMessage
	if raw := updated["oauth2"]; raw != nil {
		if err := json.Unmarshal(raw, &oauth2); err != nil {
			return nil, fmt.Errorf("parse oauth2 credentials: %w", err)
		}
	}
	if oauth2 == nil {
		oauth2 = make(map[string]json.RawMessage)
	}
	clientIDJSON, _ := json.Marshal(clientID)
	refJSON, err := json.Marshal(ref)
	if err != nil {
		return nil, fmt.Errorf("marshal secret reference: %w", err)
	}
	oauth2["client_id"] = clientIDJSON
	oauth2["client_secret_ref"] = refJSON
	delete(oauth2, "client_secret")
	updated["oauth2"], err = json.Marshal(oauth2)
	if err != nil {
		return nil, fmt.Errorf("marshal oauth2 credentials: %w", err)
	}
	data, err := json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal credentials: %w", err)
	}
	return append(data, '\n'), nil
}
