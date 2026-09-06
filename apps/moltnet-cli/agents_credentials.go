package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

const credentialsRotationRecoveryNotice = "The server rotated the secret, but the credentials file was not updated. Capture stdout now; it contains the only recovery copy."

const credentialsRecoveryFileNotice = "Recovery JSON was written to %s because stdout failed. Move the secret into the credentials file, then delete the recovery file immediately."

type agentsCredentialsRotateOpts struct {
	apiURL         string
	apiURLExplicit bool
	credPath       string
	yes            bool
	showSecret     bool
	noUpdate       bool
	out            io.Writer
	errOut         io.Writer

	preflightCredentials func(string) error
	writeCredentials     func(string, []byte) error
	writeRecoveryFile    func(rotateCredentialsOutput) (string, error)
	secretReference      *SecretReference
	secretProviders      *SecretProviderRegistry
}

type rotateCredentialsOutput struct {
	ClientID           string           `json:"clientId"`
	CredentialsPath    string           `json:"credentialsPath,omitempty"`
	SecretReference    *SecretReference `json:"secretReference,omitempty"`
	CredentialsUpdated bool             `json:"credentialsUpdated"`
	ClientSecret       string           `json:"clientSecret,omitempty"`
}

type agentsCredentialsRecoverOpts struct {
	apiURL         string
	apiURLExplicit bool
	credPath       string
	yes            bool
	out            io.Writer
	errOut         io.Writer
	destination    string

	preflightCredentials   func(string) error
	writeCredentials       func(string, []byte) error
	writeRecoveryFile      func(rotateCredentialsOutput) (string, error)
	secretProviders        *SecretProviderRegistry
	verifyCredentials      func(string, string, string) error
	reconcileCredentials   func(string, *CredentialsFile, string, SecretReference) error
	writeRecoveredArtifact func(recoveredSecretArtifact) (string, error)
}

// recoveredCredentialsOutput intentionally contains no bearer material. The
// replacement exists only in the provider and, while persistence is pending,
// in a mode-0600 recovery artifact.
type recoveredCredentialsOutput struct {
	ClientID               string          `json:"clientId"`
	SecretReference        SecretReference `json:"secretReference"`
	PersistenceState       string          `json:"persistenceState"`
	RecoveryPath           string          `json:"recoveryPath,omitempty"`
	ManualRecoveryRequired bool            `json:"manualRecoveryRequired,omitempty"`
}

type recoveredSecretArtifact struct {
	ClientID               string          `json:"clientId"`
	SecretReference        SecretReference `json:"secretReference"`
	ClientSecret           string          `json:"clientSecret,omitempty"`
	ManualRecoveryRequired bool            `json:"manualRecoveryRequired,omitempty"`
}

