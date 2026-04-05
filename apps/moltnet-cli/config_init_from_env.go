package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// runConfigInitFromEnvCmd reconstructs an agent's .moltnet/<agent>/ directory
// from environment variables. Designed for ephemeral CI/cloud environments
// (e.g. Claude Code web) where legreffier init cannot run interactively.
func runConfigInitFromEnvCmd(dir, agentName string, skipGit bool) error {
	if agentName == "" {
		return fmt.Errorf("--agent is required")
	}

	// Required env vars
	identityID := os.Getenv("MOLTNET_IDENTITY_ID")
	clientID := os.Getenv("MOLTNET_CLIENT_ID")
	clientSecret := os.Getenv("MOLTNET_CLIENT_SECRET")
	publicKey := os.Getenv("MOLTNET_PUBLIC_KEY")
	privateKey := os.Getenv("MOLTNET_PRIVATE_KEY")
	fingerprint := os.Getenv("MOLTNET_FINGERPRINT")

	var missing []string
	if identityID == "" {
		missing = append(missing, "MOLTNET_IDENTITY_ID")
	}
	if clientID == "" {
		missing = append(missing, "MOLTNET_CLIENT_ID")
	}
	if clientSecret == "" {
		missing = append(missing, "MOLTNET_CLIENT_SECRET")
	}
	if publicKey == "" {
		missing = append(missing, "MOLTNET_PUBLIC_KEY")
	}
	if privateKey == "" {
		missing = append(missing, "MOLTNET_PRIVATE_KEY")
	}
	if fingerprint == "" {
		missing = append(missing, "MOLTNET_FINGERPRINT")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	// Optional env vars with defaults
	apiURL := os.Getenv("MOLTNET_API_URL")
	if apiURL == "" {
		apiURL = defaultAPIURL
	}
	apiURL = strings.TrimRight(apiURL, "/")

	registeredAt := os.Getenv("MOLTNET_REGISTERED_AT")
	if registeredAt == "" {
		registeredAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	// Resolve agent config directory
	moltnetDir := filepath.Join(dir, ".moltnet")
	agentDir := filepath.Join(moltnetDir, agentName)
	configPath := filepath.Join(agentDir, "moltnet.json")

	// Skip if already initialized
	if _, err := os.Stat(configPath); err == nil {
		fmt.Fprintf(os.Stderr, "Agent %q already initialized at %s, skipping\n", agentName, configPath)
		return nil
	}

	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		return fmt.Errorf("create agent dir: %w", err)
	}

	// Build config
	config := &CredentialsFile{
		IdentityID: identityID,
		OAuth2: CredentialsOAuth2{
			ClientID:     clientID,
			ClientSecret: clientSecret,
		},
		Keys: CredentialsKeys{
			PublicKey:   publicKey,
			PrivateKey:  privateKey,
			Fingerprint: fingerprint,
		},
		Endpoints: CredentialsEndpoints{
			API: apiURL,
			MCP: deriveMCPURL(apiURL),
		},
		RegisteredAt: registeredAt,
	}

	// Optional GitHub App section
	ghAppID := os.Getenv("MOLTNET_GITHUB_APP_ID")
	ghInstallID := os.Getenv("MOLTNET_GITHUB_APP_INSTALLATION_ID")
	ghAppPEM := os.Getenv("MOLTNET_GITHUB_APP_PRIVATE_KEY")
	ghAppSlug := os.Getenv("MOLTNET_GITHUB_APP_SLUG")
	if ghAppID != "" && ghInstallID != "" && ghAppPEM != "" {
		pemPath := filepath.Join(agentDir, ghAppSlug+".pem")
		if ghAppSlug == "" {
			pemPath = filepath.Join(agentDir, "github-app.pem")
		}
		if err := os.WriteFile(pemPath, []byte(ghAppPEM), 0o600); err != nil {
			return fmt.Errorf("write GitHub App PEM: %w", err)
		}
		config.GitHub = &GitHubSection{
			AppID:          ghAppID,
			AppSlug:        ghAppSlug,
			InstallationID: ghInstallID,
			PrivateKeyPath: pemPath,
		}
		fmt.Fprintf(os.Stderr, "GitHub App PEM written to %s\n", pemPath)
	}

	// Write moltnet.json
	if _, err := WriteConfigTo(config, configPath); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Config written to %s\n", configPath)

	// Export SSH keys (reuses existing logic)
	if err := runSSHKeyExportCmd(configPath, ""); err != nil {
		return fmt.Errorf("export SSH keys: %w", err)
	}

	// Set up git signing (reuses existing logic)
	if !skipGit {
		if err := runGitSetupCmd(configPath, agentName, ""); err != nil {
			return fmt.Errorf("git setup: %w", err)
		}
	}

	// Write env file
	if err := writeAgentEnvFile(agentDir, agentName, config); err != nil {
		return fmt.Errorf("write env file: %w", err)
	}

	// Set as default agent
	defaultPath := filepath.Join(moltnetDir, "default-agent")
	if err := os.WriteFile(defaultPath, []byte(agentName+"\n"), 0o644); err != nil {
		return fmt.Errorf("write default-agent: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Agent %q initialized from environment variables\n", agentName)
	return nil
}

// writeAgentEnvFile writes a shell-sourceable env file for the agent.
func writeAgentEnvFile(agentDir, agentName string, config *CredentialsFile) error {
	prefix := toEnvPrefix(agentName)
	moltnetRelDir := filepath.Join(".moltnet", agentName)

	var lines []string
	lines = append(lines, "# Managed by moltnet config init-from-env — do not edit above the user section")
	lines = append(lines, fmt.Sprintf("%s_CLIENT_ID='%s'", prefix, config.OAuth2.ClientID))
	lines = append(lines, fmt.Sprintf("%s_CLIENT_SECRET='%s'", prefix, config.OAuth2.ClientSecret))

	if config.GitHub != nil {
		lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_ID='%s'", prefix, config.GitHub.AppSlug))
		lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_PRIVATE_KEY_PATH='%s'", prefix, config.GitHub.PrivateKeyPath))
		lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_INSTALLATION_ID='%s'", prefix, config.GitHub.InstallationID))
	}

	if config.Git != nil {
		lines = append(lines, fmt.Sprintf("GIT_CONFIG_GLOBAL='%s'", moltnetRelDir+"/gitconfig"))
	}

	lines = append(lines, "")
	lines = append(lines, "# User section — add custom variables below")
	lines = append(lines, "")

	content := strings.Join(lines, "\n")
	envPath := filepath.Join(agentDir, "env")
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write env file: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Env file written to %s\n", envPath)
	return nil
}
