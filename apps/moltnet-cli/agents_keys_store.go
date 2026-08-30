package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// agentKeyStoreOpts enables `agents keys create|rotate --store`: the one-time
// secret is written to a secret provider under the canonical agent-key key and
// moltnet.json gains agent_key_ref, so the value never has to be printed.
type agentKeyStoreOpts struct {
	enabled          bool
	destination      string
	secretProviders  *SecretProviderRegistry
	writeCredentials func(path string, data []byte) error
}

// agentKeyStoreTarget is resolved before any network call so a misconfigured
// destination or credentials file fails without minting a key.
type agentKeyStoreTarget struct {
	credentialsPath string
	identityID      string
	document        map[string]json.RawMessage
	ref             SecretReference
	providers       *SecretProviderRegistry
	write           func(path string, data []byte) error
}

// storedAgentKeyOutput is printed instead of the secret-bearing result when
// --store is used. Secret is set only when the secret could not be stored, so
// the operator can recover it; ManualRecoveryRequired is set when the secret is
// stored but moltnet.json could not be updated.
type storedAgentKeyOutput struct {
	Key                    moltnetapi.AgentKey `json:"key"`
	IdempotencyKey         string              `json:"idempotencyKey,omitempty"`
	AgentKeyRef            SecretReference     `json:"agentKeyRef"`
	CredentialsPath        string              `json:"credentialsPath"`
	CredentialsUpdated     bool                `json:"credentialsUpdated"`
	Secret                 string              `json:"secret,omitempty"`
	ManualRecoveryRequired bool                `json:"manualRecoveryRequired,omitempty"`
}

func prepareAgentKeyStore(opts agentKeyStoreOpts, credPath string) (*agentKeyStoreTarget, error) {
	if !opts.enabled {
		return nil, nil
	}
	providers := opts.secretProviders
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	destination, err := validateMigrationDestination(providers, opts.destination)
	if err != nil {
		return nil, err
	}
	credentialsPath, err := resolveCredentialsPath(credPath)
	if err != nil {
		return nil, err
	}
	data, err := configmigrate.ReadBoundedRegularFile(credentialsPath, maxMigrationConfigBytes)
	if err != nil {
		return nil, fmt.Errorf("--store requires a credentials file to update: %w", err)
	}
	creds, document, err := parseCredentialsDocument(data)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(creds.IdentityID) == "" {
		return nil, fmt.Errorf("--store requires identity_id in %s", credentialsPath)
	}
	write := opts.writeCredentials
	if write == nil {
		write = writeCredentialsAtomic
	}
	return &agentKeyStoreTarget{
		credentialsPath: credentialsPath,
		identityID:      creds.IdentityID,
		document:        document,
		ref:             SecretReference{Provider: destination, Key: AgentKeyKey(creds.IdentityID)},
		providers:       providers,
		write:           write,
	}, nil
}

// requireAgentID refuses to bind a key minted for another agent to this
// credentials file. Called before the network for create (the flag value) and
// after for rotate (the server's answer).
func (t *agentKeyStoreTarget) requireAgentID(agentID string) error {
	if strings.TrimSpace(agentID) != t.identityID {
		return fmt.Errorf("--store binds agent_key_ref to identity %s in %s, but the key authenticates agent %s", t.identityID, t.credentialsPath, agentID)
	}
	return nil
}

// persist stores the secret (replacing any previous key under the same
// reference — rotation is the point), verifies it reads back, then rewrites
// agent_key_ref. The returned output never contains the secret unless
// storage itself failed.
func (t *agentKeyStoreTarget) persist(out io.Writer, errOut io.Writer, output storedAgentKeyOutput, secret string) error {
	output.AgentKeyRef = t.ref
	output.CredentialsPath = t.credentialsPath
	if err := t.providers.Store(t.ref, secret); err != nil {
		return emitAgentKeyRecovery(out, output, secret, fmt.Errorf("store agent key: %w", err))
	}
	stored, err := t.providers.Resolve(t.ref)
	if err != nil || stored != secret {
		if err == nil {
			err = fmt.Errorf("stored value does not match")
		}
		return emitAgentKeyRecovery(out, output, secret, fmt.Errorf("verify stored agent key: %w", err))
	}
	updated, err := rewriteAgentKeyReference(t.document, t.ref)
	if err == nil {
		err = t.write(t.credentialsPath, updated)
	}
	if err != nil {
		output.ManualRecoveryRequired = true
		if printErr := printJSONTo(out, output); printErr != nil {
			return printErr
		}
		return fmt.Errorf("agent key stored at %s:%s but %s was not updated (%w); add agent_key_ref manually", t.ref.Provider, t.ref.Key, t.credentialsPath, err)
	}
	output.CredentialsUpdated = true
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if errOut != nil {
		fmt.Fprintf(errOut, "Stored the agent key in the %q provider and set agent_key_ref in %s. Restart active agent processes.\n", t.ref.Provider, t.credentialsPath)
	}
	return nil
}

func emitAgentKeyRecovery(out io.Writer, output storedAgentKeyOutput, secret string, cause error) error {
	output.Secret = secret
	if err := printJSONTo(out, output); err != nil {
		return fmt.Errorf("%w; the one-time secret could not be written to stdout either", cause)
	}
	return fmt.Errorf("%w; the one-time secret is in the JSON result above — store it yourself", cause)
}

func rewriteAgentKeyReference(document map[string]json.RawMessage, ref SecretReference) ([]byte, error) {
	updated := make(map[string]json.RawMessage, len(document)+1)
	for key, value := range document {
		updated[key] = value
	}
	refJSON, err := json.Marshal(ref)
	if err != nil {
		return nil, fmt.Errorf("marshal secret reference: %w", err)
	}
	updated["agent_key_ref"] = refJSON
	data, err := json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal credentials: %w", err)
	}
	return append(data, '\n'), nil
}

// agentKeyAgentID returns the agent UUID a key authenticates, for either
// binding scope.
func agentKeyAgentID(key moltnetapi.AgentKey) (string, bool) {
	if teamKey, ok := key.GetTeamAgentKey(); ok {
		return teamKey.AgentId.String(), true
	}
	if identityKey, ok := key.GetIdentityAgentKey(); ok {
		return identityKey.AgentId.String(), true
	}
	return "", false
}
