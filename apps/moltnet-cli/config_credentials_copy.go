package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

// credentialCopyKinds lists the kinds `config credentials copy|move` accepts,
// in the order help output shows them.
var credentialCopyKinds = []credentialKind{
	credentialOAuth2ClientSecret,
	credentialIdentitySeed,
	credentialGitHubAppPrivateKey,
	credentialAgentKey,
}

// credentialCopyOpts drives a provider-to-provider copy or move of one
// reference-backed credential. The destination key is always the canonical
// bound key for the kind: only the provider changes.
type credentialCopyOpts struct {
	credentialsPath string
	kind            credentialKind
	destination     string
	team            string
	move            bool
	providers       *SecretProviderRegistry
	// writeRecovery persists the state diagnostics of a run that needs manual
	// recovery and returns the artifact path. Tests point it at a temp dir.
	writeRecovery func(credentialCopyRecovery) (string, error)
}

// credentialCopyOutput is the machine-readable result. It carries references
// and state, never the secret value.
type credentialCopyOutput struct {
	Kind                   credentialKind  `json:"kind"`
	Operation              string          `json:"operation"`
	CredentialsPath        string          `json:"credentialsPath"`
	TeamID                 string          `json:"teamId,omitempty"`
	Source                 SecretReference `json:"source"`
	Destination            SecretReference `json:"destination"`
	SecretWritten          bool            `json:"secretWritten"`
	CredentialsUpdated     bool            `json:"credentialsUpdated"`
	SourceDeleted          bool            `json:"sourceDeleted"`
	ManualRecoveryRequired bool            `json:"manualRecoveryRequired,omitempty"`
	Stage                  string          `json:"stage,omitempty"`
	RecoveryPath           string          `json:"recoveryPath,omitempty"`
}

// credentialCopyRecovery is the protected artifact written when a copy or
// move leaves state an operator must reconcile. The source keeps the secret
// until the config points at a verified destination, so the artifact never
// needs to carry the value.
type credentialCopyRecovery struct {
	Stage           string          `json:"stage"`
	Reason          string          `json:"reason"`
	Kind            credentialKind  `json:"kind"`
	CredentialsPath string          `json:"credentialsPath"`
	Source          SecretReference `json:"source"`
	Destination     SecretReference `json:"destination"`
	ActiveReference SecretReference `json:"activeReference"`
	SecretWritten   bool            `json:"secretWritten"`
}

// credentialSlot locates one credential reference inside a credentials
// document: which identifiers bind it, and how to read and replace it.
type credentialSlot struct {
	ids     credentialBindingIDs
	teamID  string
	current func(*CredentialsFile) *SecretReference
	rewrite func(document map[string]json.RawMessage, creds *CredentialsFile, ref SecretReference) ([]byte, error)
	// normalize returns the canonical stored form after checking the value's
	// shape, so a corrupt source is never propagated.
	normalize func(creds *CredentialsFile, value string) (string, error)
}

func parseCredentialCopyKind(value string) (credentialKind, error) {
	for _, kind := range credentialCopyKinds {
		if string(kind) == strings.TrimSpace(value) {
			return kind, nil
		}
	}
	names := make([]string, 0, len(credentialCopyKinds))
	for _, kind := range credentialCopyKinds {
		names = append(names, string(kind))
	}
	return "", fmt.Errorf("--kind must be one of %s", strings.Join(names, ", "))
}

