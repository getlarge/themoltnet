package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// CredentialsFile matches the JS SDK format.
type CredentialsFile struct {
	IdentityID string              `json:"identity_id"`
	OAuth2     CredentialsOAuth2   `json:"oauth2"`
	Keys       CredentialsKeys     `json:"keys"`
	Endpoints  CredentialsEndpoints `json:"endpoints"`
	RegisteredAt string            `json:"registered_at"`
}

type CredentialsOAuth2 struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

type CredentialsKeys struct {
	PublicKey   string `json:"public_key"`
	PrivateKey  string `json:"private_key"`
	Fingerprint string `json:"fingerprint"`
}

type CredentialsEndpoints struct {
	API string `json:"api"`
	MCP string `json:"mcp"`
}

// GetConfigDir returns ~/.config/moltnet.
func GetConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, ".config", "moltnet"), nil
}

// GetCredentialsPath returns ~/.config/moltnet/credentials.json.
func GetCredentialsPath() (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "credentials.json"), nil
}

// WriteCredentials writes registration result to credentials.json.
func WriteCredentials(result *RegisterResult) (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}

	creds := CredentialsFile{
		IdentityID: result.Response.IdentityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     result.Response.ClientID,
			ClientSecret: result.Response.ClientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:   result.KeyPair.PublicKey,
			PrivateKey:  result.KeyPair.PrivateKey,
			Fingerprint: result.KeyPair.Fingerprint,
		},
		Endpoints: CredentialsEndpoints{
			API: result.APIUrl,
			MCP: result.APIUrl + "/mcp",
		},
		RegisteredAt: time.Now().UTC().Format(time.RFC3339Nano),
	}

	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal credentials: %w", err)
	}
	data = append(data, '\n')

	path, err := GetCredentialsPath()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write credentials: %w", err)
	}

	return path, nil
}

// ReadCredentials reads and parses credentials.json. Returns nil if not found.
func ReadCredentials() (*CredentialsFile, error) {
	path, err := GetCredentialsPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	var creds CredentialsFile
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}
	return &creds, nil
}
