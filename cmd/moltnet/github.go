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
		return "", fmt.Errorf("parse RSA private key: %w", err)
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