func runConfigCredentialsCopyCmd(out, errOut io.Writer, opts credentialCopyOpts) error {
	operation := "copy"
	if opts.move {
		operation = "move"
	}
	providers := opts.providers
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	writeRecovery := opts.writeRecovery
	if writeRecovery == nil {
		writeRecovery = writeCredentialCopyRecoveryFile
	}

	// Write support is checked before the credentials file or any secret is
	// read, so a read-only destination can never cause a source read.
	destination := strings.TrimSpace(opts.destination)
	if !providers.CanWrite(destination) {
		detail := "is not a writable secret provider"
		switch destination {
		case environmentProviderName:
			detail = "is read-only"
		case fileProviderName:
			detail = fmt.Sprintf("requires %s and %s=1", secretRootEnv, secretRootWritableEnv)
		}
		return fmt.Errorf("destination_read_only: --to %q %s", destination, detail)
	}
	if opts.team != "" && opts.kind != credentialAgentKey {
		return fmt.Errorf("--team applies only to --kind %s", credentialAgentKey)
	}

	credentialsPath, err := resolveCredentialsPath(opts.credentialsPath)
	if err != nil {
		return err
	}
	data, err := configmigrate.ReadBoundedRegularFile(credentialsPath, maxMigrationConfigBytes)
	if err != nil {
		return fmt.Errorf("read credentials: %w", err)
	}
	creds, _, err := parseCredentialsDocument(data)
	if err != nil {
		return err
	}
	slot, err := locateCredentialSlot(creds, opts.kind, opts.team)
	if err != nil {
		return err
	}
	sourcePtr := slot.current(creds)
	if sourcePtr == nil {
		return fmt.Errorf("%s is not stored in a secret provider; run 'moltnet config migrate' first", opts.kind)
	}
	source := *sourcePtr
	if err := validateSecretReferenceBinding(opts.kind, source, slot.ids); err != nil {
		return err
	}
	if source.Provider == destination {
		return fmt.Errorf("%s is already stored in the %q provider", opts.kind, destination)
	}
	if opts.move && source.Provider == environmentProviderName {
		return fmt.Errorf("move cannot delete an %q source; use copy", environmentProviderName)
	}
	if opts.move && !providers.CanWrite(source.Provider) {
		// Checked up front: discovering this after the rewrite would leave a
		// completed copy reported as a failed move.
		return fmt.Errorf("move cannot delete from the read-only %q source; use copy, or enable writes for it", source.Provider)
	}
	canonical, err := expectedSecretKey(opts.kind, slot.ids)
	if err != nil {
		return err
	}
	target := SecretReference{Provider: destination, Key: canonical}

	output := credentialCopyOutput{
		Kind:            opts.kind,
		Operation:       operation,
		CredentialsPath: credentialsPath,
		TeamID:          slot.teamID,
		Source:          source,
		Destination:     target,
	}
	fail := func(stage string, active SecretReference, cause error) error {
		return failCredentialCopy(out, output, stage, active, cause, writeRecovery)
	}

	stage := "update_credentials"
	var locked *CredentialsFile
	err = updateLockedCredentialsBytes(credentialsPath, func(current []byte) ([]byte, error) {
		fresh, document, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		freshSlot, err := locateCredentialSlot(fresh, opts.kind, opts.team)
		if err != nil {
			return nil, err
		}
		if ref := freshSlot.current(fresh); ref == nil || *ref != source || freshSlot.ids != slot.ids {
			return nil, fmt.Errorf("credentials changed since the copy started")
		}
		locked = fresh
		return freshSlot.rewrite(document, fresh, target)
	}, func() error {
		// Resolve and store under the credentials lock so the reference the
		// config will point at always holds the value the source held.
		stage = "resolve_source"
		value, err := resolveThroughRegistry(opts.kind, providers, source)
		if err != nil {
			return err
		}
		value, err = slot.normalize(locked, value)
		if err != nil {
			return err
		}
		stage = "store_destination"
		// A destination holding the same credential in another stored form
		// (a PEM with its trailing newline) already satisfies the copy;
		// Ensure would report it as a different secret.
		if existing, err := providers.Resolve(target); err == nil {
			if normalized, err := slot.normalize(locked, existing); err == nil && normalized == value {
				stage = "update_credentials"
				return nil
			}
		}
		written, err := providers.Ensure(target, value)
		output.SecretWritten = written
		if err != nil {
			return err
		}
		stage = "update_credentials"
		return nil
	})
	if err != nil {
		if output.SecretWritten {
			if rollbackErr := providers.Delete(target); rollbackErr != nil {
				return fail(stage, source, errors.Join(err, fmt.Errorf("roll back destination: %w", rollbackErr)))
			}
			output.SecretWritten = false
		}
		return fmt.Errorf("credential %s failed during %s: %w; %s is unchanged", operation, stage, err, credentialsPath)
	}
	output.CredentialsUpdated = true

	if opts.move {
		if err := providers.Delete(source); err != nil {
			return fail("delete_source", target, err)
		}
		output.SourceDeleted = true
	}
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if errOut != nil {
		fmt.Fprintf(errOut, "%s now resolves from %q in %s. Run 'moltnet agents activation refresh' and restart active agent processes.\n", opts.kind, destination, credentialsPath)
	}
	return nil
}

