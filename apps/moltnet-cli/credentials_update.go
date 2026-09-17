package main

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

// Reload under the interoperable writer lock. Mutators change only their own
// raw fields, preserving fields introduced by newer readers and other teams.
func updateLockedCredentialsDocument(path, subjectID string, mutate func(map[string]json.RawMessage) error) error {
	lock, err := safefile.Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	current, err := safefile.ReadBoundedRegularFile(path, maxMigrationConfigBytes)
	if err != nil {
		return err
	}
	creds, document, err := parseCredentialsDocument(current)
	if err != nil {
		return err
	}
	if subject, ok := creds.CanonicalSubject(); !ok || subject != subjectID {
		return fmt.Errorf("credentials file subject anchor changed before update")
	}
	updated, err := rewriteCredentialsDocument(document, mutate)
	if err != nil {
		return err
	}
	return lock.Replace(current, updated, maxMigrationConfigBytes)
}

func updateTeamAgentKeyReference(path, subjectID, teamID string, reference SecretReference) error {
	if teamID == "" {
		return fmt.Errorf("team ID is required")
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
	lock, err := safefile.Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	raw, err := safefile.ReadBoundedRegularFile(path, maxMigrationConfigBytes)
	if err != nil {
		return err
	}
	var current CredentialsFile
	if err := json.Unmarshal(raw, &current); err != nil {
		return err
	}
	if current.Keys.PublicKey != expected.Keys.PublicKey || current.SubjectID != expected.SubjectID || current.SubjectType != expected.SubjectType || current.legacyIdentityID != expected.legacyIdentityID {
		return fmt.Errorf("credentials identity changed before update")
	}
	before, err := json.Marshal(current)
	if err != nil {
		return err
	}
	if err := mutate(&current); err != nil {
		return err
	}
	after, err := json.Marshal(current)
	if err != nil {
		return err
	}
	updated, err := mergeCredentialChanges(raw, before, after)
	if err != nil {
		return err
	}
	return lock.Replace(raw, append(updated, '\n'), maxMigrationConfigBytes)
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
