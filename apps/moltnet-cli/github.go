package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// runGitHubSetupCmd is the flag-free business logic for github setup.
// GitHub App private keys are a github.go-owned credential: the binding
// table in secret_provider.go knows nothing about them.
const (
	credentialGitHubAppPrivateKey credentialKind = "github-app-private-key"
	githubAppPrivateKeyEnvKey                    = "MOLTNET_GITHUB_APP_PRIVATE_KEY"
)

// GitHubAppPrivateKeyKey returns the stable provider key for a GitHub App's
// RSA private key.
func GitHubAppPrivateKeyKey(appID string) string {
	return "github-app/" + appID + "/private-key"
}

func githubAppPrivateKeyBinding(appID string) (secretReferenceBinding, error) {
	if strings.TrimSpace(appID) == "" {
		return secretReferenceBinding{}, fmt.Errorf("credential binding requires github.app_id")
	}
	return secretReferenceBinding{
		canonicalKey: GitHubAppPrivateKeyKey(appID),
		envKey:       githubAppPrivateKeyEnvKey,
		description:  "GitHub App private key reference is not bound to this GitHub App",
	}, nil
}

// resolveGitHubAppPrivateKey returns the GitHub App PEM from
// github.private_key_path (legacy file, warned once) or
// github.private_key_ref, verifying the reference is bound to this App and
// the value parses as an RSA private key.
func resolveGitHubAppPrivateKey(creds *CredentialsFile, registry *SecretProviderRegistry) ([]byte, error) {
	kind := credentialGitHubAppPrivateKey
	if creds == nil || creds.GitHub == nil {
		return nil, &CredentialResolutionError{Kind: kind, Code: "missing", Detail: "GitHub App not configured — add 'github' section to moltnet.json"}
	}
	path := strings.TrimSpace(creds.GitHub.PrivateKeyPath)
	ref := creds.GitHub.PrivateKeyRef
	if path != "" && ref != nil {
		return nil, &CredentialResolutionError{Kind: kind, Code: "ambiguous", Detail: "config must set exactly one of github.private_key_path or github.private_key_ref"}
	}
	var pemData []byte
	switch {
	case ref != nil:
		binding, err := githubAppPrivateKeyBinding(creds.GitHub.AppID)
		if err == nil {
			err = validateSecretReferenceBoundTo(*ref, binding)
		}
		if err != nil {
			return nil, &CredentialResolutionError{Kind: kind, Code: "unbound", Detail: err.Error()}
		}
		value, err := resolveThroughRegistry(kind, registry, *ref)
		if err != nil {
			return nil, err
		}
		pemData = []byte(value)
	case path != "":
		warnLegacyCredentialFieldOnce("github.private_key_path")
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read GitHub App private key: %w", err)
		}
		pemData = data
	default:
		return nil, &CredentialResolutionError{Kind: kind, Code: "missing", Detail: "config must set exactly one of github.private_key_path or github.private_key_ref"}
	}
	if _, err := parseRSAPrivateKey(pemData); err != nil {
		return nil, &CredentialResolutionError{Kind: kind, Code: "invalid_value", Detail: "value is not an RSA private key PEM"}
	}
	return pemData, nil
}

