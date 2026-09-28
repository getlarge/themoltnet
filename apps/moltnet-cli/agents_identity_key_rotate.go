package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// identityKeyRotateOpts drives `moltnet agents identity-key rotate`.
type identityKeyRotateOpts struct {
	credentialsPath string
	apiURL          string
	providers       *SecretProviderRegistry
	// client is injected by tests; otherwise the credentials document
	// authenticates as its own subject.
	client *moltnetapi.Client
	now    func() time.Time
	rand   io.Reader
	// refreshArtifacts regenerates the key-derived files beside moltnet.json
	// (SSH export, allowed_signers, env). Tests stub it.
	refreshArtifacts func(credentialsPath string, retiredPublicKey string) error
	writeRecovery    func(identityKeyRotationRecovery) (string, error)
}

// identityKeyRotateOutput never carries a seed.
type identityKeyRotateOutput struct {
	AgentID             string          `json:"agentId"`
	CredentialsPath     string          `json:"credentialsPath"`
	PublicKey           string          `json:"publicKey"`
	Fingerprint         string          `json:"fingerprint"`
	PreviousFingerprint string          `json:"previousFingerprint"`
	SeedReference       SecretReference `json:"seedReference"`
	// RetiredSeedReference still holds the old seed. It can no longer make
	// signatures MoltNet accepts as current; delete it once nothing else
	// references it.
	RetiredSeedReference   SecretReference `json:"retiredSeedReference"`
	CredentialsUpdated     bool            `json:"credentialsUpdated"`
	ArtifactsRefreshed     bool            `json:"artifactsRefreshed"`
	ManualRecoveryRequired bool            `json:"manualRecoveryRequired,omitempty"`
	RecoveryPath           string          `json:"recoveryPath,omitempty"`
}

// identityKeyRotationRecovery is written when the server may have rotated but
// moltnet.json does not yet say so. The new seed is already stored at
// SeedReference, so the artifact carries references, never the seed.
type identityKeyRotationRecovery struct {
	Stage           string          `json:"stage"`
	Reason          string          `json:"reason"`
	CredentialsPath string          `json:"credentialsPath"`
	AgentID         string          `json:"agentId"`
	PublicKey       string          `json:"publicKey"`
	Fingerprint     string          `json:"fingerprint"`
	SeedReference   SecretReference `json:"seedReference"`
}

// identityKeyRotationTimeFormat is how the generated client encodes
// issuedAt. The signed message must contain exactly the string the server
// receives, so the timestamp is truncated to whole seconds and formatted the
// same way.
const identityKeyRotationTimeFormat = time.RFC3339

// buildIdentityKeyRotationMessage mirrors @moltnet/models
// buildIdentityKeyRotationMessage (v1).
func buildIdentityKeyRotationMessage(agentID, currentPublicKey, newPublicKey, issuedAt string) string {
	return strings.Join([]string{
		"moltnet:identity:rotate:v1",
		strings.ToLower(agentID),
		currentPublicKey,
		newPublicKey,
		issuedAt,
	}, "\n")
}

