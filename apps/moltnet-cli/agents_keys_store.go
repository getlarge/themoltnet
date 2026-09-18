package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// agentKeyStoreOpts enables enrollment and key lifecycle storage: the one-time
// secret is written to a secret provider under its canonical subject/team key
// and moltnet.json gains the corresponding credential reference. In this mode the secret is never written
// to stdout or stderr — not on success and not on any failure path — so the
// secrets guard can treat the invocation as non-revealing. Failures leave a
// protected recovery artifact instead.
type agentKeyStoreOpts struct {
	enabled         bool
	destination     string
	secretProviders *SecretProviderRegistry
	// writeRecovery persists a recovery artifact and returns its path. Tests
	// point it at a temp dir; the default is the user cache recovery dir.
	writeRecovery   func(agentKeyRecovery) (string, error)
	removeRecovery  func(string) error
	replaceRecovery func(string, []byte) error
}

// agentKeyStoreTarget is resolved before any network call so a misconfigured
// destination or credentials file fails without minting a key.
type agentKeyStoreTarget struct {
	credentialsPath        string
	subjectID              string
	ref                    SecretReference
	providers              *SecretProviderRegistry
	writeRecovery          func(agentKeyRecovery) (string, error)
	teamID                 string
	expectedTeam           string
	expectedIdentity       bool
	enrollment             bool
	recoveryPath           string
	retainRecovery         bool
	recoveryContainsSecret bool
	issuedRef              *SecretReference
	removeRecovery         func(string) error
	replaceRecovery        func(string, []byte) error
}

// storedAgentKeyOutput is printed instead of the secret-bearing result when
// --store is used. It never carries the secret.
type storedAgentKeyOutput struct {
	Key                    moltnetapi.AgentKey `json:"key"`
	TeamID                 string              `json:"teamId,omitempty"`
	Role                   string              `json:"role,omitempty"`
	IdempotencyKey         string              `json:"idempotencyKey,omitempty"`
	AgentKeyRef            SecretReference     `json:"agentKeyRef"`
	CredentialsPath        string              `json:"credentialsPath"`
	SecretWritten          bool                `json:"secretWritten,omitempty"`
	SecretCaptured         bool                `json:"secretCaptured,omitempty"`
	SecretStored           bool                `json:"secretStored"`
	CredentialsUpdated     bool                `json:"credentialsUpdated"`
	ManualRecoveryRequired bool                `json:"manualRecoveryRequired,omitempty"`
	CleanupRequired        bool                `json:"cleanupRequired,omitempty"`
	RecoveryPath           string              `json:"recoveryPath,omitempty"`
}

// agentKeyRecovery is the protected artifact written when --store cannot
// complete. Secret is present only when the provider never verified the
// value; once the secret is safely stored the artifact records the reference
// and the state the operator must reconcile.
type agentKeyRecovery struct {
	Stage           string                     `json:"stage"`
	Reason          string                     `json:"reason"`
	AgentKeyRef     SecretReference            `json:"agentKeyRef"`
	CredentialsPath string                     `json:"credentialsPath"`
	SecretWritten   bool                       `json:"secretWritten,omitempty"`
	SecretStored    bool                       `json:"secretStored"`
	Secret          string                     `json:"secret,omitempty"`
	IssuedKey       *moltnetapi.AgentKey       `json:"issuedKey,omitempty"`
	Rotation        *rotationRecoveryRequest   `json:"rotation,omitempty"`
	Reconciliation  *enrollmentReconciliation  `json:"reconciliation,omitempty"`
	Enrollment      *enrollmentRecoveryRequest `json:"enrollment,omitempty"`
}

func prepareAgentKeyStore(opts agentKeyStoreOpts, credPath string) (*agentKeyStoreTarget, error) {
	if !opts.enabled {
		return nil, nil
	}
	providers := opts.secretProviders
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	destination, err := resolveSecretDestination(providers, opts.destination)
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
	subjectID, ok := creds.CanonicalSubject()
	if !ok {
		return nil, fmt.Errorf("--store requires subject_type=agent and subject_id in %s; run `moltnet config migrate` first", credentialsPath)
	}
	writeRecovery := opts.writeRecovery
	if writeRecovery == nil {
		writeRecovery = writeAgentKeyRecoveryFile
	}
	removeRecovery := opts.removeRecovery
	if removeRecovery == nil {
		removeRecovery = os.Remove
	}
	replaceRecovery := opts.replaceRecovery
	if replaceRecovery == nil {
		replaceRecovery = safefile.Write
	}
	return &agentKeyStoreTarget{
		credentialsPath: credentialsPath,
		subjectID:       subjectID,
		ref:             SecretReference{Provider: destination, Key: AgentKeyKey(subjectID)},
		providers:       providers,
		writeRecovery:   writeRecovery,
		removeRecovery:  removeRecovery,
		replaceRecovery: replaceRecovery,
	}, nil
}

