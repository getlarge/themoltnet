package main

import (
	"fmt"
	"strings"
)

type selectedAgentKey struct {
	Reference SecretReference
	TeamID    string
}

func hasAgentKeyConfiguration(config *CredentialsFile) bool {
	return config != nil && (config.AgentKeyRef != nil || len(config.AgentKeyRefs) > 0)
}

func hasUsableCredentialConfiguration(config *CredentialsFile) bool {
	return hasAgentKeyConfiguration(config) || (config != nil && config.OAuth2.ClientID != "")
}

// Select exactly once. Provider failure must never try another grant.
func selectAgentKeyReference(config *CredentialsFile, selectedTeam string) (*selectedAgentKey, error) {
	if config == nil {
		return nil, nil
	}
	team := strings.TrimSpace(selectedTeam)
	if ref, ok := config.AgentKeyRefs[team]; team != "" && ok {
		return &selectedAgentKey{ref, team}, nil
	}
	if config.AgentKeyRef != nil {
		return &selectedAgentKey{Reference: *config.AgentKeyRef}, nil
	}
	if len(config.AgentKeyRefs) == 0 {
		return nil, nil
	}
	if team == "" && len(config.AgentKeyRefs) == 1 {
		for id, ref := range config.AgentKeyRefs {
			if strings.TrimSpace(id) == "" {
				return nil, fmt.Errorf("team key map contains an empty team ID")
			}
			return &selectedAgentKey{ref, id}, nil
		}
	}
	if team != "" {
		return nil, fmt.Errorf("no agent key configured for the selected team; enroll that team first")
	}
	return nil, fmt.Errorf("multiple team agent keys configured; select a team explicitly")
}

func validateSelectedAgentKey(selection *selectedAgentKey, subjectID string) error {
	if selection == nil {
		return fmt.Errorf("no agent key selected")
	}
	if !secretProviderNamePattern.MatchString(selection.Reference.Provider) {
		return fmt.Errorf("agent key provider name is invalid")
	}
	return validateSecretReferenceBinding(credentialAgentKey, selection.Reference, credentialBindingIDs{
		SubjectID: subjectID, TeamID: selection.TeamID,
	})
}
