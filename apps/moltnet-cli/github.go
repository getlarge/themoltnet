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
	"path/filepath"
	"strings"
	"time"
)

// runGitHubSetupCmd is the flag-free business logic for github setup.
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

	if creds.GitHub == nil {
		return fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}

	token, err := getCachedInstallationToken(
		creds.GitHub.AppID,
		creds.GitHub.PrivateKeyPath,
		creds.GitHub.InstallationID,
	)
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

	if creds.GitHub == nil {
		return fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}

	token, err := getCachedInstallationToken(
		creds.GitHub.AppID,
		creds.GitHub.PrivateKeyPath,
		creds.GitHub.InstallationID,
	)
	if err != nil {
		return err
	}

	fmt.Print(token)
	return nil
}

// tokenCache is the on-disk cache format for GitHub installation tokens.
type tokenCache struct {
	Token       string            `json:"token"`
	ExpiresAt   string            `json:"expires_at"`
	Permissions map[string]string `json:"permissions"`
}

type tokenRefreshFailure struct {
	FailedAt string `json:"failed_at"`
}

// tokenCachePath returns the cache file path next to the private key.
func tokenCachePath(privateKeyPath string) string {
	return filepath.Join(filepath.Dir(privateKeyPath), "gh-token-cache.json")
}

func tokenRefreshFailurePath(privateKeyPath string) string {
	return filepath.Join(filepath.Dir(privateKeyPath), "gh-token-cache-error.json")
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
	cachePath := tokenCachePath(privateKeyPath)

	// Try reading cache
	if data, err := os.ReadFile(cachePath); err == nil {
		var cached tokenCache
		if err := json.Unmarshal(data, &cached); err == nil && cached.Token != "" && cached.ExpiresAt != "" {
			expiresAt, err := time.Parse(time.RFC3339, cached.ExpiresAt)
			if err == nil && timeNow().Add(5*time.Minute).Before(expiresAt) && cached.Permissions != nil {
				return cached, nil
			}
		}
	}

	if failureTTL > 0 {
		if data, err := os.ReadFile(tokenRefreshFailurePath(privateKeyPath)); err == nil {
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
	details, err := getInstallationTokenDetails(ctx, client, appID, privateKeyPath, installationID)
	if err != nil {
		if failureTTL > 0 {
			_ = writeJSONAtomic(
				tokenRefreshFailurePath(privateKeyPath),
				tokenRefreshFailure{FailedAt: timeNow().UTC().Format(time.RFC3339Nano)},
			)
		}
		return tokenCache{}, err
	}

	// Write cache (best-effort)
	_ = writeJSONAtomic(cachePath, details)
	_ = os.Remove(tokenRefreshFailurePath(privateKeyPath))

	return details, nil
}

func writeJSONAtomic(path string, value any) error {
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, ".gh-token-cache-*")
	if err != nil {
		return err
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)

	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	if err := json.NewEncoder(file).Encode(value); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
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
	pemData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return tokenCache{}, fmt.Errorf("read GitHub App private key: %w", err)
	}

	block, _ := pem.Decode(pemData)
	if block == nil {
		return tokenCache{}, fmt.Errorf("failed to decode PEM block from %s", privateKeyPath)
	}

	privKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// Fall back to PKCS#8 format
		pkcs8Key, errPKCS8 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if errPKCS8 != nil {
			return tokenCache{}, fmt.Errorf("parse private key: PKCS#1: %v, PKCS#8: %w", err, errPKCS8)
		}
		var ok bool
		privKey, ok = pkcs8Key.(*rsa.PrivateKey)
		if !ok {
			return tokenCache{}, fmt.Errorf("PKCS#8 key is not RSA")
		}
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
