package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// agentKeyStoreOpts enables `agents keys create|rotate --store`: the one-time
// secret is written to a secret provider under the canonical agent-key key and
// moltnet.json gains agent_key_ref. In this mode the secret is never written
// to stdout or stderr — not on success and not on any failure path — so the
// secrets guard can treat the invocation as non-revealing. Failures leave a
// protected recovery artifact instead.
type agentKeyStoreOpts struct {
	enabled         bool
	destination     string
	secretProviders *SecretProviderRegistry
	// writeRecovery persists a recovery artifact and returns its path. Tests
	// point it at a temp dir; the default is the user cache recovery dir.
	writeRecovery func(agentKeyRecovery) (string, error)
}

// agentKeyStoreTarget is resolved before any network call so a misconfigured
// destination or credentials file fails without minting a key.
type agentKeyStoreTarget struct {
	credentialsPath string
	identityID      string
	ref             SecretReference
	providers       *SecretProviderRegistry
	writeRecovery   func(agentKeyRecovery) (string, error)
}

// storedAgentKeyOutput is printed instead of the secret-bearing result when
// --store is used. It never carries the secret.
type storedAgentKeyOutput struct {
	Key                    moltnetapi.AgentKey `json:"key"`
	IdempotencyKey         string              `json:"idempotencyKey,omitempty"`
	AgentKeyRef            SecretReference     `json:"agentKeyRef"`
	CredentialsPath        string              `json:"credentialsPath"`
	SecretStored           bool                `json:"secretStored"`
	CredentialsUpdated     bool                `json:"credentialsUpdated"`
	ManualRecoveryRequired bool                `json:"manualRecoveryRequired,omitempty"`
	RecoveryPath           string              `json:"recoveryPath,omitempty"`
}

// agentKeyRecovery is the protected artifact written when --store cannot
// complete. Secret is present only when the provider never verified the
// value; once the secret is safely stored the artifact records the reference
// and the state the operator must reconcile.
type agentKeyRecovery struct {
	Stage           string          `json:"stage"`
	Reason          string          `json:"reason"`
	AgentKeyRef     SecretReference `json:"agentKeyRef"`
	CredentialsPath string          `json:"credentialsPath"`
	SecretStored    bool            `json:"secretStored"`
	Secret          string          `json:"secret,omitempty"`
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
	creds, _, err := parseCredentialsDocument(data)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(creds.IdentityID) == "" {
		return nil, fmt.Errorf("--store requires identity_id in %s", credentialsPath)
	}
	writeRecovery := opts.writeRecovery
	if writeRecovery == nil {
		writeRecovery = writeAgentKeyRecoveryFile
	}
	return &agentKeyStoreTarget{
		credentialsPath: credentialsPath,
		identityID:      creds.IdentityID,
		ref:             SecretReference{Provider: destination, Key: AgentKeyKey(creds.IdentityID)},
		providers:       providers,
		writeRecovery:   writeRecovery,
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

// persist stores the secret with lock-held verification (replacing any
// previous key under the same reference — rotation is the point), then sets
// agent_key_ref on the *current* credentials document under the CLI writer
// lock with compare-and-replace, so a concurrent activation, migration, or
// credential update is merged rather than discarded.
func (t *agentKeyStoreTarget) persist(out io.Writer, errOut io.Writer, output storedAgentKeyOutput, secret string) error {
	output.AgentKeyRef = t.ref
	output.CredentialsPath = t.credentialsPath
	if err := t.providers.Replace(t.ref, secret); err != nil {
		return t.fail(out, output, "store_secret", secret, fmt.Errorf("store agent key: %w", err))
	}
	output.SecretStored = true

	if err := t.updateCredentials(); err != nil {
		return t.fail(out, output, "update_credentials", "", err)
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

var errAgentKeyIdentityChanged = errors.New("credentials file identity_id changed since the key was minted")

func (t *agentKeyStoreTarget) updateCredentials() error {
	lock, err := safefile.Acquire(t.credentialsPath)
	if err != nil {
		return fmt.Errorf("lock credentials: %w", err)
	}
	defer lock.Close()
	current, err := configmigrate.ReadBoundedRegularFile(t.credentialsPath, maxMigrationConfigBytes)
	if err != nil {
		return fmt.Errorf("read credentials: %w", err)
	}
	creds, document, err := parseCredentialsDocument(current)
	if err != nil {
		return err
	}
	if strings.TrimSpace(creds.IdentityID) != t.identityID {
		return errAgentKeyIdentityChanged
	}
	updated, err := rewriteCredentialsDocument(document, func(top map[string]json.RawMessage) error {
		refJSON, err := json.Marshal(t.ref)
		if err != nil {
			return fmt.Errorf("marshal secret reference: %w", err)
		}
		top["agent_key_ref"] = refJSON
		return nil
	})
	if err != nil {
		return err
	}
	if err := lock.Replace(current, updated, maxMigrationConfigBytes); err != nil {
		return fmt.Errorf("replace credentials: %w", err)
	}
	return nil
}

// fail records the partial state durably before reporting it. The secret is
// written only to the protected artifact, and only when it was never verified
// in the provider; stdout and the error carry paths and state, never values.
func (t *agentKeyStoreTarget) fail(out io.Writer, output storedAgentKeyOutput, stage, secret string, cause error) error {
	output.ManualRecoveryRequired = true
	recovery := agentKeyRecovery{
		Stage:           stage,
		Reason:          cause.Error(),
		AgentKeyRef:     t.ref,
		CredentialsPath: t.credentialsPath,
		SecretStored:    output.SecretStored,
		Secret:          secret,
	}
	recoveryPath, recoveryErr := t.writeRecovery(recovery)
	if recoveryErr == nil {
		output.RecoveryPath = recoveryPath
	}
	printErr := printJSONTo(out, output)

	var next string
	switch {
	case output.SecretStored:
		next = fmt.Sprintf("the key is stored at %s:%s; add agent_key_ref to %s manually", t.ref.Provider, t.ref.Key, t.credentialsPath)
	case recoveryErr == nil:
		next = fmt.Sprintf("the one-time secret was written to the protected recovery file %s", recoveryPath)
	default:
		next = "the one-time secret could not be preserved; revoke this key and mint a new one"
	}
	err := fmt.Errorf("agents keys --store failed during %s: %w; %s", stage, cause, next)
	if recoveryErr != nil {
		err = fmt.Errorf("%w (recovery artifact failed: %v)", err, recoveryErr)
	}
	if printErr != nil {
		err = fmt.Errorf("%w (result output failed: %v)", err, printErr)
	}
	return err
}

func writeAgentKeyRecoveryFile(recovery agentKeyRecovery) (string, error) {
	dir, err := defaultRecoveryDir()
	if err != nil {
		return "", err
	}
	return writeRecoveryArtifact(dir, "agent-key-recovery-*.json", recovery)
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