func runAgentsCredentialsRecoverCmd(opts agentsCredentialsRecoverOpts) error {
	if !opts.yes {
		return fmt.Errorf(
			"credential recovery replaces the current client secret; re-run with --yes to confirm",
		)
	}

	credentialsPath, err := resolveCredentialsPath(opts.credPath)
	if err != nil {
		return err
	}
	creds, _, err := readCredentialsDocument(credentialsPath)
	if err != nil {
		return err
	}
	secretProviders := opts.secretProviders
	if secretProviders == nil {
		secretProviders = NewSecretProviderRegistry()
	}
	seed, err := resolveIdentitySeed(creds, secretProviders)
	if err != nil {
		return err
	}
	destinationProvider, err := resolveRecoveryDestinationProvider(creds, opts.destination, secretProviders)
	if err != nil {
		return err
	}

	apiURL := resolveAPIURLFromCredentials(
		opts.apiURL,
		opts.apiURLExplicit,
		creds,
	)
	client, err := moltnetapi.NewClient(
		strings.TrimRight(apiURL, "/"),
		nil,
		moltnetapi.WithClient(newAPIHTTPClient()),
	)
	if err != nil {
		return fmt.Errorf("agents credentials recover: create API client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	challengeRes, err := client.RequestRecoveryChallenge(
		ctx,
		&moltnetapi.RecoveryChallengeRequest{
			PublicKey: creds.Keys.PublicKey,
			Purpose:   moltnetapi.RecoveryPurposeCredentials,
		},
	)
	if err != nil {
		return fmt.Errorf(
			"agents credentials recover: request challenge: %w",
			formatTransportError(err),
		)
	}
	challenge, ok := challengeRes.(*moltnetapi.RecoveryChallengeResponse)
	if !ok {
		return fmt.Errorf(
			"agents credentials recover: request challenge: %w",
			formatAPIError(challengeRes),
		)
	}
	signature, err := SignRawMessage(challenge.Challenge, seed)
	if err != nil {
		return fmt.Errorf("agents credentials recover: sign challenge: %w", err)
	}
	recoveryRes, err := client.RecoverAgentCredentials(
		ctx,
		&moltnetapi.RecoveryProof{
			Challenge: challenge.Challenge,
			Hmac:      challenge.Hmac,
			PublicKey: creds.Keys.PublicKey,
			Signature: signature,
		},
	)
	if err != nil {
		return fmt.Errorf(
			"agents credentials recover: replace credentials: %w",
			formatTransportError(err),
		)
	}
	recovery, ok := recoveryRes.(*moltnetapi.RecoveryCredentialsResponse)
	if !ok {
		return fmt.Errorf(
			"agents credentials recover: replace credentials: %w",
			formatAPIError(recoveryRes),
		)
	}
	clientSecret, err := DecryptFromAgent(
		recovery.SealedClientSecret, seed,
	)
	if err != nil {
		return fmt.Errorf("agents credentials recover: decrypt response: %w", err)
	}
	if recovery.ClientId == "" || clientSecret == "" {
		return fmt.Errorf(
			"agents credentials recover: server returned an incomplete credential pair",
		)
	}
	destination := SecretReference{Provider: destinationProvider, Key: OAuth2SecretKey(creds.IdentityID, recovery.ClientId)}
	verifyCredentials := opts.verifyCredentials
	if verifyCredentials == nil {
		verifyCredentials = verifyRecoveredOAuth2Credentials
	}
	if err := verifyCredentials(apiURL, recovery.ClientId, clientSecret); err != nil {
		return fmt.Errorf("agents credentials recover: verify replacement OAuth2 credentials: %w", err)
	}

	writeArtifact := opts.writeRecoveredArtifact
	if writeArtifact == nil {
		writeArtifact = writeRecoveredSecretArtifact
	}
	artifactPath, err := writeArtifact(recoveredSecretArtifact{ClientID: recovery.ClientId, SecretReference: destination, ClientSecret: clientSecret})
	if err != nil {
		return fmt.Errorf("agents credentials recover: write protected recovery artifact: %w", err)
	}
	output := recoveredCredentialsOutput{ClientID: recovery.ClientId, SecretReference: destination, PersistenceState: "pending", RecoveryPath: artifactPath}
	if err := secretProviders.Replace(destination, clientSecret); err != nil {
		_ = printJSONTo(opts.out, output)
		return fmt.Errorf("agents credentials recover: store replacement: %w (recovery artifact: %s)", err, artifactPath)
	}
	reconcile := opts.reconcileCredentials
	if reconcile == nil {
		reconcile = reconcileRecoveredCredentials
	}
	if err := reconcile(credentialsPath, creds, recovery.ClientId, destination); err != nil {
		partialPath, partialErr := writeArtifact(recoveredSecretArtifact{ClientID: recovery.ClientId, SecretReference: destination, ManualRecoveryRequired: true})
		if partialErr == nil {
			_ = os.Remove(artifactPath)
			artifactPath = partialPath
		}
		output.PersistenceState = "stored_config_pending"
		output.RecoveryPath = artifactPath
		output.ManualRecoveryRequired = true
		_ = printJSONTo(opts.out, output)
		return fmt.Errorf("agents credentials recover: replacement stored but credentials config was not reconciled: %w", err)
	}
	if err := os.Remove(artifactPath); err != nil {
		return fmt.Errorf("agents credentials recover: remove protected recovery artifact: %w", err)
	}
	output.PersistenceState = "stored"
	output.RecoveryPath = ""
	if err := printJSONTo(opts.out, output); err != nil {
		return err
	}
	if opts.errOut != nil {
		fmt.Fprintf(opts.errOut, "Updated the OAuth2 secret in %s. Restart active agent processes.\n", destination.Provider)
	}
	return nil
}

func resolveRecoveryDestinationProvider(creds *CredentialsFile, requested string, registry *SecretProviderRegistry) (string, error) {
	if strings.TrimSpace(requested) == "" {
		if creds.OAuth2.ClientSecretRef == nil {
			return "", fmt.Errorf("--destination is required when oauth2.client_secret is plaintext")
		}
		if _, err := validateMigrationDestination(registry, creds.OAuth2.ClientSecretRef.Provider); err != nil {
			return "", err
		}
		return creds.OAuth2.ClientSecretRef.Provider, nil
	}
	provider, err := validateMigrationDestination(registry, requested)
	if err != nil {
		return "", err
	}
	return provider, nil
}

func reconcileRecoveredCredentials(path string, original *CredentialsFile, clientID string, destination SecretReference) error {
	lock, err := safefile.Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	raw, err := safefile.ReadBoundedRegularFile(path, maxMigrationConfigBytes)
	if err != nil {
		return err
	}
	var current CredentialsFile
	var currentDocument map[string]json.RawMessage
	if err := json.Unmarshal(raw, &current); err != nil {
		return fmt.Errorf("parse credentials: %w", err)
	}
	if err := json.Unmarshal(raw, &currentDocument); err != nil {
		return fmt.Errorf("parse credentials document: %w", err)
	}
	if current.IdentityID != original.IdentityID || current.OAuth2.ClientID != original.OAuth2.ClientID || current.Keys.Fingerprint != original.Keys.Fingerprint || !sameOAuth2Source(original, &current) {
		return fmt.Errorf("credentials identity, client, or OAuth2 source changed concurrently")
	}
	updated, err := updateCredentialsDocumentWithReference(currentDocument, clientID, destination)
	if err != nil {
		return err
	}
	return lock.Replace(raw, updated, maxMigrationConfigBytes)
}

func sameOAuth2Source(a, b *CredentialsFile) bool {
	if (a.OAuth2.ClientSecretRef == nil) != (b.OAuth2.ClientSecretRef == nil) {
		return false
	}
	if a.OAuth2.ClientSecretRef != nil && *a.OAuth2.ClientSecretRef != *b.OAuth2.ClientSecretRef {
		return false
	}
	return (a.OAuth2.ClientSecret == "") == (b.OAuth2.ClientSecret == "")
}

func updateCredentialsDocumentWithReference(document map[string]json.RawMessage, clientID string, ref SecretReference) ([]byte, error) {
	updated := make(map[string]json.RawMessage, len(document))
	for key, value := range document {
		updated[key] = value
	}
	var oauth2 map[string]json.RawMessage
	if raw := updated["oauth2"]; raw != nil {
		if err := json.Unmarshal(raw, &oauth2); err != nil {
			return nil, fmt.Errorf("parse oauth2 credentials: %w", err)
		}
	}
	if oauth2 == nil {
		oauth2 = map[string]json.RawMessage{}
	}
	encoded, err := json.Marshal(ref)
	if err != nil {
		return nil, err
	}
	oauth2["client_secret_ref"] = encoded
	oauth2["client_id"], err = json.Marshal(clientID)
	if err != nil {
		return nil, err
	}
	delete(oauth2, "client_secret")
	encoded, err = json.Marshal(oauth2)
	if err != nil {
		return nil, err
	}
	updated["oauth2"] = encoded
	data, err := json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func writeRecoveredSecretArtifact(payload recoveredSecretArtifact) (string, error) {
	dir, err := defaultRecoveryDir()
	if err != nil {
		return "", err
	}
	return writeRecoveryArtifact(dir, "client-secret-recovery-*.json", payload)
}

func verifyRecoveredOAuth2Credentials(apiURL, clientID, clientSecret string) error {
	tm := NewTokenManager(apiURL, clientID, clientSecret)
	if _, err := tm.GetToken(); err != nil {
		return fmt.Errorf("verify replacement OAuth2 credentials: %w", err)
	}
	return nil
}

func emitRecoveredCredentials(
	opts agentsCredentialsRecoverOpts,
	output rotateCredentialsOutput,
	clientSecret string,
) error {
	output.ClientSecret = clientSecret
	if err := printJSONTo(opts.out, output); err == nil {
		if opts.errOut != nil {
			fmt.Fprintln(opts.errOut, credentialsRotationRecoveryNotice)
		}
		return fmt.Errorf(
			"agents credentials recover: server recovery succeeded but local credentials were not safely updated; recover the new secret from stdout",
		)
	}

	writeRecoveryFile := opts.writeRecoveryFile
	if writeRecoveryFile == nil {
		writeRecoveryFile = writeCredentialsRecoveryFile
	}
	recoveryPath, err := writeRecoveryFile(output)
	if err != nil {
		return fmt.Errorf(
			"agents credentials recover: local persistence, recovery output, and protected recovery file all failed",
		)
	}
	if opts.errOut != nil {
		fmt.Fprintf(opts.errOut, credentialsRecoveryFileNotice+"\n", recoveryPath)
	}
	return fmt.Errorf(
		"agents credentials recover: recovery output failed; recover the new secret from %s",
		recoveryPath,
	)
}

func runAgentsCredentialsRotateCmd(opts agentsCredentialsRotateOpts) error {
	if err := validateAgentsCredentialsRotateOpts(opts); err != nil {
		return err
	}

	credentialsPath, err := resolveCredentialsPath(opts.credPath)
	if err != nil {
		return err
	}
	creds, document, err := readCredentialsDocument(credentialsPath)
	if err != nil {
		return err
	}
	if creds.OAuth2.ClientID == "" {
		return fmt.Errorf(
			"credentials missing client_id — run 'moltnet register'",
		)
	}
	secretProviders := NewSecretProviderRegistry()
	clientSecret, err := resolveOAuth2Secret(creds, secretProviders)
	if err != nil {
		return fmt.Errorf("resolve OAuth2 client secret: %w", err)
	}
	opts.secretReference = creds.OAuth2.ClientSecretRef
	opts.secretProviders = secretProviders
	opts.apiURL = resolveAPIURLFromCredentials(
		opts.apiURL,
		opts.apiURLExplicit,
		creds,
	)

	if !opts.noUpdate {
		preflightCredentials := opts.preflightCredentials
		if preflightCredentials == nil {
			preflightCredentials = preflightCredentialsWrite
		}
		if err := preflightCredentials(credentialsPath); err != nil {
			return fmt.Errorf(
				"credentials file is not safely writable; rotation was not attempted: %w",
				err,
			)
		}
	}

	// This command deliberately ignores MOLTNET_AGENT_KEY. The OAuth2 client
	// being rotated must authenticate its own rotation request.
	tm := NewTokenManager(
		opts.apiURL,
		creds.OAuth2.ClientID,
		clientSecret,
	)
	client, err := newBearerClient(
		opts.apiURL,
		func(_ context.Context) (string, error) {
			return tm.GetToken()
		},
		tm.httpClient,
	)
	if err != nil {
		return fmt.Errorf("agents credentials rotate: create OAuth2 client: %w", err)
	}

	return runAgentsCredentialsRotateWithClient(
		context.Background(),
		client,
		credentialsPath,
		document,
		creds.OAuth2.ClientID,
		opts,
	)
}

func validateAgentsCredentialsRotateOpts(
	opts agentsCredentialsRotateOpts,
) error {
	if !opts.yes {
		return fmt.Errorf("rotation is irreversible; re-run with --yes to confirm")
	}
	if opts.noUpdate && !opts.showSecret {
		return fmt.Errorf("--no-update requires --show-secret so the new secret is not lost")
	}
	return nil
}

func runAgentsCredentialsRotateWithClient(
	ctx context.Context,
	client *moltnetapi.Client,
	credentialsPath string,
	document map[string]json.RawMessage,
	expectedClientID string,
	opts agentsCredentialsRotateOpts,
) error {
	res, err := client.RotateClientSecret(ctx)
	if err != nil {
		return fmt.Errorf(
			"agents credentials rotate: %w",
			formatTransportError(err),
		)
	}
	rotated, ok := res.(*moltnetapi.RotateSecretResponse)
	if !ok {
		return formatAPIError(res)
	}
	if rotated.ClientSecret == "" {
		return fmt.Errorf(
			"agents credentials rotate: server returned an incomplete credential pair",
		)
	}

	output := rotateCredentialsOutput{
		ClientID:        rotated.ClientId,
		CredentialsPath: credentialsPath,
	}
	if rotated.ClientId == "" || rotated.ClientId != expectedClientID {
		return emitCredentialsRecovery(opts, output, rotated.ClientSecret)
	}

	if opts.noUpdate {
		output.ClientSecret = rotated.ClientSecret
		if err := printJSONTo(opts.out, output); err != nil {
			return emitCredentialsRecoveryFile(opts, output)
		}
		return nil
	}
	if opts.secretReference != nil {
		if err := opts.secretProviders.Store(*opts.secretReference, rotated.ClientSecret); err != nil {
			return emitCredentialsRecovery(opts, output, rotated.ClientSecret)
		}
		output.CredentialsUpdated = true
		if opts.showSecret {
			output.ClientSecret = rotated.ClientSecret
		}
		if err := printJSONTo(opts.out, output); err != nil {
			return err
		}
		if opts.errOut != nil {
			fmt.Fprintln(opts.errOut, "Updated the referenced OAuth2 secret. Restart active agent processes.")
		}
		return nil
	}

	updatedDocument, err := updateCredentialsDocument(
		document,
		rotated.ClientId,
		rotated.ClientSecret,
	)
	if err != nil {
		return emitCredentialsRecovery(opts, output, rotated.ClientSecret)
	}
	writeCredentials := opts.writeCredentials
	if writeCredentials == nil {
		writeCredentials = writeCredentialsAtomic
	}
	if err := writeCredentials(credentialsPath, updatedDocument); err != nil {
		return emitCredentialsRecovery(opts, output, rotated.ClientSecret)
	}

	output.CredentialsUpdated = true
	if opts.showSecret {
		output.ClientSecret = rotated.ClientSecret
	}
	if err := printJSONTo(opts.out, output); err != nil {
		return err
	}
	if opts.errOut != nil {
		fmt.Fprintf(
			opts.errOut,
			"Updated OAuth2 credentials in %s. Restart active agent processes to load them.\n",
			credentialsPath,
		)
	}
	return nil
}

func emitCredentialsRecovery(
	opts agentsCredentialsRotateOpts,
	output rotateCredentialsOutput,
	clientSecret string,
) error {
	output.ClientSecret = clientSecret
	if err := printJSONTo(opts.out, output); err != nil {
		return emitCredentialsRecoveryFile(opts, output)
	}
	if opts.errOut != nil {
		fmt.Fprintln(opts.errOut, credentialsRotationRecoveryNotice)
	}
	return fmt.Errorf(
		"agents credentials rotate: server rotation succeeded but local credentials were not updated for %s; recover the new secret from stdout",
		output.CredentialsPath,
	)
}

func emitCredentialsRecoveryFile(
	opts agentsCredentialsRotateOpts,
	output rotateCredentialsOutput,
) error {
	writeRecoveryFile := opts.writeRecoveryFile
	if writeRecoveryFile == nil {
		writeRecoveryFile = writeCredentialsRecoveryFile
	}
	recoveryPath, err := writeRecoveryFile(output)
	if err != nil {
		return fmt.Errorf(
			"agents credentials rotate: local persistence, recovery output, and protected recovery file all failed",
		)
	}
	if opts.errOut != nil {
		fmt.Fprintf(
			opts.errOut,
			credentialsRecoveryFileNotice+"\n",
			recoveryPath,
		)
	}
	return fmt.Errorf(
		"agents credentials rotate: server rotation succeeded but recovery output failed; recover the new secret from %s",
		recoveryPath,
	)
}

func resolveCredentialsPath(explicit string) (string, error) {
	if value := strings.TrimSpace(explicit); value != "" {
		return absolutePath(value)
	}
	if value := strings.TrimSpace(os.Getenv("MOLTNET_CREDENTIALS_PATH")); value != "" {
		return absolutePath(value)
	}
	alias, err := resolveIdentityAlias("")
	if err != nil {
		return "", fmt.Errorf("resolve credentials path: %w", err)
	}
	return identityCredentialsPath(alias)
}

func absolutePath(path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve credentials path: %w", err)
	}
	return filepath.Clean(resolved), nil
}

func readCredentialsDocument(
	path string,
) (*CredentialsFile, map[string]json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("read credentials: %w", err)
	}
	var creds CredentialsFile
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, nil, fmt.Errorf("parse credentials: %w", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, nil, fmt.Errorf("parse credentials document: %w", err)
	}
	return &creds, document, nil
}