func runAgentsIdentityKeyRotateCmd(ctx context.Context, out, errOut io.Writer, opts identityKeyRotateOpts) error {
	providers := opts.providers
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	now := opts.now
	if now == nil {
		now = time.Now
	}
	random := opts.rand
	if random == nil {
		random = rand.Reader
	}
	refreshArtifacts := opts.refreshArtifacts
	if refreshArtifacts == nil {
		refreshArtifacts = refreshIdentityKeyArtifacts
	}
	writeRecovery := opts.writeRecovery
	if writeRecovery == nil {
		writeRecovery = writeIdentityKeyRotationRecoveryFile
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
		return fmt.Errorf("identity key rotation requires subject_type=agent and subject_id in %s; run 'moltnet config migrate' first", credentialsPath)
	}
	currentRef := creds.Keys.PrivateKeyRef
	if currentRef == nil {
		return fmt.Errorf("keys.private_key is stored in plaintext; run 'moltnet config migrate' before rotating the identity key")
	}
	// The new seed goes where the current one lives. Checked before anything
	// is generated or sent.
	if !providers.CanWrite(currentRef.Provider) {
		return fmt.Errorf("the %q provider holding the identity seed is not writable; nothing was changed", currentRef.Provider)
	}
	currentSeedB64, err := resolveIdentitySeed(creds, providers)
	if err != nil {
		return err
	}
	currentSeed, err := decodeEd25519Seed(currentSeedB64)
	if err != nil {
		return err
	}
	currentPublicKey := creds.Keys.PublicKey

	newPublic, newPrivate, err := ed25519.GenerateKey(random)
	if err != nil {
		return fmt.Errorf("generate identity key: %w", err)
	}
	newPublicKey := "ed25519:" + base64.StdEncoding.EncodeToString(newPublic)
	newFingerprint := Fingerprint(newPublic)
	newRef := SecretReference{Provider: currentRef.Provider, Key: IdentitySeedKey(newFingerprint)}

	// Store the new seed before the server can switch to it, so a crash at
	// any later point never loses the only copy of the agent's new key.
	if _, err := providers.Ensure(newRef, base64.StdEncoding.EncodeToString(newPrivate.Seed())); err != nil {
		return fmt.Errorf("store the new identity seed: %w; nothing was rotated", err)
	}
	discardStaged := func() {
		_ = providers.Delete(newRef)
	}

	issued := now().UTC().Truncate(time.Second)
	message := buildIdentityKeyRotationMessage(agentID, currentPublicKey, newPublicKey, issued.Format(identityKeyRotationTimeFormat))
	request := moltnetapi.RotateIdentityKeyRequest{
		IssuedAt:             issued,
		NewPublicKey:         newPublicKey,
		PreviousKeySignature: base64.StdEncoding.EncodeToString(ed25519.Sign(ed25519.NewKeyFromSeed(currentSeed), []byte(message))),
		NewKeySignature:      base64.StdEncoding.EncodeToString(ed25519.Sign(newPrivate, []byte(message))),
	}

	client := opts.client
	if client == nil {
		client, err = newConfigAuthenticatedClient(opts.apiURL, credentialsPath, providers)
		if err != nil {
			discardStaged()
			return err
		}
	}

	output := identityKeyRotateOutput{
		AgentID:              agentID,
		CredentialsPath:      credentialsPath,
		PublicKey:            newPublicKey,
		Fingerprint:          newFingerprint,
		PreviousFingerprint:  creds.Keys.Fingerprint,
		SeedReference:        newRef,
		RetiredSeedReference: *currentRef,
	}
	needRecovery := func(stage string, cause error) error {
		output.ManualRecoveryRequired = true
		path, recoveryErr := writeRecovery(identityKeyRotationRecovery{
			Stage:           stage,
			Reason:          cause.Error(),
			CredentialsPath: credentialsPath,
			AgentID:         agentID,
			PublicKey:       newPublicKey,
			Fingerprint:     newFingerprint,
			SeedReference:   newRef,
		})
		if recoveryErr == nil {
			output.RecoveryPath = path
		}
		_ = printJSONTo(out, output)
		if recoveryErr != nil {
			return fmt.Errorf("identity key rotation needs manual recovery after %s: %w; the new seed is stored at %s:%s and the server may already use %s. Writing the recovery artifact failed (%v): once 'moltnet agents whoami' reports %s, set keys.public_key, keys.fingerprint and keys.private_key_ref in %s to match",
				stage, cause, newRef.Provider, newRef.Key, newFingerprint, recoveryErr, newFingerprint, credentialsPath)
		}
		return fmt.Errorf("identity key rotation needs recovery after %s: %w; the new seed is stored at %s:%s and the server may already use %s. Run 'moltnet agents identity-key recover --from %s' to finish once the server reports the new key",
			stage, cause, newRef.Provider, newRef.Key, newFingerprint, path)
	}

	res, callErr := client.RotateIdentityKey(ctx, moltnetapi.NewOptRotateIdentityKeyRequest(request))
	rotated, isRotated := res.(*moltnetapi.RotateIdentityKeyResponse)
	switch {
	case callErr == nil && isRotated:
		if rotated.AgentId.String() != agentID || rotated.PublicKey != newPublicKey {
			return needRecovery("verify_response", fmt.Errorf("the server reported a different agent or key"))
		}
	case callErr == nil && isDefiniteRotationRejection(res):
		discardStaged()
		return fmt.Errorf("identity key rotation rejected: %w; nothing was changed", formatAPIError(res))
	default:
		// Transport failure or a 5xx: the server may have committed.
		// Ask which key it holds before deciding.
		cause := callErr
		if cause == nil {
			cause = formatAPIError(res)
		}
		serverKey, whoamiErr := currentServerPublicKey(ctx, client)
		switch {
		case whoamiErr == nil && serverKey == currentPublicKey:
			// Not proof of failure: the server's workflow may still commit
			// the rotation after the request failed, so the new seed stays.
			return needRecovery("rotate_identity_key", fmt.Errorf("%w; the server still reported the current key, but the rotation may yet commit", cause))
		case whoamiErr == nil && serverKey == newPublicKey:
			if errOut != nil {
				fmt.Fprintf(errOut, "Warning: the rotation response failed (%v) but the server now uses the new key; completing the local update.\n", cause)
			}
		default:
			return needRecovery("rotate_identity_key", cause)
		}
	}

	if err := rewriteIdentityKeySection(credentialsPath, currentPublicKey, *currentRef, newPublicKey, newFingerprint, newRef); err != nil {
		return needRecovery("update_credentials", err)
	}
	output.CredentialsUpdated = true

	artifactsErr := refreshArtifacts(credentialsPath, currentPublicKey)
	output.ArtifactsRefreshed = artifactsErr == nil
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if artifactsErr != nil {
		// Git would keep signing with the retired key: not a success.
		return fmt.Errorf("rotated the identity key to %s and updated %s, but regenerating the SSH key, allowed_signers and env file failed: %w. Run 'moltnet agents identity-key recover' to regenerate them",
			newFingerprint, credentialsPath, artifactsErr)
	}
	if errOut != nil {
		fmt.Fprintf(errOut, "Rotated the identity key to %s. The retired seed is still stored at %s:%s; delete it once no other config references it. Run 'moltnet agents activation refresh' and restart active agent processes.\n",
			newFingerprint, currentRef.Provider, currentRef.Key)
	}
	return nil
}