func runGitHubSetupCmd(credPath, name, appSlug string) error {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	if creds.GitHub == nil {
		return fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}

	// Resolve app slug
	slug := appSlug
	if slug == "" {
		slug = creds.GitHub.AppSlug
	}
	if slug == "" {
		return fmt.Errorf("app slug required — use --app-slug or set github.app_slug in moltnet.json")
	}

	// Step 1: Export SSH keys if not present
	if creds.SSH == nil {
		fmt.Fprintln(os.Stderr, "Exporting SSH keys...")
		if err := runSSHKeyExportCmd(credPath, ""); err != nil {
			return fmt.Errorf("ssh-key export: %w", err)
		}
		// Re-read config to get SSH paths
		creds, err = loadCredentials(credPath)
		if err != nil {
			return err
		}
	}

	// Step 2: Look up bot user ID from GitHub API
	fmt.Fprintf(os.Stderr, "Looking up bot user ID for %s[bot]...\n", slug)
	botUserID, appName, err := lookupBotUser(slug)
	if err != nil {
		return fmt.Errorf("lookup bot user: %w", err)
	}
	fmt.Fprintf(os.Stderr, "  Bot user ID: %d\n", botUserID)

	// Step 3: Determine name and email
	gitName := name
	if gitName == "" {
		gitName = appName
	}
	gitEmail := fmt.Sprintf("%d+%s[bot]@users.noreply.github.com", botUserID, slug)

	// Step 4: Run git setup
	fmt.Fprintln(os.Stderr, "Configuring git identity...")
	if err := runGitSetupCmd(credPath, gitName, gitEmail); err != nil {
		return fmt.Errorf("git setup: %w", err)
	}

	// Re-read config to get gitconfig path
	creds, err = loadCredentials(credPath)
	if err != nil {
		return err
	}

	// Step 5: Persist app_slug if not already stored
	if creds.GitHub.AppSlug == "" {
		creds.GitHub.AppSlug = slug
		if credPath != "" {
			if _, err := WriteConfigTo(creds, credPath); err != nil {
				return fmt.Errorf("update config: %w", err)
			}
		} else {
			if _, err := WriteConfig(creds); err != nil {
				return fmt.Errorf("update config: %w", err)
			}
		}
	}

	// Step 6: Add tokenless credential helper + SSH->HTTPS rewrite to gitconfig.
	// The helper mints a fresh GitHub App token on demand (no secret on disk);
	// the insteadOf rule rewrites SSH remotes to HTTPS so the helper applies.
	// Idempotent: append only whichever pieces are not already present.
	if creds.Git != nil && creds.Git.ConfigPath != "" {
		existing, _ := os.ReadFile(creds.Git.ConfigPath)
		existingStr := string(existing)
		needHelper := !strings.Contains(existingStr, `[credential "https://github.com"]`)
		needInsteadOf := !strings.Contains(existingStr, "insteadOf = git@github.com:")
		if needHelper || needInsteadOf {
			fmt.Fprintln(os.Stderr, "Adding tokenless credential helper to gitconfig...")
			block := buildCredentialBlock(credPath)
			// buildCredentialBlock returns the [credential] section followed by
			// the [url] section. Split so we can append just the missing parts.
			parts := strings.SplitN(block, "[url ", 2)
			credSection := parts[0]
			urlSection := "[url " + parts[1]
			var toWrite string
			switch {
			case needHelper && needInsteadOf:
				toWrite = "\n" + block
			case needHelper:
				toWrite = "\n" + credSection
			default: // needInsteadOf only
				toWrite = "\n" + urlSection
			}
			f, err := os.OpenFile(creds.Git.ConfigPath, os.O_APPEND|os.O_WRONLY, 0o644)
			if err != nil {
				return fmt.Errorf("open gitconfig: %w", err)
			}
			if _, err := f.WriteString(toWrite); err != nil {
				f.Close()
				return fmt.Errorf("write credential helper: %w", err)
			}
			f.Close()
		}
	}

	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "GitHub agent setup complete!")
	fmt.Fprintf(os.Stderr, "  Name:    %s\n", gitName)
	fmt.Fprintf(os.Stderr, "  Email:   %s\n", gitEmail)
	fmt.Fprintf(os.Stderr, "  App:     %s (ID: %s)\n", slug, creds.GitHub.AppID)
	if creds.Git != nil {
		fmt.Fprintf(os.Stderr, "\nActivate with: export GIT_CONFIG_GLOBAL=%s\n", creds.Git.ConfigPath)
	}

	return nil
}

// githubAPIBaseURL can be overridden in tests.
var githubAPIBaseURL = "https://api.github.com"

// lookupBotUser queries GitHub API for the bot user associated with a GitHub App.
// Returns the bot user ID and the app display name.
func lookupBotUser(appSlug string) (int64, string, error) {
	url := fmt.Sprintf("%s/users/%s%%5Bbot%%5D", githubAPIBaseURL, appSlug)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("GitHub API request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, "", fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, "", fmt.Errorf("parse response: %w", err)
	}

	// Use slug as display name — user can override with --name
	return result.ID, appSlug, nil
}

// runGitHubCredentialHelperCmd is the flag-free business logic for github credential-helper.
func runGitHubCredentialHelperCmd(credPath string) error {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	token, err := mintGitHubAppToken(creds, credPath)
	if err != nil {
		return err
	}

	fmt.Printf("username=x-access-token\npassword=%s\n", token)
	return nil
}

