package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

// preparedIdentity is a freshly generated keypair whose seed is already
// durable in a secret provider. Commands that create an identity (register,
// agents init) prepare it before any network call, so a failure after the
// server commits can never lose the keypair.
//
// The seed is never deleted on a later failure. An orphaned seed costs one
// provider entry; a deleted seed can make a server-side identity permanently
// unrecoverable. Callers report the seed reference instead.
type preparedIdentity struct {
	KeyPair *KeyPair
	SeedRef SecretReference
}

// identitySecretStore is a writable secret destination that has passed the
// preflight probe.
type identitySecretStore struct {
	registry *SecretProviderRegistry
	provider string
}

// openIdentitySecretStore resolves destination (empty means the OS keyring)
// and proves the provider can store and remove a value, so a missing keyring
// fails before a remote identity exists.
func openIdentitySecretStore(registry *SecretProviderRegistry, destination string) (identitySecretStore, error) {
	if registry == nil {
		registry = NewSecretProviderRegistry()
	}
	provider, err := resolveSecretDestination(registry, destination)
	if err != nil {
		return identitySecretStore{}, err
	}
	if err := preflightSecretDestination(registry, provider); err != nil {
		return identitySecretStore{}, fmt.Errorf("secret provider %q is unavailable: %w", provider, err)
	}
	return identitySecretStore{registry: registry, provider: provider}, nil
}

// preflightSecretDestination writes and removes a throwaway value.
func preflightSecretDestination(registry *SecretProviderRegistry, provider string) error {
	ref := SecretReference{
		Provider: provider,
		Key:      fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano()),
	}
	if err := registry.Store(ref, "credential-store-preflight"); err != nil {
		return err
	}
	return registry.Delete(ref)
}

// prepareIdentity generates a keypair and stores its seed.
func (s identitySecretStore) prepareIdentity() (*preparedIdentity, error) {
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, err
	}
	ref := SecretReference{Provider: s.provider, Key: IdentitySeedKey(kp.Fingerprint)}
	if err := s.registry.Store(ref, kp.PrivateKey); err != nil {
		return nil, fmt.Errorf("store identity seed in %s: %w", s.provider, err)
	}
	return &preparedIdentity{KeyPair: kp, SeedRef: ref}, nil
}

// store writes one more secret to the same provider as the seed.
func (s identitySecretStore) store(key, value string) (SecretReference, error) {
	ref := SecretReference{Provider: s.provider, Key: key}
	if err := s.registry.Store(ref, value); err != nil {
		return ref, fmt.Errorf("store secret in %s: %w", s.provider, err)
	}
	return ref, nil
}

// seedLocation names where the kept seed lives, for error messages.
func (p *preparedIdentity) seedLocation() string {
	return fmt.Sprintf("fingerprint %s, seed kept at %s:%s", p.KeyPair.Fingerprint, p.SeedRef.Provider, p.SeedRef.Key)
}

// errIdentityExists reports that an identity config is already present.
var errIdentityExists = errors.New("identity already exists")

// createIdentityConfig writes config at path only if nothing is there. The
// check and the write share the CLI writer lock, so two concurrent commands
// creating the same identity cannot overwrite each other.
func createIdentityConfig(config *CredentialsFile, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := safefile.Create(path, append(data, '\n')); err != nil {
		if errors.Is(err, safefile.ErrExists) {
			return fmt.Errorf("%w at %s", errIdentityExists, path)
		}
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}