// requireAgentID refuses to bind a key minted for another agent to this
// credentials file. Called before the network for create (the flag value) and
// after for rotate (the server's answer).
func (t *agentKeyStoreTarget) requireAgentID(agentID string) error {
	if strings.TrimSpace(agentID) != t.subjectID {
		return fmt.Errorf("--store binds agent_key_ref to subject %s in %s, but the key authenticates agent %s", t.subjectID, t.credentialsPath, agentID)
	}
	return nil
}

// reserve checks protected recovery storage before requesting a one-time secret.
func (t *agentKeyStoreTarget) reserve() error {
	path, err := t.writeRecovery(agentKeyRecovery{Stage: "pending", AgentKeyRef: t.ref, CredentialsPath: t.credentialsPath})
	if err != nil {
		return fmt.Errorf("protected recovery storage is unavailable; key issuance was not attempted")
	}
	t.recoveryPath = path
	return nil
}

func (t *agentKeyStoreTarget) close(result *error) {
	if t != nil && !t.retainRecovery && t.recoveryPath != "" {
		if err := t.removeRecovery(t.recoveryPath); err != nil && !os.IsNotExist(err) {
			*result = errors.Join(*result, fmt.Errorf("remove stale protected recovery file %s manually; cleanup failed", t.recoveryPath))
		}
	}
}

func (t *agentKeyStoreTarget) capture(recovery agentKeyRecovery) error {
	if t.recoveryPath == "" {
		if err := t.reserve(); err != nil {
			return err
		}
	}
	data, err := json.Marshal(recovery)
	if err != nil {
		return err
	}
	if err := t.replaceRecovery(t.recoveryPath, append(data, '\n')); err != nil {
		return fmt.Errorf("could not write protected credential recovery")
	}
	t.retainRecovery = true
	t.recoveryContainsSecret = recovery.Secret != ""
	return nil
}

func (t *agentKeyStoreTarget) selectSlot(key moltnetapi.AgentKey) error {
	agentID, ok := agentKeyAgentID(key)
	if !ok {
		return fmt.Errorf("unsupported credential binding")
	}
	actual := SecretReference{Provider: t.ref.Provider, Key: AgentKeyKey(agentID)}
	if team, ok := key.GetTeamAgentKey(); ok {
		actual.Key = TeamAgentKeyKey(agentID, team.TeamId.String())
	}
	t.issuedRef = &actual
	if err := t.requireAgentID(agentID); err != nil {
		return err
	}
	if team, ok := key.GetTeamAgentKey(); ok {
		if t.expectedIdentity {
			return fmt.Errorf("expected an identity-scoped credential")
		}
		if t.expectedTeam != "" && team.TeamId.String() != t.expectedTeam {
			return fmt.Errorf("issued credential is bound to a different team")
		}
		t.teamID = team.TeamId.String()
		t.ref.Key = TeamAgentKeyKey(t.subjectID, t.teamID)
	} else if t.enrollment || t.expectedTeam != "" {
		return fmt.Errorf("expected a team-bound credential")
	}
	return nil
}

