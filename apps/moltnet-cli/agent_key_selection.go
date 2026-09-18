package main

import (
	"fmt"
	"os"
	"path/filepath"
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

// Commands with an explicit resource team select it before the location context.
func resolveCredentialTeam(credPath string, explicit ...string) (string, error) {
	if len(explicit) > 0 && strings.TrimSpace(explicit[0]) != "" {
		return strings.TrimSpace(explicit[0]), nil
	}
	if team := strings.TrimSpace(os.Getenv("MOLTNET_TEAM_ID")); team != "" {
		return team, nil
	}
	path, err := resolveCredentialsPath(credPath)
	if err != nil {
		return "", err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	binding, err := resolveContextBinding(filepath.Dir(path), cwd)
	if err != nil {
		return "", fmt.Errorf("resolve credential team: %w", err)
	}
	return binding.teamID(), nil
}
