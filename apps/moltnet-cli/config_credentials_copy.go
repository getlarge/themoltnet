package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

// credentialCopyKinds lists the kinds `config credentials copy` accepts,
// in the order help output shows them.
var credentialCopyKinds = []credentialKind{
	credentialOAuth2ClientSecret,
	credentialIdentitySeed,
	credentialGitHubAppPrivateKey,
	credentialAgentKey,
}

// credentialCopyOpts drives a provider-to-provider copy of one
// reference-backed credential. The destination key is always the canonical
// bound key for the kind, whatever form the source reference used.
//
// The source is never deleted: other configs (identities sharing a GitHub
// App, repository bundles, other hosts) may still reference it, and no local
// check can prove otherwise. Revocation belongs to the credential's own
// lifecycle (rotate or revoke), not to a copy.
type credentialCopyOpts struct {
	credentialsPath string
	kind            credentialKind
	destination     string
	team            string
	providers       *SecretProviderRegistry
}

// credentialCopyOutput is the machine-readable result. It carries references
// and state, never the secret value.
type credentialCopyOutput struct {
	Kind               credentialKind  `json:"kind"`
	CredentialsPath    string          `json:"credentialsPath"`
	TeamID             string          `json:"teamId,omitempty"`
	Source             SecretReference `json:"source"`
	Destination        SecretReference `json:"destination"`
	SecretWritten      bool            `json:"secretWritten"`
	CredentialsUpdated bool            `json:"credentialsUpdated"`
}

// credentialSlot locates one credential reference inside a credentials
// document: which identifiers bind it, and how to read and replace it.
type credentialSlot struct {
	ids     credentialBindingIDs
	teamID  string
	current func(*CredentialsFile) *SecretReference
	// legacyField names the plaintext field set alongside the reference, if
	// any. Readers reject that combination, so copy must too.
	legacyField func(*CredentialsFile) string
	rewrite     func(document map[string]json.RawMessage, creds *CredentialsFile, ref SecretReference) ([]byte, error)
	// normalize checks the value's shape, so a corrupt source is never
	// propagated, and returns the form the kind's reader consumes. Two values
	// with the same normalized form are the same credential to every reader,
	// so it may only drop bytes the reader ignores.
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
	providers := opts.providers
	if providers == nil {
		providers = NewSecretProviderRegistry()
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
	if field := slot.legacyField(creds); field != "" {
		return fmt.Errorf("%s sets both %s and its reference; readers reject that, so remove one before copying", credentialsPath, field)
	}
	source := *sourcePtr
	if err := validateSecretReferenceBinding(opts.kind, source, slot.ids); err != nil {
		return err
	}
	if source.Provider == destination {
		return fmt.Errorf("%s is already stored in the %q provider", opts.kind, destination)
	}
	canonical, err := expectedSecretKey(opts.kind, slot.ids)
	if err != nil {
		return err
	}
	target := SecretReference{Provider: destination, Key: canonical}

	output := credentialCopyOutput{
		Kind:            opts.kind,
		CredentialsPath: credentialsPath,
		TeamID:          slot.teamID,
		Source:          source,
		Destination:     target,
	}
	stage := "update_credentials"
	var locked *CredentialsFile
	var copied string
	err = updateLockedCredentialsBytes(credentialsPath, func(current []byte) ([]byte, error) {
		fresh, document, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		freshSlot, err := locateCredentialSlot(fresh, opts.kind, opts.team)
		if err != nil {
			return nil, err
		}
		if ref := freshSlot.current(fresh); ref == nil || *ref != source || freshSlot.ids != slot.ids || freshSlot.legacyField(fresh) != "" {
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
		if target.Provider == fileProviderName && strings.HasSuffix(value, "\n") {
			// The file provider strips one trailing newline on read, so it
			// would hand readers different bytes than the source holds.
			return fmt.Errorf("destination_unrepresentable: the %q provider cannot store a value ending in a newline", fileProviderName)
		}
		// A destination holding the same credential in a form its reader
		// treats identically (a PEM with its trailing newline) already
		// satisfies the copy; Ensure would report it as a different secret.
		if existing, err := providers.Resolve(target); err == nil {
			if normalized, err := slot.normalize(locked, existing); err == nil && normalized == value {
				stage = "update_credentials"
				return nil
			}
		}
		copied = value
		written, err := providers.Ensure(target, value)
		output.SecretWritten = written
		if err != nil {
			return err
		}
		stage = "update_credentials"
		return nil
	})
	if err != nil {
		// A destination this run wrote is never deleted: once Ensure released
		// its lock, another copy of the same credential may have adopted the
		// entry, and no local check can prove otherwise. It holds the same
		// value as the source, so leaving it unused is harmless.
		if output.SecretWritten {
			return fmt.Errorf("credential copy failed during %s: %w; %s is unchanged, and the copy stored at %s:%s is left in place (remove it only if no other config references it)",
				stage, err, credentialsPath, target.Provider, target.Key)
		}
		// A provider can fail after writing, so check what the destination
		// holds before saying nothing was copied.
		if copied != "" {
			if stored, readErr := providers.Resolve(target); readErr == nil && stored == copied {
				return fmt.Errorf("credential copy failed during %s: %w; %s is unchanged, but %s:%s already holds a copy of the value and is left in place (remove it only if no other config references it)",
					stage, err, credentialsPath, target.Provider, target.Key)
			}
		}
		return fmt.Errorf("credential copy failed during %s: %w; %s is unchanged", stage, err, credentialsPath)
	}
	output.CredentialsUpdated = true

	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if errOut != nil {
		fmt.Fprintf(errOut, "%s now resolves from %s:%s in %s. The source %s:%s is no longer referenced by this config but still holds the value; other configs may use it. Rotate or revoke the credential to invalidate every copy. Run 'moltnet agents activation refresh' and restart active agent processes.\n", opts.kind, target.Provider, target.Key, credentialsPath, source.Provider, source.Key)
	}
	return nil
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
			legacyField: func(c *CredentialsFile) string {
				// The OAuth2 reader treats any non-empty value as set.
				if c.OAuth2.ClientSecret == "" {
					return ""
				}
				return "oauth2.client_secret"
			},
			rewrite: func(document map[string]json.RawMessage, _ *CredentialsFile, ref SecretReference) ([]byte, error) {
				return rewriteSectionReference(document, "oauth2", "client_secret_ref", ref)
			},
			normalize: func(_ *CredentialsFile, value string) (string, error) {
				// The OAuth2 secret is used byte for byte: keep it exact.
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
			legacyField: func(c *CredentialsFile) string {
				return presentField(c.Keys.PrivateKey, "keys.private_key")
			},
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
			legacyField: func(c *CredentialsFile) string {
				if c.GitHub == nil {
					return ""
				}
				return presentField(c.GitHub.PrivateKeyPath, "github.private_key_path")
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
			ids:         ids,
			teamID:      teamID,
			legacyField: func(*CredentialsFile) string { return "" },
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

func presentField(value, name string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return name
}