func (t *agentKeyStoreTarget) persist(out io.Writer, errOut io.Writer, output storedAgentKeyOutput, secret string) error {
	if err := t.selectSlot(output.Key); err != nil {
		return t.fail(out, output, "verify_identity", secret, err)
	}
	output.AgentKeyRef = t.ref
	output.CredentialsPath = t.credentialsPath
	if err := t.capture(agentKeyRecovery{Stage: "issued", AgentKeyRef: t.ref, CredentialsPath: t.credentialsPath, Secret: secret}); err != nil {
		return t.fail(out, output, "capture_secret", secret, err)
	}
	stage := "update_credentials"
	err := t.updateCredentials(func() error {
		stage = "store_secret"
		if t.enrollment {
			changed, err := t.providers.Ensure(t.ref, secret)
			output.SecretWritten = changed
			if err != nil {
				return err
			}
		} else {
			changed, err := t.providers.ReplaceWithResult(t.ref, secret)
			output.SecretWritten = changed
			if err != nil {
				return err
			}
		}
		output.SecretStored = true
		stage = "update_credentials"
		return nil
	})
	if err != nil {
		preserved := secret
		if output.SecretStored {
			preserved = ""
		}
		return t.fail(out, output, stage, preserved, err)
	}
	output.CredentialsUpdated = true
	if err := t.removeRecovery(t.recoveryPath); err != nil {
		output.CleanupRequired = true
		output.RecoveryPath = t.recoveryPath
		if errOut != nil {
			fmt.Fprintf(errOut, "Credential saved and usable. Remove only the stale protected recovery file %s; no credential restoration is needed.\n", t.recoveryPath)
		}
	} else {
		t.retainRecovery = false
		t.recoveryPath = ""
	}
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if errOut != nil {
		fmt.Fprintf(errOut, "Stored the agent key in %q and updated its credential slot in %s. Restart active agent processes.\n", t.ref.Provider, t.credentialsPath)
	}
	return nil
}

var errAgentKeySubjectChanged = errors.New("credentials file subject anchor changed since the key was minted")

func (t *agentKeyStoreTarget) updateCredentials(store func() error) error {
	return updateLockedCredentialsBytes(t.credentialsPath, func(current []byte) ([]byte, error) {
		creds, document, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		if subjectID, ok := creds.CanonicalSubject(); !ok || subjectID != t.subjectID {
			return nil, errAgentKeySubjectChanged
		}
		if t.enrollment && t.teamID != "" {
			if previous, ok := creds.AgentKeyRefs[t.teamID]; ok && previous != t.ref {
				return nil, fmt.Errorf("team already has a different stored credential reference")
			}
		}
		updated, err := rewriteCredentialsDocument(document, func(top map[string]json.RawMessage) error {
			refJSON, err := json.Marshal(t.ref)
			if err != nil {
				return fmt.Errorf("marshal secret reference: %w", err)
			}
			if t.teamID == "" {
				top["agent_key_ref"] = refJSON
			} else {
				if creds.AgentKeyRefs == nil {
					creds.AgentKeyRefs = map[string]SecretReference{}
				}
				creds.AgentKeyRefs[t.teamID] = t.ref
				refs, err := json.Marshal(creds.AgentKeyRefs)
				if err != nil {
					return err
				}
				top["agent_key_refs"] = refs
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		return updated, nil
	}, store)
}

// fail records the partial state durably before reporting it. The secret is
// written only to the protected artifact, and only when it was never verified
// in the provider; stdout and the error carry paths and state, never values.
func (t *agentKeyStoreTarget) fail(out io.Writer, output storedAgentKeyOutput, stage, secret string, cause error) error {
	output.ManualRecoveryRequired = true
	output.AgentKeyRef = SecretReference{}
	if t.issuedRef != nil {
		output.AgentKeyRef = *t.issuedRef
	}
	output.CredentialsPath = t.credentialsPath
	recovery := agentKeyRecovery{
		Stage:           stage,
		Reason:          cause.Error(),
		AgentKeyRef:     output.AgentKeyRef,
		IssuedKey:       &output.Key,
		CredentialsPath: t.credentialsPath,
		SecretWritten:   output.SecretWritten,
		SecretStored:    output.SecretStored,
		Secret:          secret,
	}
	recoveryErr := t.capture(recovery)
	output.SecretCaptured = t.recoveryContainsSecret
	recoveryPath := t.recoveryPath
	if t.retainRecovery {
		output.RecoveryPath = recoveryPath
	}
	printErr := printJSONTo(out, output)

	var next string
	switch {
	case output.SecretStored:
		next = fmt.Sprintf("the key is stored at %s:%s; restore the credential reference in %s manually", t.ref.Provider, t.ref.Key, t.credentialsPath)
	case t.recoveryContainsSecret:
		next = fmt.Sprintf("the one-time secret was written to the protected recovery file %s", recoveryPath)
	case t.retainRecovery:
		next = fmt.Sprintf("the recovery file %s is retained, but secret capture was not confirmed; revoke this key and mint a new one", recoveryPath)
	default:
		next = "the one-time secret could not be preserved; revoke this key and mint a new one"
	}
	if output.SecretWritten && !output.SecretStored {
		next += "; a destination write occurred but was not verified; reconcile that slot before retrying"
	}
	err := fmt.Errorf("credential --store failed during %s: %w; %s", stage, cause, next)
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
