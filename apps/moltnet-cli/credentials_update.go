package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

// Reload under the interoperable writer lock. Mutators change only their own
// raw fields, preserving fields introduced by newer readers and other teams.
func updateLockedCredentialsDocument(path, subjectID string, mutate func(map[string]json.RawMessage) error) error {
	return updateLockedCredentialsBytes(path, func(current []byte) ([]byte, error) {
		creds, document, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		if subject, ok := creds.CanonicalSubject(); !ok || subject != subjectID {
			return nil, fmt.Errorf("credentials file subject anchor changed before update")
		}
		updated, err := rewriteCredentialsDocument(document, mutate)
		if err != nil {
			return nil, err
		}
		return updated, nil
	})
}

func updateTeamAgentKeyReference(path, subjectID, teamID string, reference SecretReference) error {
	if teamID == "" || teamID != strings.TrimSpace(teamID) {
		return fmt.Errorf("canonical team ID is required (no surrounding whitespace)")
	}
	if err := validateSelectedAgentKey(&selectedAgentKey{reference, teamID}, subjectID); err != nil {
		return err
	}
	return updateLockedCredentialsDocument(path, subjectID, func(document map[string]json.RawMessage) error {
		refs := make(map[string]SecretReference)
		if raw := document["agent_key_refs"]; raw != nil {
			if err := json.Unmarshal(raw, &refs); err != nil {
				return err
			}
		}
		if refs == nil {
			refs = make(map[string]SecretReference)
		}
		refs[teamID] = reference
		encoded, err := json.Marshal(refs)
		if err != nil {
			return err
		}
		document["agent_key_refs"] = encoded
		return nil
	})
}

// Apply a mutation to a fresh document under the shared Go/Node lock. Retain
// unknown fields, including fields nested in sections understood by this CLI.
func updateCredentials(path string, expected *CredentialsFile, mutate func(*CredentialsFile) error) error {
	return updateLockedCredentialsBytes(path, func(raw []byte) ([]byte, error) {
		var current CredentialsFile
		if err := json.Unmarshal(raw, &current); err != nil {
			return nil, err
		}
		if current.Keys.PublicKey != expected.Keys.PublicKey || current.SubjectID != expected.SubjectID || current.SubjectType != expected.SubjectType || current.legacyIdentityID != expected.legacyIdentityID {
			return nil, fmt.Errorf("credentials identity changed before update")
		}
		before, err := json.Marshal(current)
		if err != nil {
			return nil, err
		}
		if err := mutate(&current); err != nil {
			return nil, err
		}
		if err := validateTeamKeyAuthentication(&current); err != nil {
			return nil, err
		}
		after, err := json.Marshal(current)
		if err != nil {
			return nil, err
		}
		updated, err := mergeCredentialChanges(raw, before, after)
		if err != nil {
			return nil, err
		}
		return append(updated, '\n'), nil
	})
}

// Only apply fields changed by the mutator. The typed round trip must not
// erase fields from a newer reader, including inside an edited section.
func mergeCredentialChanges(raw, before, after []byte) ([]byte, error) {
	if bytes.Equal(before, after) {
		return raw, nil
	}
	var original, previous, next map[string]json.RawMessage
	if json.Unmarshal(raw, &original) != nil || json.Unmarshal(before, &previous) != nil || json.Unmarshal(after, &next) != nil || original == nil || previous == nil || next == nil {
		return after, nil
	}
	for key := range previous {
		if _, ok := next[key]; !ok {
			delete(original, key)
		}
	}
	for key, value := range next {
		if bytes.Equal(previous[key], value) {
			continue
		}
		merged, err := mergeCredentialChanges(original[key], previous[key], value)
		if err != nil {
			return nil, err
		}
		original[key] = merged
	}
	return json.MarshalIndent(original, "", "  ")
}

func writeNewConfig(config *CredentialsFile, path string) (string, error) {
	if err := writeConfigFile(config, path, safefile.Create); err != nil {
		return "", err
	}
	return path, nil
}

// One lock/read/replace protocol for raw and typed credential updates.
func updateLockedCredentialsBytes(path string, mutate func([]byte) ([]byte, error)) error {
	lock, err := safefile.Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	current, err := safefile.ReadBoundedRegularFile(path, maxMigrationConfigBytes)
	if err != nil {
		return err
	}
	updated, err := mutate(current)
	if err != nil {
		return err
	}
	var config CredentialsFile
	if err := json.Unmarshal(updated, &config); err != nil {
		return err
	}
	if err := validateTeamKeyAuthentication(&config); err != nil {
		return err
	}
	return lock.Replace(current, updated, maxMigrationConfigBytes)
}

func validateTeamKeyAuthentication(config *CredentialsFile) error {
	if config.AgentKeyRefs != nil && len(config.AgentKeyRefs) == 0 && config.AgentKeyRef == nil && strings.TrimSpace(config.OAuth2.ClientID) == "" {
		return fmt.Errorf("config requires an authentication mechanism; an empty team key map is not sufficient")
	}
	return nil
}