func preflightCredentialsWrite(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", path)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".moltnet-credentials-preflight-*")
	if err != nil {
		return fmt.Errorf("create temporary file beside %s: %w", path, err)
	}
	tempPath := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close temporary file beside %s: %w", path, err)
	}
	if err := os.Remove(tempPath); err != nil {
		return fmt.Errorf("remove temporary file beside %s: %w", path, err)
	}
	return nil
}

func updateCredentialsDocument(
	document map[string]json.RawMessage,
	clientID string,
	clientSecret string,
) ([]byte, error) {
	updated := make(map[string]json.RawMessage, len(document))
	for key, value := range document {
		updated[key] = value
	}

	var oauth2 map[string]json.RawMessage
	if raw, ok := updated["oauth2"]; ok {
		if err := json.Unmarshal(raw, &oauth2); err != nil {
			return nil, fmt.Errorf("parse oauth2 credentials: %w", err)
		}
	}
	if oauth2 == nil {
		oauth2 = make(map[string]json.RawMessage)
	}
	clientIDJSON, err := json.Marshal(clientID)
	if err != nil {
		return nil, fmt.Errorf("marshal client ID: %w", err)
	}
	clientSecretJSON, err := json.Marshal(clientSecret)
	if err != nil {
		return nil, fmt.Errorf("marshal client secret: %w", err)
	}
	oauth2["client_id"] = clientIDJSON
	oauth2["client_secret"] = clientSecretJSON
	updated["oauth2"], err = json.Marshal(oauth2)
	if err != nil {
		return nil, fmt.Errorf("marshal oauth2 credentials: %w", err)
	}
	data, err := json.MarshalIndent(updated, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal credentials: %w", err)
	}
	return append(data, '\n'), nil
}