// runGitHubTokenCmd is the flag-free business logic for github token.
func runGitHubTokenCmd(credPath string) error {
	path := credPath
	if path == "" {
		path = os.Getenv("MOLTNET_CREDENTIALS_PATH")
	}

	creds, err := loadCredentials(path)
	if err != nil {
		return err
	}

	token, err := mintGitHubAppToken(creds, path)
	if err != nil {
		return err
	}

	fmt.Print(token)
	return nil
}

// tokenCache is the on-disk cache format for GitHub installation tokens.
// AppID/InstallationID record which App the token was minted for; a record
// that does not match the caller (or a legacy record without them) is never
// returned, so two configs sharing a cache directory cannot exchange tokens.
type tokenCache struct {
	Token          string            `json:"token"`
	ExpiresAt      string            `json:"expires_at"`
	Permissions    map[string]string `json:"permissions"`
	AppID          string            `json:"app_id,omitempty"`
	InstallationID string            `json:"installation_id,omitempty"`
}

type tokenRefreshFailure struct {
	FailedAt string `json:"failed_at"`
}

// githubAppKeySource supplies the App PEM and the directory that holds the
// token cache. A legacy path source caches next to the PEM file; a
// credentials-backed source resolves github.private_key_ref on every load
// and caches in the credentials directory.
type githubAppKeySource struct {
	loadPEM  func() ([]byte, error)
	cacheDir string
}

func githubKeySourceFromPath(privateKeyPath string) githubAppKeySource {
	return githubAppKeySource{
		loadPEM: func() ([]byte, error) {
			pemData, err := os.ReadFile(privateKeyPath)
			if err != nil {
				return nil, fmt.Errorf("read GitHub App private key: %w", err)
			}
			return pemData, nil
		},
		cacheDir: filepath.Dir(privateKeyPath),
	}
}

// githubKeySourceFromCredentials resolves the App PEM through the credential
// resolver so both the legacy path and a private_key_ref work.
func githubKeySourceFromCredentials(creds *CredentialsFile, credPath string, registry *SecretProviderRegistry) (githubAppKeySource, error) {
	if creds == nil || creds.GitHub == nil {
		return githubAppKeySource{}, fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}
	cacheDir, err := credentialsDir(credPath)
	if err != nil {
		return githubAppKeySource{}, err
	}
	if creds.GitHub.PrivateKeyRef == nil && creds.GitHub.PrivateKeyPath != "" {
		// Keep the historical cache location for path-based agents.
		cacheDir = filepath.Dir(creds.GitHub.PrivateKeyPath)
	}
	return githubAppKeySource{
		loadPEM:  func() ([]byte, error) { return resolveGitHubAppPrivateKey(creds, registry) },
		cacheDir: cacheDir,
	}, nil
}

// credentialsDir returns the directory holding moltnet.json for credPath,
// falling back to the default config directory.
func credentialsDir(credPath string) (string, error) {
	if strings.TrimSpace(credPath) != "" {
		return filepath.Dir(credPath), nil
	}
	return GetConfigDir()
}

// tokenCachePath returns the cache file path inside cacheDir.
func tokenCachePath(cacheDir string) string {
	return filepath.Join(cacheDir, "gh-token-cache.json")
}

func tokenRefreshFailurePath(cacheDir string) string {
	return filepath.Join(cacheDir, "gh-token-cache-error.json")
}

// timeNow is a seam for tests.
var timeNow = time.Now

// getCachedInstallationToken returns a cached token if valid (>5 min remaining),
// otherwise fetches a new one from the GitHub API and writes the cache.
func getCachedInstallationToken(appID, privateKeyPath, installationID string) (string, error) {
	details, err := getCachedInstallationTokenDetails(
		context.Background(),
		http.DefaultClient,
		appID,
		privateKeyPath,
		installationID,
	)
	if err != nil {
		return "", err
	}
	return details.Token, nil
}

// getCachedInstallationTokenDetails returns a cached token and its granted
// permissions. Legacy cache entries without permissions are refreshed so
// callers never mistake an assumed manifest for the installation's actual
// approved capabilities.
func getCachedInstallationTokenDetails(
	ctx context.Context,
	client *http.Client,
	appID, privateKeyPath, installationID string,
) (tokenCache, error) {
	return getCachedInstallationTokenDetailsWithFailureTTL(
		ctx,
		client,
		appID,
		privateKeyPath,
		installationID,
		0,
	)
}

