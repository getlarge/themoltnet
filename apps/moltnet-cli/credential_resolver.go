package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
)

// CredentialResolutionError classifies a failed credential lookup without
// carrying the value. Codes: ambiguous, missing, unbound, invalid_value,
// provider_failure. Cause retains the underlying provider error for callers
// that deliberately surface diagnostics; Error() never includes it.
type CredentialResolutionError struct {
	Kind   credentialKind
	Code   string
	Detail string
	Cause  error
}

func (e *CredentialResolutionError) Error() string {
	return fmt.Sprintf("%s: %s", e.Kind, e.Detail)
}

func (e *CredentialResolutionError) Unwrap() error { return e.Cause }

// resolveThroughRegistry normalizes provider failures into a value-free
// provider_failure error, keeping the raw cause only for errors.As callers.
func resolveThroughRegistry(kind credentialKind, registry *SecretProviderRegistry, ref SecretReference) (string, error) {
	value, err := registry.Resolve(ref)
	if err != nil {
		return "", &CredentialResolutionError{
			Kind:   kind,
			Code:   "provider_failure",
			Detail: fmt.Sprintf("secret provider %q could not resolve the reference", ref.Provider),
			Cause:  err,
		}
	}
	return value, nil
}

var (
	legacyCredentialWarningWriter io.Writer // nil → os.Stderr
	legacyWarningsMu              sync.Mutex
	legacyWarnings                = map[string]bool{}
)

func legacyField(kind credentialKind) string {
	switch kind {
	case credentialOAuth2ClientSecret:
		return "oauth2.client_secret"
	case credentialIdentitySeed:
		return "keys.private_key"
	case credentialAgentKey:
		return "agent_key"
	}
	return string(kind)
}

// warnLegacyCredentialOnce prints the plaintext deprecation notice once per
// process per MoltNet-owned credential kind, never including the value.
func warnLegacyCredentialOnce(kind credentialKind) {
	warnLegacyCredentialFieldOnce(legacyField(kind))
}

// warnLegacyCredentialFieldOnce prints the deprecation notice for one config
// field once per process. Consumers that own a credential (github.go) call
// it with their own field so every legacy form warns the same way.
func warnLegacyCredentialFieldOnce(field string) {
	legacyWarningsMu.Lock()
	defer legacyWarningsMu.Unlock()
	if legacyWarnings[field] {
		return
	}
	legacyWarnings[field] = true
	w := legacyCredentialWarningWriter
	if w == nil {
		w = os.Stderr
	}
	fmt.Fprintf(w, "Warning: plaintext %s in moltnet.json is deprecated; run 'moltnet config migrate' to move it to a secret provider reference (see docs/reference/agent-configuration.md).\n", field)
}

func resetLegacyCredentialWarnings() {
	legacyWarningsMu.Lock()
	defer legacyWarningsMu.Unlock()
	legacyWarnings = map[string]bool{}
}

func resolveOAuth2Secret(creds *CredentialsFile, registry *SecretProviderRegistry) (string, error) {
	if creds == nil {
		return "", fmt.Errorf("credentials are missing")
	}
	legacy := creds.OAuth2.ClientSecret
	ref := creds.OAuth2.ClientSecretRef
	if legacy != "" && ref != nil {
		return "", fmt.Errorf("oauth2 config must set exactly one of client_secret or client_secret_ref")
	}
	if ref != nil {
		if err := validateOAuth2SecretReferenceBinding(creds, *ref); err != nil {
			return "", err
		}
		return registry.Resolve(*ref)
	}
	if legacy != "" {
		warnLegacyCredentialOnce(credentialOAuth2ClientSecret)
		return legacy, nil
	}
	return "", fmt.Errorf("oauth2 config must set exactly one of client_secret or client_secret_ref")
}

func stripEd25519Prefix(publicKey string) string {
	return strings.TrimPrefix(strings.TrimSpace(publicKey), "ed25519:")
}

