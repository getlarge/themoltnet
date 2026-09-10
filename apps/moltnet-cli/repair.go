package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ConfigIssue represents a single problem found during config validation.
type ConfigIssue struct {
	Field   string
	Problem string
	Action  string // "fixed" or "warning"
}

// runConfigRepairCmd is the flag-free business logic for config repair.
func runConfigRepairCmd(credPath string, dryRun bool) error {
	resolvedPath, creds, issues, err := loadAndValidate(credPath)
	if err != nil {
		return err
	}

	// Detect #1396 token pollution in git config files (outside moltnet.json).
	// On a real (non-dry) run these are stripped in place below.
	candidates := gitConfigCandidates(creds)
	tokenPaths := pollutedGitConfigs(candidates)
	for _, p := range tokenPaths {
		issues = append(issues, ConfigIssue{
			Field:   "git-config",
			Problem: fmt.Sprintf("embedded GitHub token found in %s", p),
			Action:  "fixed",
		})
	}

	// Detect helper shadowing: a github.com credential block missing the empty
	// `helper = ""` reset, which lets an inherited generic helper (osxkeychain)
	// shadow the agent helper with a stale token (#1396 regression).
	shadowPaths := shadowProneGitconfigs(candidates)
	for _, p := range shadowPaths {
		issues = append(issues, ConfigIssue{
			Field:   "git-config",
			Problem: fmt.Sprintf("github.com credential helper missing reset (shadow-prone) in %s", p),
			Action:  "fixed",
		})
	}

	// Detect SSH-signing configs that cannot verify: gpg.ssh.allowedSignersFile
	// unset (legacy configs predating the key) or naming a file that is gone
	// (an identity that moved out of a checkout).
	signerPaths := configsMissingAllowedSigners(candidates)
	for _, p := range signerPaths {
		issues = append(issues, ConfigIssue{
			Field:   "git-config",
			Problem: fmt.Sprintf("gpg.ssh.allowedSignersFile is unset or missing in %s", p),
			Action:  "fixed",
		})
	}

	if len(issues) == 0 {
		fmt.Fprintln(os.Stderr, "Config is valid, no issues found.")
		return nil
	}

	fmt.Fprintf(os.Stderr, "Found %d issue(s):\n", len(issues))
	for _, iss := range issues {
		fmt.Fprintf(os.Stderr, "  [%s] %s: %s\n", iss.Action, iss.Field, iss.Problem)
	}

	if dryRun {
		return nil
	}

	fixed := 0

	// Strip token pollution from git config files (file mutations, independent
	// of the moltnet.json struct rewrite below).
	for _, p := range tokenPaths {
		changed, err := repairGitConfigTokens(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  [warning] could not scrub %s: %v\n", p, err)
			continue
		}
		if changed {
			fmt.Fprintf(os.Stderr, "  [fixed] stripped embedded GitHub token from %s\n", p)
			fixed++
		}
	}

	// Add the helper reset to shadow-prone github.com credential blocks.
	for _, p := range shadowPaths {
		changed, err := repairHelperShadowing(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  [warning] could not fix helper shadowing in %s: %v\n", p, err)
			continue
		}
		if changed {
			fmt.Fprintf(os.Stderr, "  [fixed] added credential helper reset to %s\n", p)
			fixed++
		}
	}

	// Regenerate the signer document and repoint the config at it.
	for _, p := range signerPaths {
		changed, err := repairAllowedSigners(p, filepath.Dir(resolvedPath), creds)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  [warning] could not restore allowed_signers for %s: %v\n", p, err)
			continue
		}
		if changed {
			fmt.Fprintf(os.Stderr, "  [fixed] configured gpg.ssh.allowedSignersFile in %s\n", p)
			fixed++
		}
	}

	// Apply moltnet.json fixes. Only struct-level in-memory edits gate the
	// WriteConfigTo below; git-config scrubs are
	// already persisted above and must not force a redundant moltnet.json write.
	jsonChanged := false
	for _, iss := range issues {
		if iss.Field == "git-config" {
			continue
		}
		if iss.Action == "fixed" {
			jsonChanged = true
			fixed++
		}
	}

	if jsonChanged {
		writePath := resolvedPath
		if credPath != "" {
			writePath = credPath
		}
		if _, err := WriteConfigTo(creds, writePath); err != nil {
			return fmt.Errorf("write config: %w", err)
		}
	}

	if fixed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d issue(s) fixed.\n", fixed)
	}

	return nil
}

