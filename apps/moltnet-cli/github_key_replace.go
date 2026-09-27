package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
)

// githubKeyReplaceOpts drives `moltnet github key replace`: store a new GitHub
// App private key in place of the one github.private_key_ref resolves to.
type githubKeyReplaceOpts struct {
	credentialsPath string
	privateKeyPath  string
	providers       *SecretProviderRegistry
	httpClient      *http.Client
}

// githubKeyReplaceOutput is value-free: it names the reference, never the PEM.
type githubKeyReplaceOutput struct {
	AppID           string          `json:"appId"`
	CredentialsPath string          `json:"credentialsPath"`
	Reference       SecretReference `json:"reference"`
	KeyVerified     bool            `json:"keyVerified"`
	SecretReplaced  bool            `json:"secretReplaced"`
	TokenCacheReset bool            `json:"tokenCacheReset"`
}

var errGitHubKeyReferenceChanged = errors.New("github.private_key_ref changed")

// runGitHubKeyReplaceCmd overwrites the stored App key after proving the new
// one belongs to the configured App. The reference in moltnet.json is left
// unchanged, so every config that points at the same provider entry (all
// identities sharing the App in one store) switches together. Copies held by
// other providers keep the old key and stop working once it is deleted on
// GitHub.
func runGitHubKeyReplaceCmd(ctx context.Context, out, errOut io.Writer, opts githubKeyReplaceOpts) error {
	providers := opts.providers
	if providers == nil {
		providers = NewSecretProviderRegistry()
	}
	client := opts.httpClient
	if client == nil {
		client = &http.Client{Timeout: githubHTTPTimeout}
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
	if creds.GitHub == nil || strings.TrimSpace(creds.GitHub.AppID) == "" {
		return fmt.Errorf("GitHub App not configured in %s", credentialsPath)
	}
	appID := strings.TrimSpace(creds.GitHub.AppID)
	ref := creds.GitHub.PrivateKeyRef
	// Resolution rejects a config that sets both, so replacing the key would
	// report success while `moltnet github token` still fails.
	if ref != nil && strings.TrimSpace(creds.GitHub.PrivateKeyPath) != "" {
		return fmt.Errorf("github config must set exactly one of private_key_path or private_key_ref; nothing was changed")
	}
	if ref == nil {
		if strings.TrimSpace(creds.GitHub.PrivateKeyPath) != "" {
			return fmt.Errorf("github.private_key_path is a legacy file reference; run 'moltnet config migrate' first, or replace that file directly")
		}
		return fmt.Errorf("github.private_key_ref is not configured in %s", credentialsPath)
	}
	if err := validateSecretReferenceBinding(credentialGitHubAppPrivateKey, *ref, credentialBindingIDs{AppID: appID}); err != nil {
		return err
	}
	// Checked before GitHub is contacted, so an unwritable reference never
	// leaves the operator with a verified key and nowhere to put it.
	if !providers.CanWrite(ref.Provider) {
		return fmt.Errorf("the %q provider holding the GitHub App key is not writable; nothing was changed", ref.Provider)
	}

	pemData, err := configmigrate.ReadBoundedRegularFile(opts.privateKeyPath, maxMigrationConfigBytes)
	if err != nil {
		return fmt.Errorf("read --private-key: %w", err)
	}
	privKey, err := parseRSAPrivateKey(pemData)
	if err != nil {
		return fmt.Errorf("--private-key is not an RSA private key PEM")
	}
	jwt, err := createAppJWT(appID, privKey)
	if err != nil {
		return err
	}
	if err := verifyGitHubAppKey(ctx, client, appID, jwt); err != nil {
		return fmt.Errorf("the new key was not accepted for GitHub App %s; nothing was changed: %w", appID, err)
	}

	output := githubKeyReplaceOutput{
		AppID:           appID,
		CredentialsPath: credentialsPath,
		Reference:       *ref,
		KeyVerified:     true,
	}
	// Replace under the credentials lock, after checking that the config
	// still names the reference read above: a concurrent credential copy may
	// have moved it, and replacing a no-longer-active entry would report
	// success while the active key stayed unchanged. The document itself is
	// rewritten unchanged.
	var written bool
	err = updateLockedCredentialsBytes(credentialsPath, func(current []byte) ([]byte, error) {
		fresh, _, err := parseCredentialsDocument(current)
		if err != nil {
			return nil, err
		}
		if fresh.GitHub == nil || strings.TrimSpace(fresh.GitHub.AppID) != appID ||
			fresh.GitHub.PrivateKeyRef == nil || *fresh.GitHub.PrivateKeyRef != *ref ||
			strings.TrimSpace(fresh.GitHub.PrivateKeyPath) != "" {
			return nil, errGitHubKeyReferenceChanged
		}
		return current, nil
	}, func() error {
		// Same normalization config migrate applies to a PEM file; the key
		// parser ignores the trailing newline the file provider would strip.
		var err error
		written, err = providers.ReplaceWithResult(*ref, stripOneNewline(string(pemData)))
		return err
	})
	output.SecretReplaced = written && err == nil
	if err != nil {
		switch {
		case errors.Is(err, errGitHubKeyReferenceChanged):
			return fmt.Errorf("github.private_key_ref in %s changed while the key was being verified; nothing was changed, run the command again", credentialsPath)
		case written:
			return fmt.Errorf("stored the new GitHub App key at %s:%s but could not verify it: %w; re-run the command before deleting the old key on GitHub", ref.Provider, ref.Key, err)
		}
		return fmt.Errorf("store the new GitHub App key: %w; the old key is unchanged", err)
	}

	cacheDir, cacheErr := credentialsDir(credentialsPath)
	if cacheErr == nil {
		cacheErr = resetGitHubTokenCache(cacheDir)
	}
	output.TokenCacheReset = cacheErr == nil
	if err := printJSONTo(out, output); err != nil {
		return err
	}
	if errOut != nil {
		if cacheErr != nil {
			fmt.Fprintf(errOut, "Warning: could not clear the GitHub token cache in %s: %v. Cached tokens stay valid until they expire.\n", cacheDir, cacheErr)
		}
		fmt.Fprintf(errOut, "Stored the new GitHub App key at %s:%s. Confirm 'moltnet github token' works, then delete the old key in the GitHub App settings: copies of it in other providers stop working at that point.\n", ref.Provider, ref.Key)
	}
	return nil
}

// verifyGitHubAppKey proves the key signs for appID: GET /app accepts only a
// JWT signed by one of the App's current keys and names the App it belongs to.
func verifyGitHubAppKey(ctx context.Context, client *http.Client, appID, jwt string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIBaseURL+"/app", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("GitHub API request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}
	var app struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(body, &app); err != nil {
		return fmt.Errorf("parse GitHub App response: %w", err)
	}
	if strconv.FormatInt(app.ID, 10) != appID {
		return fmt.Errorf("the key belongs to GitHub App %d", app.ID)
	}
	return nil
}

// resetGitHubTokenCache removes cached installation tokens, installation
// lookups and refresh-failure markers so the next command mints with the new
// key. Cached tokens are not keyed by the private key.
func resetGitHubTokenCache(cacheDir string) error {
	var errs []error
	for _, path := range []string{
		filepath.Join(cacheDir, "gh-token-cache"),
		tokenCachePath(cacheDir),
		tokenRefreshFailurePath(cacheDir),
	} {
		if err := os.RemoveAll(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