// failCredentialCopy reports a state that needs an operator: the result JSON
// on stdout and a protected recovery artifact, both value-free.
func failCredentialCopy(
	out io.Writer,
	output credentialCopyOutput,
	stage string,
	active SecretReference,
	cause error,
	writeRecovery func(credentialCopyRecovery) (string, error),
) error {
	output.ManualRecoveryRequired = true
	output.Stage = stage
	recoveryPath, recoveryErr := writeRecovery(credentialCopyRecovery{
		Stage:           stage,
		Reason:          cause.Error(),
		Kind:            output.Kind,
		CredentialsPath: output.CredentialsPath,
		Source:          output.Source,
		Destination:     output.Destination,
		ActiveReference: active,
		SecretWritten:   output.SecretWritten,
	})
	if recoveryErr == nil {
		output.RecoveryPath = recoveryPath
	}
	printErr := printJSONTo(out, output)

	var next string
	switch stage {
	case "delete_source":
		next = fmt.Sprintf("%s now references %s:%s; delete the unused source %s:%s manually", output.CredentialsPath, active.Provider, active.Key, output.Source.Provider, output.Source.Key)
	default:
		next = fmt.Sprintf("%s still references %s:%s; remove the unverified destination %s:%s manually before retrying", output.CredentialsPath, active.Provider, active.Key, output.Destination.Provider, output.Destination.Key)
	}
	err := fmt.Errorf("credential %s requires manual recovery after %s: %w; %s", output.Operation, stage, cause, next)
	if recoveryErr != nil {
		err = fmt.Errorf("%w (recovery artifact failed: %v)", err, recoveryErr)
	}
	if printErr != nil {
		err = fmt.Errorf("%w (result output failed: %v)", err, printErr)
	}
	return err
}

func writeCredentialCopyRecoveryFile(recovery credentialCopyRecovery) (string, error) {
	dir, err := defaultRecoveryDir()
	if err != nil {
		return "", err
	}
	return writeRecoveryArtifact(dir, "credential-copy-recovery-*.json", recovery)
}

