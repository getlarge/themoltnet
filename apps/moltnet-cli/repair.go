package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ConfigIssue represents a single problem found during config validation.
type ConfigIssue struct {
	Field   string
	Problem string
	Action  string // "fixed", "warning", "migrate"
}

// runConfigRepairCmd is the flag-free business logic for config repair.
func runConfigRepairCmd(credPath string, dryRun bool) error {
	resolvedPath, creds, issues, err := loadAndValidate(credPath)
	if err != nil {
		return err
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

	// Apply fixes
	fixed := 0
	for _, iss := range issues {
		if iss.Action == "migrate" {
			newPath, err := migrateConfig(resolvedPath, creds)
			if err != nil {
				return fmt.Errorf("migrate: %w", err)
			}
			resolvedPath = newPath
			fixed++
		}
		if iss.Action == "fixed" {
			fixed++
		}
	}

	if fixed > 0 {
		writePath := resolvedPath
		if credPath != "" {
			writePath = credPath
		}
		if _, err := WriteConfigTo(creds, writePath); err != nil {
			return fmt.Errorf("write config: %w", err)
		}
		fmt.Fprintf(os.Stderr, "\n%d issue(s) fixed. Config written to %s\n", fixed, writePath)
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
		legacyPath := filepath.Join(dir, "credentials.json")

		c, err := ReadConfigFrom(moltnetPath)
		if err != nil {
			return "", nil, nil, err
		}
		if c != nil {
			configPath = moltnetPath
			creds = c
		} else {
			c, err = ReadConfigFrom(legacyPath)
			if err != nil {
				return "", nil, nil, err
			}
			if c != nil {
				configPath = legacyPath
				creds = c
				issues = append(issues, ConfigIssue{
					Field:   "file",
					Problem: fmt.Sprintf("using deprecated credentials.json at %s — will migrate to moltnet.json", legacyPath),
					Action:  "migrate",
				})
			} else {
				return "", nil, nil, fmt.Errorf("no config found at %s or %s", moltnetPath, legacyPath)
			}
		}
	}

	// Required fields
	if creds.IdentityID == "" {
		issues = append(issues, ConfigIssue{Field: "identity_id", Problem: "missing", Action: "warning"})
	}
	if creds.Keys.PublicKey == "" {
		issues = append(issues, ConfigIssue{Field: "keys.public_key", Problem: "missing", Action: "warning"})
	}
	if creds.Keys.PrivateKey == "" {
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
	if creds.GitHub != nil {
		checkFilePath(&issues, "github.private_key_path", creds.GitHub.PrivateKeyPath)
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
		// No env file — not an error for repair (moltnet.json may exist alone)
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

// migrateConfig writes the config to moltnet.json in the same directory.
func migrateConfig(legacyPath string, creds *CredentialsFile) (string, error) {
	dir := filepath.Dir(legacyPath)
	newPath := filepath.Join(dir, "moltnet.json")

	if _, err := WriteConfigTo(creds, newPath); err != nil {
		return "", err
	}
	fmt.Fprintf(os.Stderr, "  Migrated to %s (you can now delete %s)\n", newPath, legacyPath)
	return newPath, nil
}