// isDefiniteRotationRejection reports responses after which the server has
// certainly not rotated: validation, signature, conflict and auth failures.
func isDefiniteRotationRejection(res moltnetapi.RotateIdentityKeyRes) bool {
	switch res.(type) {
	case *moltnetapi.RotateIdentityKeyBadRequest,
		*moltnetapi.RotateIdentityKeyUnauthorized,
		*moltnetapi.RotateIdentityKeyForbidden,
		*moltnetapi.RotateIdentityKeyConflict,
		*moltnetapi.RotateIdentityKeyTooManyRequests:
		return true
	}
	return false
}

func currentServerPublicKey(ctx context.Context, client *moltnetapi.Client) (string, error) {
	res, err := client.GetWhoami(ctx)
	if err != nil {
		return "", err
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		return "", formatAPIError(res)
	}
	key, ok := whoami.PublicKey.Get()
	if !ok {
		return "", fmt.Errorf("whoami did not report a public key")
	}
	return key, nil
}

// rewriteIdentityKeySection points keys.* at the new key, but only while the
// document still names the key this rotation retired.
func rewriteIdentityKeySection(path, currentPublicKey string, currentRef SecretReference, publicKey, fingerprint string, ref SecretReference) error {
	return updateLockedCredentialsBytes(path, func(current []byte) ([]byte, error) {
		creds, document, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		if creds.Keys.PublicKey != currentPublicKey || creds.Keys.PrivateKeyRef == nil || *creds.Keys.PrivateKeyRef != currentRef {
			return nil, fmt.Errorf("keys changed since the rotation started")
		}
		return rewriteCredentialsSection(document, "keys", func(section map[string]json.RawMessage) error {
			for field, value := range map[string]any{
				"public_key":      publicKey,
				"fingerprint":     fingerprint,
				"private_key_ref": ref,
			} {
				encoded, err := json.Marshal(value)
				if err != nil {
					return err
				}
				section[field] = encoded
			}
			return nil
		})
	})
}

// refreshIdentityKeyArtifacts regenerates everything derived from the
// identity key: the SSH key pair git signs with, allowed_signers (new key
// first, retired keys kept so earlier commits still verify locally), and the
// env file's MOLTNET_FINGERPRINT. An empty retiredPublicKey adds no retired
// line; keys already listed are kept either way.
func refreshIdentityKeyArtifacts(credentialsPath, retiredPublicKey string) error {
	if err := runSSHKeyExportCmd(io.Discard, credentialsPath, ""); err != nil {
		return fmt.Errorf("regenerate SSH keys: %w", err)
	}
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return err
	}
	if creds == nil {
		return fmt.Errorf("credentials disappeared during rotation")
	}
	configDir := filepath.Dir(credentialsPath)
	if creds.Git != nil && strings.TrimSpace(creds.Git.Email) != "" {
		if err := writeRotatedAllowedSigners(configDir, creds.Git.Email, creds.Keys.PublicKey, retiredPublicKey); err != nil {
			return err
		}
	}
	return writeAgentEnvFile(io.Discard, configDir, filepath.Base(configDir), creds)
}

// writeRotatedAllowedSigners writes the new key's signer line first, keeps
// every earlier line, and adds the retired key if it is not listed yet.
func writeRotatedAllowedSigners(configDir, gitEmail, publicKey, retiredPublicKey string) error {
	newLine, err := allowedSignerLine(gitEmail, publicKey)
	if err != nil {
		return err
	}
	lines := []string{newLine}
	if retiredPublicKey != "" {
		retiredLine, err := allowedSignerLine(gitEmail, retiredPublicKey)
		if err != nil {
			return err
		}
		lines = append(lines, retiredLine)
	}
	_, err = writeAllowedSignerLines(configDir, lines)
	return err
}

func allowedSignerLine(gitEmail, publicKey string) (string, error) {
	sshKey, err := ToSSHPublicKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("convert public key: %w", err)
	}
	return fmt.Sprintf("%s %s", gitEmail, strings.TrimSpace(sshKey)), nil
}

func writeIdentityKeyRotationRecoveryFile(recovery identityKeyRotationRecovery) (string, error) {
	dir, err := defaultRecoveryDir()
	if err != nil {
		return "", err
	}
	return writeRecoveryArtifact(dir, "identity-key-rotation-recovery-*.json", recovery)
}