// loadAndValidate reads the config and returns all issues found.
// It mutates the config struct in-place for auto-fixable issues.
func loadAndValidate(credPath string) (string, *CredentialsFile, []ConfigIssue, error) {
	var issues []ConfigIssue
	var configPath string
	var creds *CredentialsFile

	if credPath != "" {
		configPath = credPath
		c, err := ReadConfigFrom(credPath)
		if err != nil {
			return "", nil, nil, fmt.Errorf("read config: %w", err)
		}
		if c == nil {
			return "", nil, nil, fmt.Errorf("config not found at %s", credPath)
		}
		creds = c
	} else {
		dir, err := GetConfigDir()
		if err != nil {
			return "", nil, nil, err
		}

		moltnetPath := filepath.Join(dir, "moltnet.json")
		c, err := ReadConfigFrom(moltnetPath)
		if err != nil {
			return "", nil, nil, err
		}
		if c == nil {
			return "", nil, nil, fmt.Errorf("no config found at %s", moltnetPath)
		}
		configPath = moltnetPath
		creds = c
	}

	// Required fields
	if _, ok := creds.CanonicalSubject(); !ok {
		issues = append(issues, ConfigIssue{Field: "subject_id", Problem: "missing or unsupported subject anchor", Action: "warning"})
	}
	if creds.Keys.PublicKey == "" {
		issues = append(issues, ConfigIssue{Field: "keys.public_key", Problem: "missing", Action: "warning"})
	}
	if creds.Keys.PrivateKey == "" && creds.Keys.PrivateKeyRef == nil {
		issues = append(issues, ConfigIssue{Field: "keys.private_key", Problem: "missing", Action: "warning"})
	}

	// Public key format
	if creds.Keys.PublicKey != "" && !strings.HasPrefix(creds.Keys.PublicKey, "ed25519:") {
		issues = append(issues, ConfigIssue{Field: "keys.public_key", Problem: "missing 'ed25519:' prefix", Action: "warning"})
	}

	// MCP endpoint derivable from API
	if creds.Endpoints.API != "" {
		correctMCP := deriveMCPURL(creds.Endpoints.API)
		if creds.Endpoints.MCP == "" {
			creds.Endpoints.MCP = correctMCP
			issues = append(issues, ConfigIssue{Field: "endpoints.mcp", Problem: "missing — derived from API endpoint", Action: "fixed"})
		} else if creds.Endpoints.MCP != correctMCP {
			creds.Endpoints.MCP = correctMCP
			issues = append(issues, ConfigIssue{Field: "endpoints.mcp", Problem: "incorrect — updated to " + correctMCP, Action: "fixed"})
		}
	}
	if creds.Endpoints.API == "" {
		issues = append(issues, ConfigIssue{Field: "endpoints.api", Problem: "missing", Action: "warning"})
	}

	// File path validations
	if creds.SSH != nil {
		checkFilePath(&issues, "ssh.private_key_path", creds.SSH.PrivateKeyPath)
		checkFilePath(&issues, "ssh.public_key_path", creds.SSH.PublicKeyPath)
	}
	if creds.Git != nil {
		checkFilePath(&issues, "git.config_path", creds.Git.ConfigPath)
	}
	if creds.GitHub != nil && creds.GitHub.PrivateKeyPath != "" {
		checkFilePath(&issues, "github.private_key_path", creds.GitHub.PrivateKeyPath)
	}
	if creds.GitHub != nil && creds.GitHub.PrivateKeyPath == "" && creds.GitHub.PrivateKeyRef == nil {
		issues = append(issues, ConfigIssue{Field: "github.private_key_path", Problem: "missing", Action: "warning"})
	}

	// Validate sibling env file authorship vars
	envPath := filepath.Join(filepath.Dir(configPath), "env")
	validateEnvAuthorship(&issues, envPath)

	return configPath, creds, issues, nil
}

