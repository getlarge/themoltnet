package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// identityKeyRecoverOpts drives `moltnet agents identity-key recover`.
type identityKeyRecoverOpts struct {
	credentialsPath string
	apiURL          string
	// recoveryPath names the artifact a rotation left when it could not
	// tell whether the server switched keys. Empty when only the
	// key-derived files need regenerating.
	recoveryPath     string
	providers        *SecretProviderRegistry
	client           *moltnetapi.Client
	refreshArtifacts func(credentialsPath string, retiredPublicKey string) error
}

type identityKeyRecoverOutput struct {
	AgentID            string `json:"agentId"`
	CredentialsPath    string `json:"credentialsPath"`
	PublicKey          string `json:"publicKey"`
	Fingerprint        string `json:"fingerprint"`
	CredentialsUpdated bool   `json:"credentialsUpdated"`
	ArtifactsRefreshed bool   `json:"artifactsRefreshed"`
}

// runAgentsIdentityKeyRecoverCmd brings moltnet.json and the key-derived
// files in line with the identity key the server holds. It never deletes a
// seed: while the server still reports the old key, a rotation may yet
// commit, and deleting the staged seed then would lose the agent's new key.
func runAgentsIdentityKeyRecoverCmd(ctx context.Context, out, errOut io.Writer, opts identityKeyRecoverOpts) error {
	providers := opts.providers
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	refreshArtifacts := opts.refreshArtifacts
	if refreshArtifacts == nil {
		refreshArtifacts = refreshIdentityKeyArtifacts
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
	agentID, ok := creds.CanonicalSubject()
	if !ok {
		return fmt.Errorf("identity key recovery requires subject_type=agent and subject_id in %s", credentialsPath)
	}

	var recovery *identityKeyRotationRecovery
	if opts.recoveryPath != "" {
		recovery, err = readIdentityKeyRotationRecovery(opts.recoveryPath, agentID, credentialsPath)
		if err != nil {
			return err
		}
	}

	client := opts.client
	if client == nil {
		client, err = newConfigAuthenticatedClient(opts.apiURL, credentialsPath, providers)
		if err != nil {
			return err
		}
	}
	serverKey, err := currentServerPublicKey(ctx, client)
	if err != nil {
		return fmt.Errorf("ask the server which identity key it holds: %w; nothing was changed", err)
	}

	output := identityKeyRecoverOutput{
		AgentID:         agentID,
		CredentialsPath: credentialsPath,
		PublicKey:       creds.Keys.PublicKey,
		Fingerprint:     creds.Keys.Fingerprint,
	}
	retiredPublicKey := ""
	if recovery != nil && creds.Keys.PublicKey != recovery.PublicKey {
		switch serverKey {
		case recovery.PublicKey:
			if err := verifyStagedIdentitySeed(providers, recovery); err != nil {
				return err
			}
			if creds.Keys.PrivateKeyRef == nil {
				return fmt.Errorf("keys.private_key_ref is missing from %s; nothing was changed", credentialsPath)
			}
			if err := rewriteIdentityKeySection(credentialsPath, creds.Keys.PublicKey, *creds.Keys.PrivateKeyRef,
				recovery.PublicKey, recovery.Fingerprint, recovery.SeedReference); err != nil {
				return fmt.Errorf("update credentials: %w", err)
			}
			retiredPublicKey = creds.Keys.PublicKey
			output.PublicKey = recovery.PublicKey
			output.Fingerprint = recovery.Fingerprint
			output.CredentialsUpdated = true
		case creds.Keys.PublicKey:
			return fmt.Errorf("the server still uses the current key, so the rotation to %s has not committed; nothing was changed. Run this again later. The new seed stays at %s:%s; if the server never switches, it is unused and you can delete it with your keychain tool",
				recovery.Fingerprint, recovery.SeedReference.Provider, recovery.SeedReference.Key)
		default:
			return fmt.Errorf("the server holds an identity key that is neither the current key nor the one in %s; nothing was changed", opts.recoveryPath)
		}
	}
	if serverKey != output.PublicKey {
		return fmt.Errorf("%s names a different identity key than the server holds; pass --from with the rotation's recovery artifact", credentialsPath)
	}

	artifactsErr := refreshArtifacts(credentialsPath, retiredPublicKey)
	output.ArtifactsRefreshed = artifactsErr == nil
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if artifactsErr != nil {
		return fmt.Errorf("regenerate the SSH key, allowed_signers and env file: %w", artifactsErr)
	}
	if errOut != nil && output.CredentialsUpdated {
		fmt.Fprintf(errOut, "Completed the rotation to %s. Run 'moltnet agents activation refresh' and restart active agent processes.\n", output.Fingerprint)
	}
	return nil
}

func readIdentityKeyRotationRecovery(path, agentID, credentialsPath string) (*identityKeyRotationRecovery, error) {
	data, err := configmigrate.ReadBoundedRegularFile(path, maxMigrationConfigBytes)
	if err != nil {
		return nil, fmt.Errorf("read recovery artifact: %w", err)
	}
	var recovery identityKeyRotationRecovery
	if err := json.Unmarshal(data, &recovery); err != nil {
		return nil, fmt.Errorf("parse recovery artifact: %w", err)
	}
	if !strings.EqualFold(recovery.AgentID, agentID) {
		return nil, fmt.Errorf("the recovery artifact belongs to agent %s, not %s", recovery.AgentID, agentID)
	}
	if filepath.Clean(recovery.CredentialsPath) != filepath.Clean(credentialsPath) {
		return nil, fmt.Errorf("the recovery artifact is for %s, not %s; pass --credentials %s", recovery.CredentialsPath, credentialsPath, recovery.CredentialsPath)
	}
	if recovery.PublicKey == "" || recovery.SeedReference.Key == "" {
		return nil, fmt.Errorf("the recovery artifact does not name the new key and its seed")
	}
	return &recovery, nil
}

// verifyStagedIdentitySeed checks that the staged seed derives the key the
// server switched to before moltnet.json points at it.
func verifyStagedIdentitySeed(providers *SecretProviderRegistry, recovery *identityKeyRotationRecovery) error {
	seedB64, err := providers.Resolve(recovery.SeedReference)
	if err != nil {
		return fmt.Errorf("read the new seed at %s:%s: %w; nothing was changed", recovery.SeedReference.Provider, recovery.SeedReference.Key, err)
	}
	seed, err := decodeEd25519Seed(seedB64)
	if err != nil {
		return err
	}
	derived := "ed25519:" + base64.StdEncoding.EncodeToString(ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey))
	if derived != recovery.PublicKey {
		return fmt.Errorf("the seed at %s:%s does not derive %s; nothing was changed", recovery.SeedReference.Provider, recovery.SeedReference.Key, recovery.Fingerprint)
	}
	return nil
}
