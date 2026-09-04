package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/configmigrate"
	"github.com/joho/godotenv"
)

// getenv returns the value for key, consulting fileVars according to override.
// When override is true, fileVars take precedence over the process environment.
// When override is false, process environment wins (file fills gaps).
func getenv(key string, fileVars map[string]string, override bool) string {
	if override {
		if v, ok := fileVars[key]; ok {
			return v
		}
		return os.Getenv(key)
	}
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fileVars[key]
}

func normalizePEMEnvValue(raw string) string {
	value := strings.TrimSpace(raw)
	// Best effort: accept a full Go-style quoted string when present, but
	// fall back to a simple outer-quote strip so dotenv-style PEM payloads
	// normalize even when they are not valid Go string literals.
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	} else if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\\r\\n", "\n")
	value = strings.ReplaceAll(value, "\\n", "\n")
	value = strings.ReplaceAll(value, "\\r", "\n")
	if strings.Contains(value, "\n") && !strings.HasSuffix(value, "\n") {
		value += "\n"
	}
	return value
}

// runConfigInitFromEnvCmd reconstructs an identity's central local directory
// from environment variables. Designed for ephemeral CI/cloud environments
// (e.g. Claude Code web) where moltnet agents init cannot run interactively.
func runConfigInitFromEnvCmd(dir, agentName string, skipGit bool, envFile string, override bool) error {
	return runConfigInitFromEnvCmdWithRegistry(
		dir,
		agentName,
		skipGit,
		envFile,
		override,
		NewSecretProviderRegistry(),
	)
}

