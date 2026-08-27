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
// carrying the value. Codes: ambiguous, missing, unbound, invalid_value.
type CredentialResolutionError struct {
	Kind   credentialKind
	Code   string
	Detail string
}

func (e *CredentialResolutionError) Error() string {
	return fmt.Sprintf("%s: %s", e.Kind, e.Detail)
}

var (
	legacyCredentialWarningWriter io.Writer // nil → os.Stderr
	legacyWarningsMu              sync.Mutex
	legacyWarnings                = map[credentialKind]bool{}
)

func legacyField(kind credentialKind) string {
	switch kind {
	case credentialOAuth2ClientSecret:
		return "oauth2.client_secret"
	case credentialIdentitySeed:
		return "keys.private_key"
	}
	return string(kind)
}

// warnLegacyCredentialOnce prints the plaintext deprecation notice once per
// process per credential kind, never including the value.
func warnLegacyCredentialOnce(kind credentialKind) {
	legacyWarningsMu.Lock()
	defer legacyWarningsMu.Unlock()
	if legacyWarnings[kind] {
		return
	}
	legacyWarnings[kind] = true
	w := legacyCredentialWarningWriter
	if w == nil {
		w = os.Stderr
	}
	fmt.Fprintf(w, "Warning: plaintext %s in moltnet.json is deprecated; move it to a secret provider with 'moltnet config migrate'.\n", legacyField(kind))
}

func resetLegacyCredentialWarnings() {
	legacyWarningsMu.Lock()
	defer legacyWarningsMu.Unlock()
	legacyWarnings = map[credentialKind]bool{}
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
		value, err := registry.Resolve(*ref)
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
