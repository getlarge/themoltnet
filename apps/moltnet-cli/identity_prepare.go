package main

import (
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
	store := identitySecretStore{registry: registry, provider: provider}
	if err := store.preflight(); err != nil {
		return identitySecretStore{}, fmt.Errorf("secret provider %q is unavailable: %w", provider, err)
	}
	return store, nil
}

// preflight writes and removes a throwaway value.
func (s identitySecretStore) preflight() error {
	ref := s.ref(fmt.Sprintf("preflight/%d/%d", os.Getpid(), time.Now().UnixNano()))
	if err := s.registry.Store(ref, "credential-store-preflight"); err != nil {
		return err
	}
	return s.registry.Delete(ref)
}

// ref names key in the store's provider without writing anything, so a config
// can reference a secret before the secret is stored.
func (s identitySecretStore) ref(key string) SecretReference {
	return SecretReference{Provider: s.provider, Key: key}
}

// store writes one more secret to the same provider as the seed.
func (s identitySecretStore) store(key, value string) (SecretReference, error) {
	ref := s.ref(key)
	if err := s.registry.Store(ref, value); err != nil {
		return ref, fmt.Errorf("store secret in %s: %w", s.provider, err)
	}
	return ref, nil
}

// prepareIdentity generates a keypair and stores its seed.
func (s identitySecretStore) prepareIdentity() (*preparedIdentity, error) {
	kp, err := GenerateKeyPair()
	if err != nil {
		return nil, err
	}
	ref := s.ref(IdentitySeedKey(kp.Fingerprint))
	if err := s.registry.Store(ref, kp.PrivateKey); err != nil {
		return nil, fmt.Errorf("store identity seed in %s: %w", s.provider, err)
	}
	return &preparedIdentity{KeyPair: kp, SeedRef: ref}, nil
}

// seedLocation names where the kept seed lives, for error messages.
func (p *preparedIdentity) seedLocation() string {
	return fmt.Sprintf("fingerprint %s, seed kept at %s:%s", p.KeyPair.Fingerprint, p.SeedRef.Provider, p.SeedRef.Key)
}

// withSeedLocation appends the kept seed to err, for every failure that
// happens once the seed is stored.
func (p *preparedIdentity) withSeedLocation(err error) error {
	return fmt.Errorf("%w (%s)", err, p.seedLocation())
}

// errIdentityExists reports that an identity config is already present. Every
// refusal to overwrite an identity wraps it through identityExistsError, so
// callers branch with errors.Is and the advice reads the same everywhere.
var errIdentityExists = errors.New("identity already exists")

// identityExistsError names the existing config and the non-destructive way
// to reuse its alias: moving the directory keeps the config, and the config
// keeps referencing its seed and secrets wherever they are stored.
func identityExistsError(path string) error {
	return fmt.Errorf(
		"%w at %s: choose another --name, or move %s aside to reuse the name (the moved config still references its seed and secrets)",
		errIdentityExists, path, filepath.Dir(path),
	)
}

// createIdentityConfig writes config at path only if nothing is there. The
// check and the write share the CLI writer lock, so two concurrent commands
// creating the same identity cannot overwrite each other.
func createIdentityConfig(config *CredentialsFile, path string) error {
	err := writeConfigFile(config, path, safefile.Create)
	if errors.Is(err, safefile.ErrExists) {
		return identityExistsError(path)
	}
	return err
}
