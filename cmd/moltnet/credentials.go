package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// CredentialsFile matches the JS SDK MoltNetConfig format.
type CredentialsFile struct {
	IdentityID   string               `json:"identity_id"`
	OAuth2       CredentialsOAuth2    `json:"oauth2"`
	Keys         CredentialsKeys      `json:"keys"`
	Endpoints    CredentialsEndpoints `json:"endpoints"`
	RegisteredAt string               `json:"registered_at"`
	SSH          *SSHSection          `json:"ssh,omitempty"`
	Git          *GitSection          `json:"git,omitempty"`
	GitHub       *GitHubSection       `json:"github,omitempty"`
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

type SSHSection struct {
	PrivateKeyPath string `json:"private_key_path"`
	PublicKeyPath  string `json:"public_key_path"`
}

type GitSection struct {
	Name       string `json:"name"`
	Email      string `json:"email"`
	Signing    bool   `json:"signing"`
	ConfigPath string `json:"config_path"`
}

type GitHubSection struct {
	AppID          string `json:"app_id"`
	AppSlug        string `json:"app_slug,omitempty"`
	InstallationID string `json:"installation_id"`
	PrivateKeyPath string `json:"private_key_path"`
}

// GetConfigDir returns ~/.config/moltnet.
func GetConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, ".config", "moltnet"), nil
}

// GetConfigPath returns ~/.config/moltnet/moltnet.json.
func GetConfigPath() (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "moltnet.json"), nil
}

// ReadConfig tries moltnet.json first, falls back to credentials.json with
// a deprecation warning on stderr. Returns nil if neither exists.
func ReadConfig() (*CredentialsFile, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return nil, err
	}

	// Try moltnet.json first
	moltnetPath := filepath.Join(dir, "moltnet.json")
	creds, err := ReadConfigFrom(moltnetPath)
	if err != nil {
		return nil, err
	}
	if creds != nil {
		return creds, nil
	}

	// Fall back to credentials.json
	legacyPath := filepath.Join(dir, "credentials.json")
	creds, err = ReadConfigFrom(legacyPath)
	if err != nil {
		return nil, err
	}
	if creds != nil {
		fmt.Fprintf(os.Stderr, "Warning: credentials.json is deprecated. New writes use moltnet.json. Support will be removed in 3 minor versions.\n")
		return creds, nil
	}

	return nil, nil
}

// ReadConfigFrom reads and parses a config file at the given path.
func ReadConfigFrom(path string) (*CredentialsFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}
	var creds CredentialsFile
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &creds, nil
}

// WriteConfig writes config to ~/.config/moltnet/moltnet.json with mode 0o600.
func WriteConfig(config *CredentialsFile) (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return WriteConfigTo(config, filepath.Join(dir, "moltnet.json"))
}

// WriteConfigTo writes config to the specified path with mode 0o600.
func WriteConfigTo(config *CredentialsFile, path string) (string, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal config: %w", err)
	}
	data = append(data, '\n')

	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	return path, nil
}
