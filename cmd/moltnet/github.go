package main

import (
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
	"time"
)

func runGitHubSetup(args []string) error {
	fs := flag.NewFlagSet("github setup", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	name := fs.String("name", "", "Git committer name (default: app name from GitHub)")
	appSlug := fs.String("app-slug", "", "GitHub App slug (default: from moltnet.json github.app_slug)")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet github setup [options]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "One-command setup for GitHub App git identity.")
		fmt.Fprintln(os.Stderr, "Exports SSH keys, looks up bot user ID, configures git")
		fmt.Fprintln(os.Stderr, "signing, and adds the credential helper.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Requires a 'github' section in moltnet.json with app_id,")
		fmt.Fprintln(os.Stderr, "installation_id, and private_key_path.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	creds, err := loadCredentials(*credPath)
	if err != nil {
		return err
	}

	if creds.GitHub == nil {
		return fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}

	// Resolve app slug
	slug := *appSlug
	if slug == "" {
		slug = creds.GitHub.AppSlug
	}
	if slug == "" {
		return fmt.Errorf("app slug required — use --app-slug or set github.app_slug in moltnet.json")
	}

	// Step 1: Export SSH keys if not present
	if creds.SSH == nil {
		fmt.Fprintln(os.Stderr, "Exporting SSH keys...")
		sshArgs := []string{}
		if *credPath != "" {
			sshArgs = append(sshArgs, "--credentials", *credPath)
		}
		if err := runSSHKeyExport(sshArgs); err != nil {
			return fmt.Errorf("ssh-key export: %w", err)
		}
		// Re-read config to get SSH paths
		creds, err = loadCredentials(*credPath)
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
	gitName := *name
	if gitName == "" {
		gitName = appName
	}
	gitEmail := fmt.Sprintf("%d+%s[bot]@users.noreply.github.com", botUserID, slug)

	// Step 4: Run git setup
	fmt.Fprintln(os.Stderr, "Configuring git identity...")
	gitArgs := []string{"--name", gitName, "--email", gitEmail}
	if *credPath != "" {
		gitArgs = append(gitArgs, "--credentials", *credPath)
	}
	if err := runGitSetup(gitArgs); err != nil {
		return fmt.Errorf("git setup: %w", err)
	}

	// Re-read config to get gitconfig path
	creds, err = loadCredentials(*credPath)
	if err != nil {
		return err
	}

	// Step 5: Persist app_slug if not already stored
	if creds.GitHub.AppSlug == "" {
		creds.GitHub.AppSlug = slug
		if *credPath != "" {
			if _, err := WriteConfigTo(creds, *credPath); err != nil {
				return fmt.Errorf("update config: %w", err)
			}
		} else {
			if _, err := WriteConfig(creds); err != nil {
				return fmt.Errorf("update config: %w", err)
			}
		}
	}

	// Step 6: Add credential helper to gitconfig
	if creds.Git != nil && creds.Git.ConfigPath != "" {
		fmt.Fprintln(os.Stderr, "Adding credential helper to gitconfig...")
		helperCmd := "moltnet github credential-helper"
		if *credPath != "" {
			helperCmd += " --credentials " + *credPath
		}
		credHelperLine := fmt.Sprintf("\n[credential \"https://github.com\"]\n\thelper = %s\n", helperCmd)
		f, err := os.OpenFile(creds.Git.ConfigPath, os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return fmt.Errorf("open gitconfig: %w", err)
		}
		if _, err := f.WriteString(credHelperLine); err != nil {
			f.Close()
			return fmt.Errorf("write credential helper: %w", err)
		}
		f.Close()
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

func runGitHubCredentialHelper(args []string) error {
	fs := flag.NewFlagSet("github credential-helper", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet github credential-helper [options]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Git credential helper for GitHub App authentication.")
		fmt.Fprintln(os.Stderr, "Outputs access token in git credential protocol format.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	creds, err := loadCredentials(*credPath)
	if err != nil {
		return err
	}

	if creds.GitHub == nil {
		return fmt.Errorf("GitHub App not configured — add 'github' section to moltnet.json")
	}

	token, err := getInstallationToken(
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

// getInstallationToken exchanges a GitHub App JWT for an installation token.
func getInstallationToken(appID, privateKeyPath, installationID string) (string, error) {
	pemData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return "", fmt.Errorf("read GitHub App private key: %w", err)
	}

	block, _ := pem.Decode(pemData)
	if block == nil {
		return "", fmt.Errorf("failed to decode PEM block from %s", privateKeyPath)
	}

	privKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// Fall back to PKCS#8 format
		pkcs8Key, errPKCS8 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if errPKCS8 != nil {
			return "", fmt.Errorf("parse private key: PKCS#1: %v, PKCS#8: %w", err, errPKCS8)
		}
		var ok bool
		privKey, ok = pkcs8Key.(*rsa.PrivateKey)
		if !ok {
			return "", fmt.Errorf("PKCS#8 key is not RSA")
		}
	}

	jwt, err := createAppJWT(appID, privKey)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("https://api.github.com/app/installations/%s/access_tokens", installationID)
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("GitHub API request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse GitHub response: %w", err)
	}

	return result.Token, nil
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
