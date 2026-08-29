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

const (
	identitySeedEnvKey        = "MOLTNET_PRIVATE_KEY"
	githubAppPrivateKeyEnvKey = "MOLTNET_GITHUB_APP_PRIVATE_KEY"
)

// credentialKind names a credential whose provider key shape is fixed by the
// binding table below; the same table exists in the Node SDK.
type credentialKind string

const (
	credentialOAuth2ClientSecret  credentialKind = "oauth2-client-secret"
	credentialIdentitySeed        credentialKind = "identity-seed"
	credentialGitHubAppPrivateKey credentialKind = "github-app-private-key"
	credentialAgentKey            credentialKind = "agent-key"
)

type credentialBindingIDs struct {
	IdentityID  string
	ClientID    string
	Fingerprint string
	AppID       string
}

// IdentitySeedKey returns the stable provider key for an agent's Ed25519 seed.
func IdentitySeedKey(fingerprint string) string {
	return "identity/" + fingerprint + "/seed"
}

// GitHubAppPrivateKeyKey returns the stable provider key for a GitHub App's
// RSA private key.
func GitHubAppPrivateKeyKey(appID string) string {
	return "github-app/" + appID + "/private-key"
}

// AgentKeyKey returns the stable provider key for an agent's team-bound key.
func AgentKeyKey(identityID string) string {
	return "agent-key/" + identityID
}

var secretProviderNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// parseSecretReferenceString parses the <provider>:<key> form used by
// environment references such as MOLTNET_AGENT_KEY_REF. The first colon splits.
func parseSecretReferenceString(value string) (SecretReference, error) {
	trimmed := strings.TrimSpace(value)
	provider, key, found := strings.Cut(trimmed, ":")
	if !found || !secretProviderNamePattern.MatchString(provider) || key == "" {
		return SecretReference{}, fmt.Errorf("secret reference must be <provider>:<key> with a lowercase provider name")
	}
	return SecretReference{Provider: provider, Key: key}, nil
}

func credentialEnvKey(kind credentialKind) string {
	switch kind {
	case credentialOAuth2ClientSecret:
		return environmentSecretKey
	case credentialIdentitySeed:
		return identitySeedEnvKey
	case credentialGitHubAppPrivateKey:
		return githubAppPrivateKeyEnvKey
	case credentialAgentKey:
		return agentKeyEnv
	}
	return ""
}

func expectedSecretKey(kind credentialKind, ids credentialBindingIDs) (string, error) {
	switch kind {
	case credentialOAuth2ClientSecret:
		if strings.TrimSpace(ids.IdentityID) == "" || strings.TrimSpace(ids.ClientID) == "" {
			return "", fmt.Errorf("credential binding requires identity_id and oauth2.client_id")
		}
		return OAuth2SecretKey(ids.IdentityID, ids.ClientID), nil
	case credentialIdentitySeed:
		if strings.TrimSpace(ids.Fingerprint) == "" {
			return "", fmt.Errorf("credential binding requires keys.fingerprint")
		}
		return IdentitySeedKey(ids.Fingerprint), nil
	case credentialGitHubAppPrivateKey:
		if strings.TrimSpace(ids.AppID) == "" {
			return "", fmt.Errorf("credential binding requires github.app_id")
		}
		return GitHubAppPrivateKeyKey(ids.AppID), nil
	case credentialAgentKey:
		if strings.TrimSpace(ids.IdentityID) == "" {
			return "", fmt.Errorf("credential binding requires identity_id")
		}
		return AgentKeyKey(ids.IdentityID), nil
	}
	return "", fmt.Errorf("unknown credential kind %q", kind)
}

// validateSecretReferenceBinding accepts the canonical key, the fixed env
// variable for the env provider, or — for the file provider, whose
// orchestrators may forbid "/" in credential IDs — the "."-flattened key.
func validateSecretReferenceBinding(kind credentialKind, ref SecretReference, ids credentialBindingIDs) error {
	canonical, err := expectedSecretKey(kind, ids)
	if err != nil {
		return err
	}
	if kind == credentialAgentKey && ref.Provider == environmentProviderName {
		// MOLTNET_AGENT_KEY selects environment mode before config is read,
		// so a config-bound env reference could never reach this path.
		return fmt.Errorf("agent_key_ref cannot use the env provider; set %s directly or reference a keyring/file secret", agentKeyEnv)
	}
	valid := ref.Key == canonical
	switch ref.Provider {
	case environmentProviderName:
		valid = ref.Key == credentialEnvKey(kind)
	case fileProviderName:
		valid = valid || ref.Key == strings.ReplaceAll(canonical, "/", ".")
	}
	if !valid {
		return fmt.Errorf("%s reference is not bound to this MoltNet identity", kind)
	}
	return nil
}

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
	registry.Register(fileProviderName, newFileSecretProviderFromEnv(os.LookupEnv))
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

func validateOAuth2SecretReferenceBinding(creds *CredentialsFile, ref SecretReference) error {
	if creds == nil {
		return fmt.Errorf("credentials are missing")
	}
	ids := credentialBindingIDs{IdentityID: creds.IdentityID, ClientID: creds.OAuth2.ClientID}
	if err := validateSecretReferenceBinding(credentialOAuth2ClientSecret, ref, ids); err != nil {
		return fmt.Errorf("oauth2 secret reference is not bound to this MoltNet identity and client")
	}
	return nil
}
