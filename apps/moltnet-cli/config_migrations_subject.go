package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

const subjectAnchorMigrationID = "2026-09-subject-id-anchor"

type subjectSecretMove struct {
	source      SecretReference
	destination SecretReference
	value       string
}

func newSubjectAnchorMigration(verified *subjectVerification) configMigration {
	return configMigration{
		ID:          subjectAnchorMigrationID,
		Description: "Anchor agent credentials and provider keys to the durable subject",
		Operations: []string{
			"authenticate the configured credential and bind the plan to its agent subject",
			"copy and verify legacy OAuth2 and agent-key secrets under subject-derived keys",
			"atomically write subject_id and subject_type and remove identity_id",
			"delete writable legacy provider entries only after the canonical config is durable",
		},
		Applies: func(ctx configMigrationContext) (bool, error) {
			creds, raw, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return false, err
			}
			_, hasLegacyIdentity := raw["identity_id"]
			return hasLegacyIdentity || strings.TrimSpace(creds.SubjectID) == "" || creds.SubjectType != SubjectTypeAgent, nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			if verified == nil || verified.SubjectType != SubjectTypeAgent || strings.TrimSpace(verified.SubjectID) == "" {
				return migrationStageError("verify_subject", configmigrate.FailureState{}, fmt.Errorf("subject migration requires an authenticated agent subject"))
			}
			creds, raw, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return migrationStageError("parse_credentials", configmigrate.FailureState{}, err)
			}
			if strings.TrimSpace(creds.Keys.PublicKey) != strings.TrimSpace(verified.PublicKey) ||
				strings.TrimSpace(creds.Keys.Fingerprint) != strings.TrimSpace(verified.Fingerprint) {
				return migrationStageError("verify_subject", configmigrate.FailureState{}, fmt.Errorf("local signing key does not match authenticated subject"))
			}

			moves, oauthRef, agentRef, err := planSubjectSecretMoves(creds, verified.SubjectID, providers)
			if err != nil {
				return migrationStageError("resolve_sources", configmigrate.FailureState{Retryable: true}, err)
			}
			stored := false
			for index := range moves {
				changed, ensureErr := providers.Ensure(moves[index].destination, moves[index].value)
				stored = stored || changed
				if ensureErr != nil {
					state := retainedRetryableState(stored)
					if changed {
						state = retainedSecretState(true)
					}
					return migrationStageError("ensure_destinations", state, ensureErr)
				}
			}

			updated, err := rewriteCredentialsDocument(raw, func(top map[string]json.RawMessage) error {
				subjectID, _ := json.Marshal(verified.SubjectID)
				subjectType, _ := json.Marshal(SubjectTypeAgent)
				top["subject_id"] = subjectID
				top["subject_type"] = subjectType
				delete(top, "identity_id")
				if oauthRef != nil {
					if err := rewriteReferenceSection(top, "oauth2", "client_secret_ref", *oauthRef); err != nil {
						return err
					}
				}
				if agentRef != nil {
					encoded, marshalErr := json.Marshal(agentRef)
					if marshalErr != nil {
						return marshalErr
					}
					top["agent_key_ref"] = encoded
				}
				return nil
			})
			if err != nil {
				return migrationStageError("prepare_credentials", retainedRetryableState(stored), err)
			}
			if err := ctx.ReplaceCredentials(updated); err != nil {
				return migrationStageError("replace_credentials", retainedRetryableState(stored), err)
			}
			for _, move := range moves {
				if move.source == move.destination || !providers.CanWrite(move.source.Provider) {
					continue
				}
				if err := providers.Delete(move.source); err != nil {
					return migrationStageError("delete_legacy_sources", configmigrate.FailureState{Changed: true, ManualRecoveryRequired: true}, fmt.Errorf("delete %s:%s: %w", move.source.Provider, move.source.Key, err))
				}
			}
			return nil
		},
	}
}

func planSubjectSecretMoves(creds *CredentialsFile, subjectID string, providers *SecretProviderRegistry) ([]subjectSecretMove, *SecretReference, *SecretReference, error) {
	moves := make([]subjectSecretMove, 0, 2)
	plan := func(kind credentialKind, source *SecretReference, clientID string) (*SecretReference, error) {
		if source == nil {
			return nil, nil
		}
		canonicalKey, err := expectedSecretKey(kind, credentialBindingIDs{SubjectID: subjectID, ClientID: clientID})
		if err != nil {
			return nil, err
		}
		canonical := SecretReference{Provider: source.Provider, Key: canonicalKey}
		if *source == canonical {
			return &canonical, nil
		}
		if source.Provider == environmentProviderName {
			if source.Key != credentialEnvKey(kind) {
				return nil, fmt.Errorf("%s reference is not the fixed environment reference", kind)
			}
			return source, nil
		}
		legacyKey, err := expectedSecretKey(kind, credentialBindingIDs{LegacyIdentityID: creds.legacyIdentityID, ClientID: clientID})
		if err != nil {
			return nil, fmt.Errorf("validate legacy %s reference: %w", kind, err)
		}
		if err := validateSecretReferenceBoundTo(*source, secretReferenceBinding{canonicalKey: legacyKey, description: fmt.Sprintf("%s reference is not bound to the legacy identity", kind)}); err != nil {
			return nil, err
		}
		value, err := providers.Resolve(*source)
		if err != nil {
			return nil, err
		}
		moves = append(moves, subjectSecretMove{source: *source, destination: canonical, value: value})
		return &canonical, nil
	}
	oauthRef, err := plan(credentialOAuth2ClientSecret, creds.OAuth2.ClientSecretRef, creds.OAuth2.ClientID)
	if err != nil {
		return nil, nil, nil, err
	}
	agentRef, err := plan(credentialAgentKey, creds.AgentKeyRef, "")
	return moves, oauthRef, agentRef, err
}

func rewriteReferenceSection(top map[string]json.RawMessage, sectionName, field string, ref SecretReference) error {
	section := make(map[string]json.RawMessage)
	if raw := top[sectionName]; raw != nil {
		if err := json.Unmarshal(raw, &section); err != nil {
			return err
		}
	}
	encoded, err := json.Marshal(ref)
	if err != nil {
		return err
	}
	section[field] = encoded
	top[sectionName], err = json.Marshal(section)
	return err
}
