package main

import (
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