// validateEnvAuthorship checks authorship-related vars in the env file.
func validateEnvAuthorship(issues *[]ConfigIssue, envPath string) {
	vars, err := parseEnvFile(envPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No env file — not an error for repair (moltnet.json may exist alone)
			return
		}
		*issues = append(*issues, ConfigIssue{
			Field:   "env",
			Problem: fmt.Sprintf("failed to parse env file %s: %v", envPath, err),
			Action:  "warning",
		})
		return
	}

	authorship := vars["MOLTNET_COMMIT_AUTHORSHIP"]
	if authorship != "" && authorship != "agent" && authorship != "human" && authorship != "coauthor" {
		*issues = append(*issues, ConfigIssue{
			Field:   "env.MOLTNET_COMMIT_AUTHORSHIP",
			Problem: fmt.Sprintf("invalid value %q — must be agent, human, or coauthor", authorship),
			Action:  "warning",
		})
	}

	humanID := vars["MOLTNET_HUMAN_GIT_IDENTITY"]
	if (authorship == "human" || authorship == "coauthor") && humanID == "" {
		*issues = append(*issues, ConfigIssue{
			Field:   "env.MOLTNET_HUMAN_GIT_IDENTITY",
			Problem: fmt.Sprintf("missing — required for %s authorship mode", authorship),
			Action:  "warning",
		})
	}
	if humanID != "" && !isValidGitIdentity(humanID) {
		*issues = append(*issues, ConfigIssue{
			Field:   "env.MOLTNET_HUMAN_GIT_IDENTITY",
			Problem: fmt.Sprintf("invalid format %q — expected: Name <email>", humanID),
			Action:  "warning",
		})
	}
}

func checkFilePath(issues *[]ConfigIssue, field, path string) {
	if path == "" {
		return
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		*issues = append(*issues, ConfigIssue{
			Field:   field,
			Problem: fmt.Sprintf("file not found: %s", path),
			Action:  "warning",
		})
	}
}

// runConfigRepair is the legacy flag-parsing entry point, preserved for existing tests.
func runConfigRepair(args []string) error {
	fs := flag.NewFlagSet("config repair", flag.ExitOnError)
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	dryRun := fs.Bool("dry-run", false, "Report issues without fixing them")
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runConfigRepairCmd(*credPath, *dryRun)
}

// repairGitConfigTokens strips embedded GitHub tokens from a git config file.
// A missing file is a silent no-op. Returns true if the file was modified.
func repairGitConfigTokens(gitConfigPath string) (bool, error) {
	if _, err := os.Stat(gitConfigPath); os.IsNotExist(err) {
		return false, nil
	}
	return cleanGitConfigFile(gitConfigPath)
}

