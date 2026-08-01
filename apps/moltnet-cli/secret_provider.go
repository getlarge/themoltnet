package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	secretServiceName       = "themolt.net"
	osKeyringProviderName   = "os-keyring"
	environmentProviderName = "env"
)

var environmentSecretKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// SecretReference identifies a secret without embedding its value in config.
type SecretReference struct {
	Provider string `json:"provider"`
	Key      string `json:"key"`
}

// OAuth2SecretKey returns the stable account name used for an agent's OAuth2
// secret in an OS keyring.
func OAuth2SecretKey(identityID, clientID string) string {
	return fmt.Sprintf("oauth2/%s/%s", identityID, clientID)
}

// SecretProvider is the storage boundary used by credential consumers.
type SecretProvider interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

// SecretProviderRegistry resolves provider names without coupling config
// parsing to a specific local secret store.
type SecretProviderRegistry struct {
	providers map[string]SecretProvider
}

func NewSecretProviderRegistry() *SecretProviderRegistry {
	registry := &SecretProviderRegistry{providers: make(map[string]SecretProvider)}
	registry.Register(environmentProviderName, EnvironmentSecretProvider{})
	registry.Register(osKeyringProviderName, OSKeyringSecretProvider{})
	return registry
}

func (r *SecretProviderRegistry) Register(name string, provider SecretProvider) {
	if r == nil || provider == nil {
		return
	}
	if r.providers == nil {
		r.providers = make(map[string]SecretProvider)
	}
	r.providers[strings.TrimSpace(name)] = provider
}

func (r *SecretProviderRegistry) Resolve(ref SecretReference) (string, error) {
	if r == nil {
		return "", fmt.Errorf("secret provider registry is unavailable")
	}
	providerName := strings.TrimSpace(ref.Provider)
	key := strings.TrimSpace(ref.Key)
	if providerName == "" || key == "" {
		return "", fmt.Errorf("secret reference requires provider and key")
	}
	provider, ok := r.providers[providerName]
	if !ok {
		return "", fmt.Errorf("secret provider %q is not registered", providerName)
	}
	value, err := provider.Get(key)
	if err != nil {
		return "", fmt.Errorf("resolve secret reference with provider %q: %w", providerName, err)
	}
	if value == "" {
		return "", fmt.Errorf("secret provider %q returned an empty value", providerName)
	}
	return value, nil
}

// EnvironmentSecretProvider is a read-only provider for headless runtimes.
// Reference keys are environment variable names, never secret values.
type EnvironmentSecretProvider struct{}

func (EnvironmentSecretProvider) Get(key string) (string, error) {
	if !environmentSecretKeyPattern.MatchString(key) {
		return "", fmt.Errorf("invalid environment variable name")
	}
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		return "", fmt.Errorf("environment variable %s is not set", key)
	}
	return value, nil
}

func (EnvironmentSecretProvider) Set(_, _ string) error {
	return fmt.Errorf("environment secret provider is read-only")
}

func (EnvironmentSecretProvider) Delete(_ string) error {
	return fmt.Errorf("environment secret provider is read-only")
}

// OSKeyringSecretProvider stores secrets in the current operating system's
// credential store under the stable themolt.net service name.
type OSKeyringSecretProvider struct{}

func (OSKeyringSecretProvider) Get(key string) (string, error) {
	value, err := keyring.Get(secretServiceName, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return "", fmt.Errorf("secret not found")
	}
	return value, err
}

func (OSKeyringSecretProvider) Set(key, value string) error {
	return keyring.Set(secretServiceName, key, value)
}

func (OSKeyringSecretProvider) Delete(key string) error {
	err := keyring.Delete(secretServiceName, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return err
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
		return registry.Resolve(*ref)
	}
	if legacy != "" {
		fmt.Fprintln(os.Stderr, "Warning: plaintext oauth2.client_secret is deprecated; migrate it to a secret provider.")
		return legacy, nil
	}
	return "", fmt.Errorf("oauth2 config must set exactly one of client_secret or client_secret_ref")
}