func assertSeedMatchesPublicKey(seedB64, publicKey string) error {
	seed, err := decodeEd25519Seed(seedB64)
	if err != nil {
		return &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "invalid_value", Detail: "seed must be a base64-encoded 32-byte Ed25519 seed"}
	}
	derived := base64.StdEncoding.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey))
	if derived != stripEd25519Prefix(publicKey) {
		return &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "invalid_value", Detail: "seed does not derive keys.public_key"}
	}
	return nil
}

// resolveIdentitySeed returns the agent's Ed25519 seed from keys.private_key
// (legacy, warned once) or keys.private_key_ref, verifying the reference is
// bound to this identity and that the value derives keys.public_key.
func resolveIdentitySeed(creds *CredentialsFile, registry *SecretProviderRegistry) (string, error) {
	if creds == nil {
		return "", &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "missing", Detail: "credentials are missing"}
	}
	legacy := strings.TrimSpace(creds.Keys.PrivateKey)
	ref := creds.Keys.PrivateKeyRef
	if legacy != "" && ref != nil {
		return "", &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "ambiguous", Detail: "config must set exactly one of keys.private_key or keys.private_key_ref"}
	}
	var seed string
	switch {
	case ref != nil:
		ids := credentialBindingIDs{Fingerprint: creds.Keys.Fingerprint}
		if err := validateSecretReferenceBinding(credentialIdentitySeed, *ref, ids); err != nil {
			return "", &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "unbound", Detail: err.Error()}
		}
		value, err := resolveThroughRegistry(credentialIdentitySeed, registry, *ref)
		if err != nil {
			return "", err
		}
		seed = strings.TrimSpace(value)
	case legacy != "":
		warnLegacyCredentialOnce(credentialIdentitySeed)
		seed = legacy
	default:
		return "", &CredentialResolutionError{Kind: credentialIdentitySeed, Code: "missing", Detail: "config must set exactly one of keys.private_key or keys.private_key_ref"}
	}
	if err := assertSeedMatchesPublicKey(seed, creds.Keys.PublicKey); err != nil {
		return "", err
	}
	return seed, nil
}

// resolveAgentKey returns the team-bound agent key from agent_key_ref. The
// boolean reports whether a reference was configured at all; callers fall
// back to OAuth2 when it is false.
func resolveAgentKey(creds *CredentialsFile, registry *SecretProviderRegistry) (string, bool, error) {
	kind := credentialAgentKey
	if creds == nil || creds.AgentKeyRef == nil {
		return "", false, nil
	}
	if err := validateSecretReferenceBinding(kind, *creds.AgentKeyRef, credentialBindingIDs{IdentityID: creds.IdentityID}); err != nil {
		return "", true, &CredentialResolutionError{Kind: kind, Code: "unbound", Detail: err.Error()}
	}
	value, err := resolveThroughRegistry(kind, registry, *creds.AgentKeyRef)
	if err != nil {
		return "", true, err
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true, &CredentialResolutionError{Kind: kind, Code: "invalid_value", Detail: "agent key is empty"}
	}
	return value, true, nil
}

// resolveEnvSecretReference resolves an environment-supplied <provider>:<key>
// reference. The runtime environment is deployer-controlled, so no identity
// binding is enforced — only the reference shape.
func resolveEnvSecretReference(raw string, registry *SecretProviderRegistry) (string, error) {
	ref, err := parseSecretReferenceString(raw)
	if err != nil {
		return "", err
	}
	value, err := registry.Resolve(ref)
	if err != nil {
		// Value-free: name the reference, keep the provider's message wrapped.
		return "", fmt.Errorf("secret provider %q could not resolve %s:%s: %w", ref.Provider, ref.Provider, ref.Key, err)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("secret reference %s:%s resolved to an empty value", ref.Provider, ref.Key)
	}
	return value, nil
}
