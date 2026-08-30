package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const configPortStateFile = "port-state.json"

var githubAppSlugPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,99}$`)

type configPortOpts struct {
	from           string
	dir            string
	name           string
	installationID string
	out            io.Writer
}

type configPortState struct {
	SourceDir      string `json:"sourceDir"`
	InstallationID string `json:"installationId"`
}

type configPortOperations struct {
	preflight        func(*CredentialsFile, string) error
	exportSSH        func(string, string) error
	setupGit         func(string, string, string) error
	ensureCredential func(string) error
	writeEnv         func(string, string, string, *CredentialsFile) error
	refresh          func(string, string) error
}

var defaultConfigPortOperations = configPortOperations{
	preflight: preflightPortableAgentConfig,
	exportSSH: runSSHKeyExportCmd,
	setupGit:  runGitSetupCmd,
	ensureCredential: func(configPath string) error {
		creds, err := ReadConfigFrom(configPath)
		if err != nil {
			return err
		}
		if creds == nil || creds.Git == nil || creds.Git.ConfigPath == "" {
			return fmt.Errorf("ported Git configuration is incomplete")
		}
		return ensureGitHubCredentialConfig(creds.Git.ConfigPath, configPath)
	},
	writeEnv: copyPortableAgentEnv,
	refresh: func(targetRoot, agentName string) error {
		return runAgentsActivationRefreshCmd(io.Discard, targetRoot, agentName, false)
	},
}

func runConfigPortCmd(opts configPortOpts) error {
	return runConfigPortCmdWithOperations(opts, defaultConfigPortOperations)
}

func runConfigPortCmdWithOperations(opts configPortOpts, operations configPortOperations) error {
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
	if err := validateAgentName(agentName); err != nil {
		return err
	}

	sourceConfigPath := filepath.Join(sourceDir, "moltnet.json")
	creds, err := ReadConfigFrom(sourceConfigPath)
	if err != nil {
		return err
	}
	if creds == nil {
		return fmt.Errorf("source credentials not found at %s", sourceConfigPath)
	}
	ported, err := preparePortableAgentConfig(creds, opts.installationID)
	if err != nil {
		return err
	}
	if err := operations.preflight(ported, sourceDir); err != nil {
		return err
	}

	targetDir, err := prepareAgentDirectory(targetRoot, agentName)
	if err != nil {
		return err
	}
	if canonicalizeRoot(sourceDir) == canonicalizeRoot(targetDir) {
		return fmt.Errorf("source and target agent directories are the same")
	}
	targetConfigPath := filepath.Join(targetDir, "moltnet.json")
	statePath := filepath.Join(targetDir, configPortStateFile)
	state, err := readConfigPortState(statePath)
	if err != nil {
		return err
	}
	if state == nil && regularFileExists(targetConfigPath) {
		return fmt.Errorf("target agent already exists at %s", targetConfigPath)
	}
	effectiveInstallationID := ported.GitHub.InstallationID
	if state != nil {
		if state.SourceDir != canonicalizeRoot(sourceDir) || state.InstallationID != effectiveInstallationID {
			return fmt.Errorf("an incomplete port already exists with different source or installation settings")
		}
	} else {
		state = &configPortState{
			SourceDir:      canonicalizeRoot(sourceDir),
			InstallationID: effectiveInstallationID,
		}
		if err := writeJSONAtomic(statePath, state); err != nil {
			return fmt.Errorf("write port recovery state: %w", err)
		}
	}

	recover := func(step string, stepErr error) error {
		return configPortRecoveryError(step, stepErr, sourceDir, targetRoot, agentName, opts.installationID)
	}
	if _, err := WriteConfigTo(ported, targetConfigPath); err != nil {
		return recover("write target credentials", err)
	}
	if err := operations.exportSSH(targetConfigPath, filepath.Join(targetDir, "ssh")); err != nil {
		return recover("export SSH keys", err)
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
	if err := operations.setupGit(targetConfigPath, gitName, gitEmail); err != nil {
		return recover("configure Git", err)
	}
	if err := operations.ensureCredential(targetConfigPath); err != nil {
		return recover("configure GitHub credential helper", err)
	}
	effectiveCreds, err := ReadConfigFrom(targetConfigPath)
	if err != nil {
		return recover("reload target credentials", err)
	}
	if effectiveCreds == nil {
		return recover("reload target credentials", fmt.Errorf("target credentials disappeared"))
	}
	if err := operations.writeEnv(sourceDir, targetDir, agentName, effectiveCreds); err != nil {
		return recover("write agent environment", err)
	}
	if err := operations.refresh(targetRoot, agentName); err != nil {
		return recover("refresh activation cache", err)
	}
	if err := os.Remove(statePath); err != nil && !os.IsNotExist(err) {
		return recover("remove port recovery state", err)
	}

	if opts.out == nil {
		opts.out = os.Stdout
	}
	fmt.Fprintf(opts.out, "Ported %s to %s\n", agentName, targetDir)
	fmt.Fprintln(opts.out, "Agent-host plugins are managed separately by Claude Code or Codex.")
	return nil
}

func preparePortableAgentConfig(creds *CredentialsFile, installationOverride string) (*CredentialsFile, error) {
	ported := *creds
	if creds.GitHub != nil {
		github := *creds.GitHub
		ported.GitHub = &github
	}
	if ported.GitHub != nil && strings.TrimSpace(installationOverride) != "" {
		ported.GitHub.InstallationID = strings.TrimSpace(installationOverride)
	}
	ported.SSH = nil
	ported.Git = nil
	if err := validatePortableAgentConfig(&ported); err != nil {
		return nil, err
	}
	return &ported, nil
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
	if !githubAppSlugPattern.MatchString(creds.GitHub.AppSlug) {
		return fmt.Errorf("source github.app_slug must be a safe GitHub App basename")
	}
	if strings.TrimSpace(creds.GitHub.InstallationID) == "" {
		return fmt.Errorf("effective config is missing github.installation_id; pass --installation-id after installing the App on the target owner")
	}
	for label, value := range map[string]string{
		"identity_id":            creds.IdentityID,
		"oauth2.client_id":       creds.OAuth2.ClientID,
		"keys.public_key":        creds.Keys.PublicKey,
		"keys.fingerprint":       creds.Keys.Fingerprint,
		"github.app_id":          creds.GitHub.AppID,
		"github.app_slug":        creds.GitHub.AppSlug,
		"github.installation_id": creds.GitHub.InstallationID,
	} {
		if err := rejectControlCharacters(label, value); err != nil {
			return err
		}
	}
	if creds.Git != nil {
		if err := validateGitIdentityValue("git.name", creds.Git.Name); err != nil {
			return err
		}
		if err := validateGitIdentityValue("git.email", creds.Git.Email); err != nil {
			return err
		}
	}
	if creds.OAuth2.ClientSecret != "" || creds.OAuth2.ClientSecretRef == nil ||
		creds.Keys.PrivateKey != "" || creds.Keys.PrivateKeyRef == nil ||
		creds.GitHub.PrivateKeyPath != "" || creds.GitHub.PrivateKeyRef == nil {
		return fmt.Errorf("source credentials must use provider-backed references; run 'moltnet config migrate --credentials <source>/moltnet.json' before porting")
	}
	return nil
}

func preflightPortableAgentConfig(creds *CredentialsFile, _ string) error {
	registry := NewSecretProviderRegistry()
	if _, err := resolveOAuth2Secret(creds, registry); err != nil {
		return fmt.Errorf("resolve source OAuth2 secret: %w", err)
	}
	if _, err := resolveIdentitySeed(creds, registry); err != nil {
		return fmt.Errorf("resolve source identity seed: %w", err)
	}
	if _, err := resolveGitHubAppPrivateKey(creds, registry); err != nil {
		return fmt.Errorf("resolve source GitHub App private key: %w", err)
	}
	return nil
}

func readConfigPortState(path string) (*configPortState, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read port recovery state: %w", err)
	}
	if len(data) > 16*1024 {
		return nil, fmt.Errorf("port recovery state is too large")
	}
	var state configPortState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("parse port recovery state: %w", err)
	}
	if state.SourceDir == "" || state.InstallationID == "" {
		return nil, fmt.Errorf("port recovery state is incomplete")
	}
	return &state, nil
}

func configPortRecoveryError(step string, err error, sourceDir, targetRoot, agentName, installationOverride string) error {
	command := fmt.Sprintf(
		"moltnet config port --from '%s' --dir '%s' --name '%s'",
		shellQuote(sourceDir), shellQuote(targetRoot), shellQuote(agentName),
	)
	if strings.TrimSpace(installationOverride) != "" {
		command += fmt.Sprintf(" --installation-id '%s'", shellQuote(strings.TrimSpace(installationOverride)))
	}
	return fmt.Errorf("port incomplete during %s: %w; retry with: %s", step, err, command)
}

func copyPortableAgentEnv(sourceDir, targetDir, agentName string, creds *CredentialsFile) error {
	sourceVars, err := parseEnvFile(filepath.Join(sourceDir, "env"))
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read source env: %w", err)
	}
	preserved := make(map[string]string)
	for _, key := range []string{"MOLTNET_DIARY_ID", "MOLTNET_TEAM_ID", "MOLTNET_COMMIT_AUTHORSHIP", "MOLTNET_HUMAN_GIT_IDENTITY"} {
		if value := sourceVars[key]; value != "" {
			if err := rejectControlCharacters(key, value); err != nil {
				return err
			}
			preserved[key] = value
		}
	}
	return writeAgentEnvFileWithUserVars(targetDir, agentName, creds, preserved)
}