func runConfigInitFromEnvCmdWithRegistry(
	dir, agentName string,
	skipGit bool,
	envFile string,
	override bool,
	secretProviders *SecretProviderRegistry,
) error {
	// Read env file without mutating the process environment.
	var fileVars map[string]string
	if envFile != "" {
		var err error
		fileVars, err = godotenv.Read(envFile)
		if err != nil {
			return fmt.Errorf("read env file %q: %w", envFile, err)
		}
		fmt.Fprintf(os.Stderr, "Loaded env file %s (override=%v)\n", envFile, override)
	}

	// Resolve identity alias: --name flag > MOLTNET_ACTIVE_IDENTITY env var.
	if agentName == "" {
		agentName = getenv("MOLTNET_ACTIVE_IDENTITY", fileVars, override)
	}
	if agentName == "" {
		return fmt.Errorf("--name is required (or set MOLTNET_ACTIVE_IDENTITY)")
	}

	// The environment reconstructs a central identity, never a repository tree.
	// Keep dir in the function signature temporarily for Go callers, but it is
	// deliberately ignored and has no effect on credentials discovery.
	_ = dir
	agentDir, err := identityDir(agentName)
	if err != nil {
		return err
	}
	configPath := filepath.Join(agentDir, "moltnet.json")

	// Skip if already initialized (no env vars needed).
	if _, err := os.Stat(configPath); err == nil {
		fmt.Fprintf(os.Stderr, "Agent %q already initialized at %s, skipping\n", agentName, configPath)
		return nil
	}

	// Required env vars
	identityID := getenv("MOLTNET_IDENTITY_ID", fileVars, override)
	clientID := getenv("MOLTNET_CLIENT_ID", fileVars, override)
	clientSecret := getenv("MOLTNET_CLIENT_SECRET", fileVars, override)
	publicKey := getenv("MOLTNET_PUBLIC_KEY", fileVars, override)
	privateKey := getenv("MOLTNET_PRIVATE_KEY", fileVars, override)
	fingerprint := getenv("MOLTNET_FINGERPRINT", fileVars, override)

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
	apiURL := getenv("MOLTNET_API_URL", fileVars, override)
	if apiURL == "" {
		apiURL = defaultAPIURL
	}
	apiURL = strings.TrimRight(apiURL, "/")

	registeredAt := getenv("MOLTNET_REGISTERED_AT", fileVars, override)
	if registeredAt == "" {
		registeredAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		return fmt.Errorf("create agent dir: %w", err)
	}

	secretReference := &SecretReference{
		Provider: environmentProviderName,
		Key:      environmentSecretKey,
	}
	if valueComesFromFile(environmentSecretKey, fileVars, override) {
		secretReference = &SecretReference{
			Provider: osKeyringProviderName,
			Key:      OAuth2SecretKey(identityID, clientID),
		}
		if err := secretProviders.Store(*secretReference, clientSecret); err != nil {
			return fmt.Errorf("persist env-file OAuth2 client secret: %w", err)
		}
	}

	// Build config
	config := &CredentialsFile{
		IdentityID: identityID,
		OAuth2: CredentialsOAuth2{
			ClientID:        clientID,
			ClientSecretRef: secretReference,
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
	ghAppID := getenv("MOLTNET_GITHUB_APP_ID", fileVars, override)
	ghInstallID := getenv("MOLTNET_GITHUB_APP_INSTALLATION_ID", fileVars, override)
	ghAppPEM := normalizePEMEnvValue(
		getenv("MOLTNET_GITHUB_APP_PRIVATE_KEY", fileVars, override),
	)
	ghAppSlug := getenv("MOLTNET_GITHUB_APP_SLUG", fileVars, override)
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
		gitName := getenv("MOLTNET_GIT_NAME", fileVars, override)
		gitEmail := getenv("MOLTNET_GIT_EMAIL", fileVars, override)
		if gitName == "" {
			gitName = agentName
		}
		if err := runGitSetupCmd(configPath, gitName, gitEmail); err != nil {
			return fmt.Errorf("git setup: %w", err)
		}
	}

	// Write env file
	if err := writeAgentEnvFile(agentDir, agentName, config); err != nil {
		return fmt.Errorf("write env file: %w", err)
	}

	// A newly created identity becomes the default only when no default exists.
	selector, err := readIdentitySelector()
	if err != nil {
		return err
	}
	if selector == nil || selector.DefaultIdentity == "" {
		if err := writeIdentitySelector(agentName); err != nil {
			return err
		}
	}

	fmt.Fprintf(os.Stderr, "Agent %q initialized from environment variables\n", agentName)
	return nil
}

func valueComesFromFile(key string, fileVars map[string]string, override bool) bool {
	if _, ok := fileVars[key]; !ok {
		return false
	}
	return override || os.Getenv(key) == ""
}

// shellQuote escapes a value for single-quoted shell strings by replacing
// each single quote with the escape sequence: quote-backslash-quote-quote.
func shellQuote(v string) string {
	return strings.ReplaceAll(v, "'", `'\''`)
}

// writeAgentEnvFile writes a shell-sourceable env file for the agent.
// If the file already exists, user-section content (lines after the
// "# User section" marker, plus any non-managed keys) is preserved.
func writeAgentEnvFile(agentDir, agentName string, config *CredentialsFile) error {
	return writeAgentEnvFileWithUserVars(agentDir, agentName, config, nil)
}

// writeAgentEnvFileWithUserVars uses the canonical managed env serializer and
// merges the selected non-secret variables into its preserved user section.
func writeAgentEnvFileWithUserVars(agentDir, agentName string, config *CredentialsFile, userVars map[string]string) error {
	prefix := toEnvPrefix(agentName)
	moltnetRelDir := agentDir

	// Build managed keys set for deduplication.
	managedKeys := map[string]bool{
		prefix + "_CLIENT_ID":                   true,
		prefix + "_CLIENT_SECRET":               true,
		prefix + "_GITHUB_APP_ID":               true,
		prefix + "_GITHUB_APP_PRIVATE_KEY_PATH": true,
		prefix + "_GITHUB_APP_INSTALLATION_ID":  true,
		"GIT_CONFIG_GLOBAL":                     true,
		"MOLTNET_ACTIVE_IDENTITY":               true,
		"MOLTNET_FINGERPRINT":                   true,
	}
	for key := range userVars {
		managedKeys[key] = true
	}

	var lines []string
	lines = append(lines, "# Managed by moltnet config init-from-env — do not edit above the user section")
	lines = append(lines, fmt.Sprintf("%s_CLIENT_ID='%s'", prefix, shellQuote(config.OAuth2.ClientID)))

	if config.GitHub != nil {
		lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_ID='%s'", prefix, shellQuote(config.GitHub.AppID)))
		if config.GitHub.PrivateKeyPath != "" {
			pemPath := portableAgentEnvPath(agentDir, agentName, config.GitHub.PrivateKeyPath)
			lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_PRIVATE_KEY_PATH='%s'", prefix, shellQuote(pemPath)))
		}
		lines = append(lines, fmt.Sprintf("%s_GITHUB_APP_INSTALLATION_ID='%s'", prefix, shellQuote(config.GitHub.InstallationID)))
	}
	lines = append(lines, fmt.Sprintf("MOLTNET_ACTIVE_IDENTITY='%s'", shellQuote(agentName)))
	lines = append(lines, fmt.Sprintf("MOLTNET_FINGERPRINT='%s'", shellQuote(config.Keys.Fingerprint)))

	gitconfigPath := filepath.Join(agentDir, "gitconfig")
	if _, err := os.Stat(gitconfigPath); err == nil {
		lines = append(lines, fmt.Sprintf("GIT_CONFIG_GLOBAL='%s'", shellQuote(filepath.Join(moltnetRelDir, "gitconfig"))))
	}

	// Preserve user-section content from existing env file.
	envPath := filepath.Join(agentDir, "env")
	existingEnv, err := configmigrate.ReadOptionalBoundedRegularFile(envPath, maxMigrationConfigBytes)
	if err != nil {
		return fmt.Errorf("inspect env file: %w", err)
	}
	userLines := extractUserSection(existingEnv, managedKeys)
	keys := make([]string, 0, len(userVars))
	for key := range userVars {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		userLines = append(userLines, fmt.Sprintf("%s='%s'", key, shellQuote(userVars[key])))
	}

	lines = append(lines, "")
	lines = append(lines, "# User section — add custom variables below")
	lines = append(lines, userLines...)
	if len(userLines) == 0 {
		lines = append(lines, "")
	}

	content := strings.Join(lines, "\n")
	if existingEnv == nil {
		err = writeFileAtomic(envPath, []byte(content))
	} else {
		err = configmigrate.ReplaceRegularFileAtomic(
			envPath,
			existingEnv,
			[]byte(content),
			maxMigrationConfigBytes,
		)
	}
	if err != nil {
		return fmt.Errorf("write env file: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Env file written to %s\n", envPath)
	return nil
}

// extractUserSection returns lines that belong to the user section: everything
// after "# User section", plus non-managed key=value lines found anywhere.
func extractUserSection(data []byte, managedKeys map[string]bool) []string {
	if data == nil {
		return nil
	}

	existing := strings.Split(string(data), "\n")
	var userLines []string
	inUserSection := false

	for _, line := range existing {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "# User section") {
			inUserSection = true
			continue
		}

		if inUserSection {
			// Filter out managed keys even within user section to prevent
			// duplicates when keys migrate between sections across upgrades.
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				eqIdx := strings.IndexByte(trimmed, '=')
				if eqIdx >= 1 && managedKeys[trimmed[:eqIdx]] {
					continue
				}
			}
			userLines = append(userLines, line)
			continue
		}

		// Outside user section: capture non-managed key=value lines.
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		eqIdx := strings.IndexByte(trimmed, '=')
		if eqIdx < 1 {
			continue
		}
		key := trimmed[:eqIdx]
		if !managedKeys[key] {
			userLines = append(userLines, line)
		}
	}

	return userLines
}