// locateCredentialSlot returns the reference slot for kind. An agent key is
// selected exactly as resolution selects it, except that an explicit team
// must name a configured team key: it never falls back to the identity key.
func locateCredentialSlot(creds *CredentialsFile, kind credentialKind, team string) (*credentialSlot, error) {
	subjectIDs := credentialBindingIDs{SubjectID: creds.SubjectID, LegacyIdentityID: creds.legacyIdentityID}
	switch kind {
	case credentialOAuth2ClientSecret:
		ids := subjectIDs
		ids.ClientID = creds.OAuth2.ClientID
		return &credentialSlot{
			ids:     ids,
			current: func(c *CredentialsFile) *SecretReference { return c.OAuth2.ClientSecretRef },
			rewrite: func(document map[string]json.RawMessage, _ *CredentialsFile, ref SecretReference) ([]byte, error) {
				return rewriteSectionReference(document, "oauth2", "client_secret_ref", ref)
			},
			normalize: func(_ *CredentialsFile, value string) (string, error) {
				// The file provider strips one trailing newline on read; store
				// the form every provider returns identically.
				value = stripOneNewline(value)
				if value == "" {
					return "", &CredentialResolutionError{Kind: kind, Code: "invalid_value", Detail: "client secret is empty"}
				}
				return value, nil
			},
		}, nil
	case credentialIdentitySeed:
		return &credentialSlot{
			ids:     credentialBindingIDs{Fingerprint: creds.Keys.Fingerprint},
			current: func(c *CredentialsFile) *SecretReference { return c.Keys.PrivateKeyRef },
			rewrite: func(document map[string]json.RawMessage, _ *CredentialsFile, ref SecretReference) ([]byte, error) {
				return rewriteSectionReference(document, "keys", "private_key_ref", ref)
			},
			normalize: func(c *CredentialsFile, value string) (string, error) {
				seed := strings.TrimSpace(value)
				if err := assertSeedMatchesPublicKey(seed, c.Keys.PublicKey); err != nil {
					return "", err
				}
				return seed, nil
			},
		}, nil
	case credentialGitHubAppPrivateKey:
		appID := ""
		if creds.GitHub != nil {
			appID = creds.GitHub.AppID
		}
		return &credentialSlot{
			ids: credentialBindingIDs{AppID: appID},
			current: func(c *CredentialsFile) *SecretReference {
				if c.GitHub == nil {
					return nil
				}
				return c.GitHub.PrivateKeyRef
			},
			rewrite: func(document map[string]json.RawMessage, _ *CredentialsFile, ref SecretReference) ([]byte, error) {
				return rewriteSectionReference(document, "github", "private_key_ref", ref)
			},
			normalize: func(_ *CredentialsFile, value string) (string, error) {
				if _, err := parseRSAPrivateKey([]byte(value)); err != nil {
					return "", &CredentialResolutionError{Kind: kind, Code: "invalid_value", Detail: "value is not an RSA private key PEM"}
				}
				// Same normalization config migrate applies to a PEM file.
				return stripOneNewline(value), nil
			},
		}, nil
	case credentialAgentKey:
		teamID := strings.TrimSpace(team)
		if teamID == "" {
			selection, err := selectAgentKeyReference(creds, "")
			if err != nil {
				return nil, fmt.Errorf("%w (pass --team)", err)
			}
			if selection != nil {
				teamID = selection.TeamID
			}
		} else if _, ok := creds.AgentKeyRefs[teamID]; !ok {
			return nil, fmt.Errorf("no agent key configured for team %s", teamID)
		}
		ids := subjectIDs
		ids.TeamID = teamID
		return &credentialSlot{
			ids:    ids,
			teamID: teamID,
			current: func(c *CredentialsFile) *SecretReference {
				if teamID == "" {
					return c.AgentKeyRef
				}
				ref, ok := c.AgentKeyRefs[teamID]
				if !ok {
					return nil
				}
				return &ref
			},
			rewrite: func(document map[string]json.RawMessage, c *CredentialsFile, ref SecretReference) ([]byte, error) {
				return rewriteCredentialsDocument(document, func(top map[string]json.RawMessage) error {
					var value any = ref
					field := "agent_key_ref"
					if teamID != "" {
						refs := make(map[string]SecretReference, len(c.AgentKeyRefs))
						for id, existing := range c.AgentKeyRefs {
							refs[id] = existing
						}
						refs[teamID] = ref
						value, field = refs, "agent_key_refs"
					}
					encoded, err := json.Marshal(value)
					if err != nil {
						return err
					}
					top[field] = encoded
					return nil
				})
			},
			normalize: func(_ *CredentialsFile, value string) (string, error) {
				value = strings.TrimSpace(value)
				if value == "" {
					return "", &CredentialResolutionError{Kind: kind, Code: "invalid_value", Detail: "agent key is empty"}
				}
				return value, nil
			},
		}, nil
	}
	return nil, fmt.Errorf("unsupported credential kind %q", kind)
}

func rewriteSectionReference(document map[string]json.RawMessage, section, field string, ref SecretReference) ([]byte, error) {
	return rewriteCredentialsSection(document, section, func(values map[string]json.RawMessage) error {
		encoded, err := json.Marshal(ref)
		if err != nil {
			return err
		}
		values[field] = encoded
		return nil
	})
}
