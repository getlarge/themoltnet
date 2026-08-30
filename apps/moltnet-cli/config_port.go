package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type configPortOpts struct {
	from           string
	dir            string
	name           string
	installationID string
	out            io.Writer
}

func runConfigPortCmd(opts configPortOpts) error {
	if strings.TrimSpace(opts.from) == "" {
		return fmt.Errorf("--from is required")
	}
	sourceDir, err := filepath.Abs(opts.from)
	if err != nil {
		return fmt.Errorf("resolve source directory: %w", err)
	}
	targetRoot, err := filepath.Abs(opts.dir)
	if err != nil {
		return fmt.Errorf("resolve target repository: %w", err)
	}
	agentName := strings.TrimSpace(opts.name)
	if agentName == "" {
		agentName = filepath.Base(sourceDir)
	}
	targetDir := filepath.Join(targetRoot, ".moltnet", agentName)
	if canonicalizeRoot(sourceDir) == canonicalizeRoot(targetDir) {
		return fmt.Errorf("source and target agent directories are the same")
	}
	targetConfigPath := filepath.Join(targetDir, "moltnet.json")
	if regularFileExists(targetConfigPath) {
		return fmt.Errorf("target agent already exists at %s", targetConfigPath)
	}

	sourceConfigPath := filepath.Join(sourceDir, "moltnet.json")
	creds, err := ReadConfigFrom(sourceConfigPath)
	if err != nil {
		return err
	}
	if creds == nil {
		return fmt.Errorf("source credentials not found at %s", sourceConfigPath)
	}
	if err := validatePortableAgentConfig(creds); err != nil {
		return err
	}
	registry := NewSecretProviderRegistry()
	if _, err := resolveOAuth2Secret(creds, registry); err != nil {
		return fmt.Errorf("resolve source OAuth2 secret: %w", err)
	}
	if _, err := resolveIdentitySeed(creds, registry); err != nil {
		return fmt.Errorf("resolve source identity seed: %w", err)
	}
	pemData, err := resolvePortableGitHubPEM(creds, sourceDir, registry)
	if err != nil {
		return fmt.Errorf("resolve source GitHub App private key: %w", err)
	}

	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return fmt.Errorf("create target agent directory: %w", err)
	}
	ported := *creds
	github := *creds.GitHub
	ported.GitHub = &github
	if opts.installationID != "" {
		ported.GitHub.InstallationID = opts.installationID
	}
	if ported.GitHub.PrivateKeyRef == nil {
		pemPath := filepath.Join(targetDir, ported.GitHub.AppSlug+".pem")
		if err := writeFileAtomic(pemPath, pemData); err != nil {
			return fmt.Errorf("write GitHub App private key: %w", err)
		}
		ported.GitHub.PrivateKeyPath = pemPath
	}
	ported.SSH = nil
	ported.Git = nil
	if _, err := WriteConfigTo(&ported, targetConfigPath); err != nil {
		return err
	}
	if err := runSSHKeyExportCmd(targetConfigPath, filepath.Join(targetDir, "ssh")); err != nil {
		return err
	}
	gitName := agentName
	gitEmail := ported.IdentityID + "@agents.themolt.net"
	if creds.Git != nil {
		if creds.Git.Name != "" {
			gitName = creds.Git.Name
		}
		if creds.Git.Email != "" {
			gitEmail = creds.Git.Email
		}
	}
	if err := runGitSetupCmd(targetConfigPath, gitName, gitEmail); err != nil {
		return err
	}
	if err := ensureGitHubCredentialBlock(targetConfigPath); err != nil {
		return err
	}
	if err := copyPortableAgentEnv(sourceDir, targetDir, agentName, &ported); err != nil {
		return err
	}
	if err := runAgentsActivationRefreshCmd(io.Discard, targetRoot, agentName, false); err != nil {
		return fmt.Errorf("refresh activation cache: %w", err)
	}

	if opts.out == nil {
		opts.out = os.Stdout
	}
	fmt.Fprintf(opts.out, "Ported %s to %s\n", agentName, targetDir)
	fmt.Fprintln(opts.out, "Agent-host plugins are managed separately by Claude Code or Codex.")
	return nil
}

func validatePortableAgentConfig(creds *CredentialsFile) error {
	if creds.IdentityID == "" || creds.Keys.PublicKey == "" || creds.Keys.Fingerprint == "" {
		return fmt.Errorf("source config is missing identity fields")
	}
	if creds.OAuth2.ClientID == "" {
		return fmt.Errorf("source config is missing oauth2.client_id")
	}
	if creds.GitHub == nil || creds.GitHub.AppID == "" || creds.GitHub.AppSlug == "" {
		return fmt.Errorf("source config is missing GitHub App identity fields")
	}
	if creds.GitHub.InstallationID == "" {
		return fmt.Errorf("source config is missing github.installation_id; pass --installation-id after installing the App on the target owner")
	}
	return nil
}

func resolvePortableGitHubPEM(creds *CredentialsFile, sourceDir string, registry *SecretProviderRegistry) ([]byte, error) {
	if creds.GitHub != nil && creds.GitHub.PrivateKeyRef == nil && creds.GitHub.PrivateKeyPath != "" && !filepath.IsAbs(creds.GitHub.PrivateKeyPath) {
		clone := *creds
		github := *creds.GitHub
		github.PrivateKeyPath = filepath.Join(sourceDir, github.PrivateKeyPath)
		clone.GitHub = &github
		return resolveGitHubAppPrivateKey(&clone, registry)
	}
	return resolveGitHubAppPrivateKey(creds, registry)
}

func ensureGitHubCredentialBlock(configPath string) error {
	creds, err := ReadConfigFrom(configPath)
	if err != nil {
		return err
	}
	if creds == nil || creds.Git == nil || creds.Git.ConfigPath == "" {
		return fmt.Errorf("ported Git configuration is incomplete")
	}
	f, err := os.OpenFile(creds.Git.ConfigPath, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open ported gitconfig: %w", err)
	}
	defer f.Close()
	if _, err := f.WriteString("\n" + buildCredentialBlock(configPath)); err != nil {
		return fmt.Errorf("write GitHub credential helper: %w", err)
	}
	return nil
}

func copyPortableAgentEnv(sourceDir, targetDir, agentName string, creds *CredentialsFile) error {
	if err := writeAgentEnv(targetDir, agentName, creds.OAuth2.ClientID, creds.GitHub.AppID, creds.GitHub.InstallationID, creds.Keys.Fingerprint); err != nil {
		return err
	}
	sourceVars, err := parseEnvFile(filepath.Join(sourceDir, "env"))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read source env: %w", err)
	}
	if len(sourceVars) == 0 {
		return nil
	}
	preservedKeys := []string{"MOLTNET_DIARY_ID", "MOLTNET_TEAM_ID", "MOLTNET_COMMIT_AUTHORSHIP", "MOLTNET_HUMAN_GIT_IDENTITY"}
	f, err := os.OpenFile(filepath.Join(targetDir, "env"), os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open target env: %w", err)
	}
	defer f.Close()
	for _, key := range preservedKeys {
		if value := sourceVars[key]; value != "" {
			if _, err := fmt.Fprintf(f, "%s='%s'\n", key, strings.ReplaceAll(value, "'", "'\\''")); err != nil {
				return fmt.Errorf("preserve %s: %w", key, err)
			}
		}
	}
	return nil
}