func getCachedInstallationTokenDetailsWithFailureTTL(
	ctx context.Context,
	client *http.Client,
	appID, privateKeyPath, installationID string,
	failureTTL time.Duration,
) (tokenCache, error) {
	return getCachedTokenDetailsFromSource(ctx, client, appID, githubKeySourceFromPath(privateKeyPath), installationID, failureTTL)
}

func getCachedTokenDetailsFromSource(
	ctx context.Context,
	client *http.Client,
	appID string,
	source githubAppKeySource,
	installationID string,
	failureTTL time.Duration,
) (tokenCache, error) {
	cachePath := tokenCachePath(source.cacheDir)

	// Try reading cache — only a record minted for this App/installation counts.
	if data, err := os.ReadFile(cachePath); err == nil {
		var cached tokenCache
		if err := json.Unmarshal(data, &cached); err == nil && cached.Token != "" && cached.ExpiresAt != "" &&
			cached.AppID == appID && cached.InstallationID == installationID {
			expiresAt, err := time.Parse(time.RFC3339, cached.ExpiresAt)
			if err == nil && timeNow().Add(5*time.Minute).Before(expiresAt) && cached.Permissions != nil {
				return cached, nil
			}
		}
	}

	if failureTTL > 0 {
		if data, err := os.ReadFile(tokenRefreshFailurePath(source.cacheDir)); err == nil {
			var failed tokenRefreshFailure
			if json.Unmarshal(data, &failed) == nil {
				failedAt, parseErr := time.Parse(time.RFC3339Nano, failed.FailedAt)
				if parseErr == nil && timeNow().Before(failedAt.Add(failureTTL)) {
					return tokenCache{}, fmt.Errorf("GitHub token refresh is temporarily suppressed after a recent failure")
				}
			}
		}
	}

	// Cache miss or expired — fetch fresh token
	details, err := getInstallationTokenDetailsFromSource(ctx, client, appID, source, installationID)
	if err != nil {
		if failureTTL > 0 {
			_ = writeJSONAtomic(
				tokenRefreshFailurePath(source.cacheDir),
				tokenRefreshFailure{FailedAt: timeNow().UTC().Format(time.RFC3339Nano)},
			)
		}
		return tokenCache{}, err
	}

	// Write cache (best-effort), bound to this App/installation
	details.AppID = appID
	details.InstallationID = installationID
	_ = writeJSONAtomic(cachePath, details)
	_ = os.Remove(tokenRefreshFailurePath(source.cacheDir))

	return details, nil
}

// mintGitHubAppToken returns a cached or fresh installation token for the
// credentials' GitHub App, resolving the PEM from a path or a secret reference.
func mintGitHubAppToken(creds *CredentialsFile, credPath string) (string, error) {
	source, err := githubKeySourceFromCredentials(creds, credPath, NewSecretProviderRegistry())
	if err != nil {
		return "", err
	}
	details, err := getCachedTokenDetailsFromSource(
		context.Background(),
		http.DefaultClient,
		creds.GitHub.AppID,
		source,
		creds.GitHub.InstallationID,
		0,
	)
	if err != nil {
		return "", err
	}
	return details.Token, nil
}

// getInstallationToken exchanges a GitHub App JWT for an installation token.
// Returns the token string, its expiry (RFC3339), and any error.
func getInstallationToken(appID, privateKeyPath, installationID string) (string, string, error) {
	details, err := getInstallationTokenDetails(
		context.Background(),
		http.DefaultClient,
		appID,
		privateKeyPath,
		installationID,
	)
	if err != nil {
		return "", "", err
	}
	return details.Token, details.ExpiresAt, nil
}

func getInstallationTokenDetails(
	ctx context.Context,
	client *http.Client,
	appID, privateKeyPath, installationID string,
) (tokenCache, error) {
	return getInstallationTokenDetailsFromSource(ctx, client, appID, githubKeySourceFromPath(privateKeyPath), installationID)
}

// parseRSAPrivateKey decodes a PKCS#1 or PKCS#8 RSA private key PEM. Error
// messages never include key material.
func parseRSAPrivateKey(pemData []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block from GitHub App private key")
	}
	privKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// Fall back to PKCS#8 format
		pkcs8Key, errPKCS8 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if errPKCS8 != nil {
			return nil, fmt.Errorf("parse private key: PKCS#1: %v, PKCS#8: %w", err, errPKCS8)
		}
		var ok bool
		privKey, ok = pkcs8Key.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("PKCS#8 key is not RSA")
		}
	}
	return privKey, nil
}

