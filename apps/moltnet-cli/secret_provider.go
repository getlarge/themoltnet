package main

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/oskeyring"
	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

const (
	secretServiceName       = "themolt.net"
	osKeyringProviderName   = "os-keyring"
	environmentProviderName = "env"
	environmentSecretKey    = "MOLTNET_CLIENT_SECRET"
)

var environmentSecretKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

var ErrSecretNotFound = errors.New("secret not found")

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

// windowsKeyringTarget documents the target shared by the Go and Node Windows
// keyring adapters.
func windowsKeyringTarget(service, key string) string {
	return service + "/" + key
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
	providerName, key, provider, err := r.provider(ref)
	if err != nil {
		return "", err
	}
	value, err := provider.Get(key)
	if err != nil {
		return "", fmt.Errorf("resolve secret reference with provider %q: %w", providerName, err)
	}
	if value == "" {
		return "", fmt.Errorf("secret provider %q returned an empty value: %w", providerName, ErrSecretNotFound)
	}
	return value, nil
}

func (r *SecretProviderRegistry) Store(ref SecretReference, value string) error {
	providerName, key, provider, err := r.provider(ref)
	if err != nil {
		return err
	}
	if value == "" {
		return fmt.Errorf("secret value is required")
	}
	lock, err := safefile.AcquireNamed("secret-provider", providerName+"\x00"+key)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := provider.Set(key, value); err != nil {
		return fmt.Errorf("store secret with provider %q: %w", providerName, err)
	}
	return nil
}

// Ensure stores value only when the destination is absent, then verifies the
// stored value while holding the provider/key lock. The returned changed flag
// remains true when storage succeeded but verification failed.
func (r *SecretProviderRegistry) Ensure(ref SecretReference, value string) (changed bool, err error) {
	providerName, key, provider, err := r.provider(ref)
	if err != nil {
		return false, err
	}
	if value == "" {
		return false, fmt.Errorf("secret value is required")
	}
	lock, err := safefile.AcquireNamed("secret-provider", providerName+"\x00"+key)
	if err != nil {
		return false, err
	}
	defer lock.Close()

	existing, err := provider.Get(key)
	if err == nil && existing == "" {
		err = ErrSecretNotFound
	}
	switch {
	case err == nil && existing == value:
		return false, nil
	case err == nil:
		return false, fmt.Errorf("destination already contains a different secret")
	case !errors.Is(err, ErrSecretNotFound):
		return false, fmt.Errorf("inspect destination secret: %w", err)
	}
	if err := provider.Set(key, value); err != nil {
		return false, fmt.Errorf("store destination secret: %w", err)
	}
	changed = true
	verified, err := provider.Get(key)
	if err != nil {
		return true, fmt.Errorf("verify destination secret: %w", err)
	}
	if verified != value {
		return true, fmt.Errorf("verify destination secret: stored value does not match")
	}
	return true, nil
}

func (r *SecretProviderRegistry) Delete(ref SecretReference) error {
	providerName, key, provider, err := r.provider(ref)
	if err != nil {
		return err
	}
	lock, err := safefile.AcquireNamed("secret-provider", providerName+"\x00"+key)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := provider.Delete(key); err != nil && !errors.Is(err, ErrSecretNotFound) {
		return fmt.Errorf("delete secret with provider %q: %w", providerName, err)
	}
	return nil
}

func (r *SecretProviderRegistry) provider(ref SecretReference) (string, string, SecretProvider, error) {
	if r == nil {
		return "", "", nil, fmt.Errorf("secret provider registry is unavailable")
	}
	providerName := strings.TrimSpace(ref.Provider)
	key := strings.TrimSpace(ref.Key)
	if providerName == "" || key == "" {
		return "", "", nil, fmt.Errorf("secret reference requires provider and key")
	}
	provider, ok := r.providers[providerName]
	if !ok {
		return "", "", nil, fmt.Errorf("secret provider %q is not registered", providerName)
	}
	return providerName, key, provider, nil
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
		return "", fmt.Errorf("environment variable %s is not set: %w", key, ErrSecretNotFound)
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
	value, err := oskeyring.Get(secretServiceName, key)
	if errors.Is(err, oskeyring.ErrNotFound) {
		return "", ErrSecretNotFound
	}
	return value, err
}

func (OSKeyringSecretProvider) Set(key, value string) error {
	return oskeyring.Set(secretServiceName, key, value)
}

func (OSKeyringSecretProvider) Delete(key string) error {
	err := oskeyring.Delete(secretServiceName, key)
	if errors.Is(err, oskeyring.ErrNotFound) {
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
		if err := validateOAuth2SecretReferenceBinding(creds, *ref); err != nil {
			return "", err
		}
		return registry.Resolve(*ref)
	}
	if legacy != "" {
		fmt.Fprintln(os.Stderr, "Warning: plaintext oauth2.client_secret is deprecated; migrate it to a secret provider.")
		return legacy, nil
	}
	return "", fmt.Errorf("oauth2 config must set exactly one of client_secret or client_secret_ref")
}

func validateOAuth2SecretReferenceBinding(creds *CredentialsFile, ref SecretReference) error {
	if creds == nil {
		return fmt.Errorf("credentials are missing")
	}
	expectedKey := OAuth2SecretKey(creds.IdentityID, creds.OAuth2.ClientID)
	valid := ref.Key == expectedKey
	if ref.Provider == environmentProviderName {
		valid = ref.Key == environmentSecretKey
	}
	if !valid {
		return fmt.Errorf("oauth2 secret reference is not bound to this MoltNet identity and client")
	}
	return nil
}
