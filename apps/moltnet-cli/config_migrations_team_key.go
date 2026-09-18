package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	"github.com/google/uuid"
)

// This non-secret checkpoint prevents repeatedly proposing an identity-scoped
// fallback that cannot be narrowed by migration. Changing the source reference
// invalidates it. Normal key rotation preserves the credential's binding.
type indexedAgentKeyReference struct {
	Reference    SecretReference `json:"reference"`
	SubjectID    string          `json:"subjectId"`
	BindingScope string          `json:"bindingScope"`
	TeamID       string          `json:"teamId,omitempty"`
	KeyID        string          `json:"keyId"`
}

func newTeamKeyIndexMigration(destination string) configMigration {
	return configMigration{
		ID:          "2026-09-team-key-index",
		Description: "Index the authenticated legacy agent key by its team binding",
		Operations: []string{
			"authenticate the exact fallback key without OAuth2 or environment overrides",
			"verify its agent subject and discover its immutable credential binding",
			fmt.Sprintf("copy and verify team-bound keys in %q before updating the team map", destination),
			"retain the original fallback; identity-scoped keys require enrollment to obtain a team grant",
		},
		Applies: func(ctx configMigrationContext) (bool, error) {
			creds, raw, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return false, err
			}
			if creds.AgentKeyRef == nil {
				return false, nil
			}
			if _, ok := creds.CanonicalSubject(); !ok {
				return false, nil
			}
			var indexed indexedAgentKeyReference
			if data, ok := raw["agent_key_ref_verified"]; ok {
				if err := json.Unmarshal(data, &indexed); err != nil {
					return false, fmt.Errorf("invalid agent_key_ref_verified checkpoint")
				}
				if indexed.Reference == *creds.AgentKeyRef && indexed.SubjectID == creds.SubjectID && strings.TrimSpace(indexed.KeyID) != "" {
					if indexed.BindingScope == "identity" {
						return false, nil
					}
					if indexed.BindingScope == "team" && indexed.TeamID != "" {
						if ref, ok := creds.AgentKeyRefs[indexed.TeamID]; ok && ref == (SecretReference{Provider: destination, Key: TeamAgentKeyKey(creds.SubjectID, indexed.TeamID)}) {
							return false, nil
						}
					}
				}
			}
			return true, nil
		},
		Run: func(ctx configMigrationContext, providers *SecretProviderRegistry) error {
			creds, raw, err := parseCredentialsDocument(ctx.CredentialsDocument)
			if err != nil {
				return err
			}
			// A copy excludes the map, so no selected team can redirect this proof.
			source := *creds
			source.AgentKeyRefs = nil
			key, configured, err := resolveAgentKey(&source, providers)
			if err != nil || !configured {
				return migrationStageError("resolve_source", configmigrate.FailureState{}, fmt.Errorf("cannot resolve the legacy agent key"))
			}
			client, err := newAgentKeyAuthenticatedClient(creds.Endpoints.API, key)
			if err != nil {
				return migrationStageError("verify_key", configmigrate.FailureState{}, err)
			}
			whoami, err := fetchAgentWhoami(context.Background(), client)
			if err != nil {
				return migrationStageError("verify_key", configmigrate.FailureState{}, err)
			}
			if _, err := verifyAuthenticatedSubject(ctx.CredentialsPath, creds, whoami, false); err != nil {
				return migrationStageError("verify_subject", configmigrate.FailureState{}, err)
			}
			binding, ok := whoami.CredentialBinding.Get()
			if !ok {
				return migrationStageError("verify_binding", configmigrate.FailureState{}, fmt.Errorf("legacy key has no authenticated credential binding"))
			}
			indexed := indexedAgentKeyReference{Reference: *creds.AgentKeyRef, SubjectID: creds.SubjectID}
			stored := false
			if team, ok := binding.GetProvenanceGraphTeamNode(); ok {
				if team.BoundTeamId == uuid.Nil || strings.TrimSpace(team.KeyId) == "" {
					return migrationStageError("verify_binding", configmigrate.FailureState{}, fmt.Errorf("legacy key has incomplete team binding"))
				}
				indexed.BindingScope = "team"
				indexed.TeamID = team.BoundTeamId.String()
				indexed.KeyID = team.KeyId
				ref := SecretReference{Provider: destination, Key: TeamAgentKeyKey(creds.SubjectID, indexed.TeamID)}
				if previous, exists := creds.AgentKeyRefs[indexed.TeamID]; exists && previous != ref {
					return migrationStageError("destination_conflict", configmigrate.FailureState{}, fmt.Errorf("selected team already has a different credential reference"))
				}
				stored, err = providers.Ensure(ref, key)
				if err != nil {
					return migrationStageError("ensure_destination", retainedSecretState(stored), fmt.Errorf("could not copy and verify the team credential"))
				}
				if creds.AgentKeyRefs == nil {
					creds.AgentKeyRefs = map[string]SecretReference{}
				}
				creds.AgentKeyRefs[indexed.TeamID] = ref
			} else if identity, ok := binding.GetProvenanceGraphIdentityNode(); ok {
				if strings.TrimSpace(identity.KeyId) == "" {
					return migrationStageError("verify_binding", configmigrate.FailureState{}, fmt.Errorf("legacy key has incomplete identity binding"))
				}
				indexed.BindingScope = "identity"
				indexed.KeyID = identity.KeyId
			} else {
				return migrationStageError("verify_binding", configmigrate.FailureState{}, fmt.Errorf("unsupported legacy credential binding"))
			}
			updated, err := rewriteCredentialsDocument(raw, func(top map[string]json.RawMessage) error {
				if indexed.BindingScope == "team" {
					encoded, err := json.Marshal(creds.AgentKeyRefs)
					if err != nil {
						return err
					}
					top["agent_key_refs"] = encoded
				}
				encoded, err := json.Marshal(indexed)
				if err != nil {
					return err
				}
				top["agent_key_ref_verified"] = encoded
				return nil
			})
			if err != nil {
				return migrationStageError("prepare_credentials", retainedRetryableState(stored), err)
			}
			if err := ctx.ReplaceCredentials(updated); err != nil {
				return migrationStageError("replace_credentials", retainedRetryableState(stored), err)
			}
			return nil
		},
	}
}
