package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

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
	ClientID           string `json:"clientId"`
	CredentialsPath    string `json:"credentialsPath"`
	CredentialsUpdated bool   `json:"credentialsUpdated"`
	ClientSecret       string `json:"clientSecret,omitempty"`
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
			"Updated OAuth2 credentials in %s. Re-run 'legreffier setup' and restart active agent processes.\n",
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
	if gitConfig := strings.TrimSpace(os.Getenv("GIT_CONFIG_GLOBAL")); gitConfig != "" {
		configPath, err := resolveGitConfigGlobalPath(gitConfig)
		if err != nil {
			return "", fmt.Errorf("resolve GIT_CONFIG_GLOBAL: %w", err)
		}
		sibling := filepath.Join(filepath.Dir(configPath), "moltnet.json")
		if regularFileExists(sibling) {
			return sibling, nil
		}
	}

	configPath, err := GetConfigPath()
	if err != nil {
		return "", fmt.Errorf("resolve credentials path: %w", err)
	}
	if regularFileExists(configPath) {
		return configPath, nil
	}
	return configPath, nil
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
) (path string, err error) {
	if err := os.MkdirAll(recoveryDir, 0o700); err != nil {
		return "", err
	}
	if err := os.Chmod(recoveryDir, 0o700); err != nil {
		return "", err
	}

	file, err := os.CreateTemp(
		recoveryDir,
		"client-secret-recovery-*.json",
	)
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
	if err := json.NewEncoder(file).Encode(output); err != nil {
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