func getInstallationTokenDetailsFromSource(
	ctx context.Context,
	client *http.Client,
	appID string,
	source githubAppKeySource,
	installationID string,
) (tokenCache, error) {
	pemData, err := source.loadPEM()
	if err != nil {
		return tokenCache{}, err
	}
	privKey, err := parseRSAPrivateKey(pemData)
	if err != nil {
		return tokenCache{}, err
	}

	jwt, err := createAppJWT(appID, privKey)
	if err != nil {
		return tokenCache{}, err
	}

	url := fmt.Sprintf("%s/app/installations/%s/access_tokens", githubAPIBaseURL, installationID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return tokenCache{}, err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := client.Do(req)
	if err != nil {
		return tokenCache{}, fmt.Errorf("GitHub API request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return tokenCache{}, fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, string(body))
	}

	var result tokenCache
	if err := json.Unmarshal(body, &result); err != nil {
		return tokenCache{}, fmt.Errorf("parse GitHub response: %w", err)
	}

	if result.Permissions == nil {
		result.Permissions = map[string]string{}
	}
	return result, nil
}

// createAppJWT creates an RS256-signed JWT for GitHub App authentication.
func createAppJWT(appID string, privKey *rsa.PrivateKey) (string, error) {
	now := time.Now().Unix()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(
		`{"iss":"%s","iat":%d,"exp":%d}`, appID, now-60, now+600,
	)))

	signingInput := header + "." + payload
	hashed := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, hashed[:])
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}

	signature := base64.RawURLEncoding.EncodeToString(sig)
	return signingInput + "." + signature, nil
}

// runGitHubSetup is the legacy flag-parsing entry point, preserved for existing tests.
func runGitHubSetup(args []string) error {
	fs := flag.NewFlagSet("github setup", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	name := fs.String("name", "", "Git committer name")
	appSlug := fs.String("app-slug", "", "GitHub App slug")
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runGitHubSetupCmd(*credPath, *name, *appSlug)
}

// runGitHubCredentialHelper is the legacy flag-parsing entry point, preserved for existing tests.
func runGitHubCredentialHelper(args []string) error {
	fs := flag.NewFlagSet("github credential-helper", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runGitHubCredentialHelperCmd(*credPath)
}

// runGitHubToken is the legacy flag-parsing entry point, preserved for existing tests.
func runGitHubToken(args []string) error {
	fs := flag.NewFlagSet("github token", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runGitHubTokenCmd(*credPath)
}

// runGitHubExecCmd resolves credentials from the activated context, mints a
// command-scoped GitHub App installation token, and executes exactly one child
// `gh` process with GH_TOKEN set. It fails closed if token minting fails — gh
// never falls back to the human login (issue #1824).
func runGitHubExecCmd(credPath string, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	// Strip leading `--` separator if present (cobra leaves it in args).
	for len(args) > 0 && args[0] == "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		return fmt.Errorf("moltnet github exec: no command provided — usage: moltnet github exec -- gh <command>")
	}
	if filepath.Base(args[0]) != "gh" {
		return fmt.Errorf("moltnet github exec: only `gh` commands are supported — got %q", args[0])
	}

	path := credPath
	if path == "" {
		path = os.Getenv("MOLTNET_CREDENTIALS_PATH")
	}
	if path == "" {
		gitConfigPath, active, err := currentMoltnetGitConfigPath()
		if err != nil {
			return fmt.Errorf("moltnet github exec: %w", err)
		}
		if active {
			path = filepath.Join(filepath.Dir(gitConfigPath), "moltnet.json")
		}
	}

	creds, err := loadCredentials(path)
	if err != nil {
		return fmt.Errorf("moltnet github exec: cannot load credentials: %w", err)
	}
	if creds.GitHub == nil {
		return fmt.Errorf("moltnet github exec: GitHub App not configured — add 'github' section to moltnet.json")
	}

	token, err := mintGitHubAppToken(creds, path)
	if err != nil {
		return fmt.Errorf("moltnet github exec: cannot mint GitHub App token: %w", err)
	}
	if token == "" {
		return fmt.Errorf("moltnet github exec: minted token is empty — refusing to fall back to human gh login")
	}

	cmd := exec.Command(args[0], args[1:]...)
	cmd.Env = append(os.Environ(), "GH_TOKEN="+token)
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}