func writeCredentialsAtomic(path string, data []byte) error {
	if err := writeFileAtomic(path, data); err != nil {
		return fmt.Errorf("replace credentials file: %w", err)
	}
	return nil
}

func writeCredentialsRecoveryFile(
	output rotateCredentialsOutput,
) (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	recoveryDir := filepath.Join(cacheDir, "moltnet", "recovery")
	return writeCredentialsRecoveryFileToDir(recoveryDir, output)
}

func writeCredentialsRecoveryFileToDir(
	recoveryDir string,
	output rotateCredentialsOutput,
) (string, error) {
	return writeRecoveryArtifact(recoveryDir, "client-secret-recovery-*.json", output)
}

// defaultRecoveryDir is the user-private location for protected recovery
// artifacts (secrets or partial-state diagnostics that must outlive a failed
// stdout write).
func defaultRecoveryDir() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cacheDir, "moltnet", "recovery"), nil
}

// writeRecoveryArtifact durably writes payload as a mode-0600 JSON file in
// recoveryDir and returns its path.
func writeRecoveryArtifact(recoveryDir, pattern string, payload any) (path string, err error) {
	if err := os.MkdirAll(recoveryDir, 0o700); err != nil {
		return "", err
	}
	if err := os.Chmod(recoveryDir, 0o700); err != nil {
		return "", err
	}

	file, err := os.CreateTemp(recoveryDir, pattern)
	if err != nil {
		return "", err
	}
	recoveryPath := file.Name()
	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(recoveryPath)
		}
	}()

	if err := file.Chmod(privateFileMode); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := json.NewEncoder(file).Encode(payload); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	syncDirectoryBestEffort(recoveryDir)
	keep = true
	return recoveryPath, nil
}

func syncDirectoryBestEffort(path string) {
	directory, err := os.Open(path)
	if err != nil {
		return
	}
	defer directory.Close()
	_ = directory.Sync()
}
