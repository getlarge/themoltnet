package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

// newIdentitySeedReferenceMigration moves the plaintext Ed25519 seed from
// keys.private_key into a provider-backed keys.private_key_ref.
func newIdentitySeedReferenceMigration(destinationProvider string) configMigration {
	return configMigration{
		ID:          "2026-09-identity-seed-reference",
		Description: "Move the plaintext identity private key into a provider-backed reference",
		Operations: []string{
			"verify the identity seed derives keys.public_key",
			fmt.Sprintf("store and verify the identity seed in the %q provider", destinationProvider),
			"replace keys.private_key with keys.private_key_ref",
		},
		Applies: func(ctx configMigrationContext) (bool, error) {
			creds, _, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return false, err
			}
			legacy := strings.TrimSpace(creds.Keys.PrivateKey)
			if legacy != "" && creds.Keys.PrivateKeyRef != nil {
				return false, fmt.Errorf("keys config must set exactly one of private_key or private_key_ref")
			}
			if legacy == "" {
				return false, nil
			}
			if creds.Keys.Fingerprint == "" || creds.Keys.PublicKey == "" {
				return false, fmt.Errorf("plaintext identity private key requires keys.fingerprint and keys.public_key")
			}
			return true, nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			creds, rawDocument, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return migrationStageError("parse_credentials", configmigrate.FailureState{}, err)
			}
			seed := strings.TrimSpace(creds.Keys.PrivateKey)
			if err := assertSeedMatchesPublicKey(seed, creds.Keys.PublicKey); err != nil {
				return migrationStageError("verify_seed", configmigrate.FailureState{}, err)
			}
			ref := SecretReference{
				Provider: destinationProvider,
				Key:      IdentitySeedKey(creds.Keys.Fingerprint),
			}
			stored, err := providers.Ensure(ref, seed)
			if err != nil {
				return migrationStageError("ensure_secret", retainedSecretState(stored), err)
			}
			updated, err := rewriteCredentialsSection(rawDocument, "keys", func(section map[string]json.RawMessage) error {
				refJSON, err := json.Marshal(ref)
				if err != nil {
					return err
				}
				section["private_key_ref"] = refJSON
				delete(section, "private_key")
				return nil
			})
			if err != nil {
				return migrationStageError("prepare_credentials", retainedSecretState(stored), err)
			}
			if err := ctx.ReplaceCredentials(updated); err != nil {
				return migrationStageError("replace_credentials", retainedSecretState(stored), err)
			}
			return nil
		},
	}
}

// newGitHubPEMReferenceMigration stores the GitHub App private key read from
// github.private_key_path in a provider and rewrites the config to
// github.private_key_ref. The PEM file itself is never removed.
func newGitHubPEMReferenceMigration(destinationProvider string) configMigration {
	return configMigration{
		ID:          "2026-09-github-pem-reference",
		Description: "Move the GitHub App private key file into a provider-backed reference",
		Operations: []string{
			"read github.private_key_path and verify it is an RSA private key",
			fmt.Sprintf("store and verify the GitHub App private key in the %q provider", destinationProvider),
			"replace github.private_key_path with github.private_key_ref",
			"leave the original PEM file in place; remove it manually once 'moltnet github token' works",
		},
		Applies: func(ctx configMigrationContext) (bool, error) {
			creds, _, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return false, err
			}
			if creds.GitHub == nil {
				return false, nil
			}
			path := strings.TrimSpace(creds.GitHub.PrivateKeyPath)
			if path != "" && creds.GitHub.PrivateKeyRef != nil {
				return false, fmt.Errorf("github config must set exactly one of private_key_path or private_key_ref")
			}
			if path == "" {
				return false, nil
			}
			if creds.GitHub.AppID == "" {
				return false, fmt.Errorf("github.private_key_path requires github.app_id")
			}
			return true, nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			creds, rawDocument, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return migrationStageError("parse_credentials", configmigrate.FailureState{}, err)
			}
			pemData, err := configmigrate.ReadBoundedRegularFile(strings.TrimSpace(creds.GitHub.PrivateKeyPath), maxMigrationConfigBytes)
			if err != nil {
				return migrationStageError("read_pem", configmigrate.FailureState{Retryable: true}, fmt.Errorf("read GitHub App private key: %w", err))
			}
			if _, err := parseRSAPrivateKey(pemData); err != nil {
				return migrationStageError("verify_pem", configmigrate.FailureState{}, fmt.Errorf("github.private_key_path is not an RSA private key PEM"))
			}
			ref := SecretReference{
				Provider: destinationProvider,
				Key:      GitHubAppPrivateKeyKey(creds.GitHub.AppID),
			}
			// Providers may normalize a single trailing newline on read (the
			// file provider does), so store the PEM without one; every PEM
			// parser accepts the trimmed form.
			stored, err := providers.Ensure(ref, strings.TrimRight(string(pemData), "\r\n"))
			if err != nil {
				return migrationStageError("ensure_secret", retainedSecretState(stored), err)
			}
			updated, err := rewriteCredentialsSection(rawDocument, "github", func(section map[string]json.RawMessage) error {
				refJSON, err := json.Marshal(ref)
				if err != nil {
					return err
				}
				section["private_key_ref"] = refJSON
				delete(section, "private_key_path")
				return nil
			})
			if err != nil {
				return migrationStageError("prepare_credentials", retainedSecretState(stored), err)
			}
			if err := ctx.ReplaceCredentials(updated); err != nil {
				return migrationStageError("replace_credentials", retainedSecretState(stored), err)
			}
			return nil
		},
	}
}

// rewriteCredentialsSection applies mutate to one top-level object of the raw
// credentials document and re-serializes it, preserving every other field.
func rewriteCredentialsSection(
	document map[string]json.RawMessage,
	name string,
	mutate func(section map[string]json.RawMessage) error,
) ([]byte, error) {
	updated := make(map[string]json.RawMessage, len(document))
	for key, value := range document {
		updated[key] = value
	}
	section := make(map[string]json.RawMessage)
	if raw := updated[name]; raw != nil {
		if err := json.Unmarshal(raw, &section); err != nil {
			return nil, fmt.Errorf("parse %s credentials: %w", name, err)
		}
	}
	if err := mutate(section); err != nil {
		return nil, fmt.Errorf("update %s credentials: %w", name, err)
	}
	sectionJSON, err := json.Marshal(section)
	if err != nil {
		return nil, fmt.Errorf("marshal %s credentials: %w", name, err)
	}
	updated[name] = sectionJSON
	data, err := json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal credentials: %w", err)
	}
	return append(data, '\n'), nil
}