// repairHelperShadowing adds the empty `helper = ""` reset to a github.com
// credential block that lacks it, so the agent helper is authoritative over an
// inherited generic helper (osxkeychain/store). A missing file or a block that
// already has the reset is a no-op. Returns true if the file was modified.
func repairHelperShadowing(gitConfigPath string) (bool, error) {
	b, err := os.ReadFile(gitConfigPath)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	original := string(b)
	if !needsHelperReset(original) {
		return false, nil
	}
	fixed := addHelperReset(original)
	if fixed == original {
		return false, nil
	}
	if err := os.WriteFile(gitConfigPath, []byte(fixed), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// gitConfigCandidates returns git config files that may carry #1396 token
// pollution: the current repo's .git/config and the agent gitconfig.
func gitConfigCandidates(creds *CredentialsFile) []string {
	var paths []string
	if out, err := exec.Command("git", "rev-parse", "--git-dir").Output(); err == nil {
		gitDir := strings.TrimSpace(string(out))
		if gitDir != "" {
			paths = append(paths, filepath.Join(gitDir, "config"))
		}
	}
	if creds.Git != nil && creds.Git.ConfigPath != "" {
		paths = append(paths, creds.Git.ConfigPath)
	}
	return paths
}

// gitConfigValue reads one key from a git config file, returning "" when the
// key is unset or the file cannot be parsed.
func gitConfigValue(gitConfigPath, key string) string {
	out, err := exec.Command("git", "config", "--file", gitConfigPath, "--get", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// signsWithSSH reports whether a git config actually performs SSH signing, so
// repair only touches configs where a signer document is meaningful and leaves
// unrelated git configs alone.
func signsWithSSH(gitConfigPath string) bool {
	if !strings.EqualFold(gitConfigValue(gitConfigPath, "gpg.format"), "ssh") {
		return false
	}
	if gitConfigValue(gitConfigPath, "user.signingkey") != "" {
		return true
	}
	return strings.EqualFold(gitConfigValue(gitConfigPath, "commit.gpgsign"), "true") ||
		strings.EqualFold(gitConfigValue(gitConfigPath, "tag.gpgsign"), "true")
}

// configsMissingAllowedSigners returns SSH-signing configs that cannot verify a
// signature, because gpg.ssh.allowedSignersFile is either unset or names a file
// that is not there.
//
// Both shapes produce the same per-command complaint —
// "gpg.ssh.allowedSignersFile needs to be configured and exist" — on every
// verification rather than once at setup, so operators experience it as
// constant noise long after the cause.
//
// Unset is the older of the two: gitconfigs written before the key was emitted
// sign commits happily and can never verify them, with a perfectly good
// allowed_signers sitting unreferenced beside them. A stale path is the newer
// shape, left by an identity that moved out of a checkout.
func configsMissingAllowedSigners(candidates []string) []string {
	var broken []string
	for _, p := range candidates {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if !signsWithSSH(p) {
			continue
		}
		configured := gitConfigValue(p, "gpg.ssh.allowedSignersFile")
		if configured != "" {
			if _, err := os.Stat(configured); err == nil {
				continue
			}
		}
		broken = append(broken, p)
	}
	return broken
}

// repairAllowedSigners regenerates the canonical allowed_signers document for
// the identity being repaired and repoints the git config at it.
//
// It rewrites the path rather than recreating the file where the config
// happens to point: a stale path is usually a directory that no longer exists,
// and recreating a signer document inside an abandoned checkout would leave the
// identity split across two locations.
func repairAllowedSigners(gitConfigPath, configDir string, creds *CredentialsFile) (bool, error) {
	if creds.SSH == nil || strings.TrimSpace(creds.SSH.PublicKeyPath) == "" {
		return false, fmt.Errorf("SSH keys not exported — run 'moltnet ssh-key' first")
	}
	if creds.Git == nil || strings.TrimSpace(creds.Git.Email) == "" {
		return false, fmt.Errorf("git email is not configured — run 'moltnet git setup' first")
	}
	pubKeyContent, err := os.ReadFile(creds.SSH.PublicKeyPath)
	if err != nil {
		return false, fmt.Errorf("read SSH public key: %w", err)
	}
	canonical, err := writeAllowedSignersFile(configDir, strings.TrimSpace(creds.Git.Email), pubKeyContent)
	if err != nil {
		return false, err
	}
	if gitConfigValue(gitConfigPath, "gpg.ssh.allowedSignersFile") == canonical {
		return true, nil
	}
	command := exec.Command(
		"git", "config", "--file", gitConfigPath, "gpg.ssh.allowedSignersFile", canonical,
	)
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		return false, fmt.Errorf(
			"set gpg.ssh.allowedSignersFile: %w: %s", commandErr, strings.TrimSpace(string(output)),
		)
	}
	return true, nil
}

// pollutedGitConfigs returns the subset of paths that exist and contain an
// embedded GitHub token. Used to report issues before applying fixes.
func pollutedGitConfigs(candidates []string) []string {
	var polluted []string
	for _, p := range candidates {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if hasTokenBearingRule(string(b)) {
			polluted = append(polluted, p)
		}
	}
	return polluted
}

// shadowProneGitconfigs returns the subset of paths that have a github.com
// credential helper without the empty reset (and are thus vulnerable to an
// inherited generic helper shadowing the agent helper).
func shadowProneGitconfigs(candidates []string) []string {
	var prone []string
	for _, p := range candidates {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if needsHelperReset(string(b)) {
			prone = append(prone, p)
		}
	}
	return prone
}
