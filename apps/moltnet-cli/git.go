package main

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/natefinch/atomic"
)

// runGitSetupCmd is the flag-free business logic for git setup.
func runGitSetupCmd(credPath, name, email string) error {
	creds, err := loadCredentials(credPath)
	if err != nil {
		return err
	}

	if creds.SSH == nil {
		return fmt.Errorf("SSH keys not exported — run 'moltnet ssh-key' first")
	}

	// Read SSH public key content
	pubKeyContent, err := os.ReadFile(creds.SSH.PublicKeyPath)
	if err != nil {
		return fmt.Errorf("read SSH public key: %w", err)
	}

	// Determine name/email
	gitName := name
	if gitName == "" {
		idPrefix := creds.IdentityID
		if len(idPrefix) > 8 {
			idPrefix = idPrefix[:8]
		}
		gitName = "moltnet-agent-" + idPrefix
	}

	gitEmail := email
	if gitEmail == "" {
		gitEmail = creds.IdentityID + "@agents.themolt.net"
	}
	if err := validateGitIdentityValue("Git name", gitName); err != nil {
		return err
	}
	if err := validateGitIdentityValue("Git email", gitEmail); err != nil {
		return err
	}

	// Build allowed_signers — relative to the config file
	var configDir string
	if credPath != "" {
		configDir = filepath.Dir(credPath)
	} else {
		configDir, err = GetConfigDir()
		if err != nil {
			return err
		}
	}
	sshDir := filepath.Join(configDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		return fmt.Errorf("create ssh dir: %w", err)
	}
	allowedSignersPath := filepath.Join(sshDir, "allowed_signers")
	allowedSigners := fmt.Sprintf("%s %s\n", gitEmail, strings.TrimSpace(string(pubKeyContent)))
	if err := os.WriteFile(allowedSignersPath, []byte(allowedSigners), 0o644); err != nil {
		return fmt.Errorf("write allowed_signers: %w", err)
	}

	gitconfigPath := filepath.Join(configDir, "gitconfig")
	if err := writeGitConfigFile(gitconfigPath, map[string]string{
		"user.name":                  gitName,
		"user.email":                 gitEmail,
		"user.signingkey":            creds.SSH.PublicKeyPath,
		"gpg.format":                 "ssh",
		"gpg.ssh.allowedSignersFile": allowedSignersPath,
		"commit.gpgsign":             "true",
		"tag.gpgsign":                "true",
	}); err != nil {
		return fmt.Errorf("write gitconfig: %w", err)
	}

	// Update config
	creds.Git = &GitSection{
		Name:       gitName,
		Email:      gitEmail,
		Signing:    true,
		ConfigPath: gitconfigPath,
	}
	if credPath != "" {
		if _, err := WriteConfigTo(creds, credPath); err != nil {
			return fmt.Errorf("update config: %w", err)
		}
	} else {
		if _, err := WriteConfig(creds); err != nil {
			return fmt.Errorf("update config: %w", err)
		}
	}

	fmt.Fprintf(os.Stderr, "Git identity configured:\n")
	fmt.Fprintf(os.Stderr, "  Name:       %s\n", gitName)
	fmt.Fprintf(os.Stderr, "  Email:      %s\n", gitEmail)
	fmt.Fprintf(os.Stderr, "  Gitconfig:  %s\n", gitconfigPath)
	fmt.Fprintf(os.Stderr, "  Signers:    %s\n", allowedSignersPath)
	fmt.Fprintf(os.Stderr, "\nActivate with: export GIT_CONFIG_GLOBAL=%s\n", gitconfigPath)

	return nil
}

func rejectControlCharacters(label, value string) error {
	for _, r := range value {
		if unicode.IsControl(r) {
			return fmt.Errorf("%s must not contain control characters", label)
		}
	}
	return nil
}

func validateGitIdentityValue(label, value string) error {
	return rejectControlCharacters(label, value)
}

func writeGitConfigFile(path string, values map[string]string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".gitconfig-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	if err := temp.Close(); err != nil {
		return err
	}
	defer os.Remove(tempPath)
	if err := os.Chmod(tempPath, 0o600); err != nil {
		return err
	}
	for _, key := range []string{
		"user.name",
		"user.email",
		"user.signingkey",
		"gpg.format",
		"gpg.ssh.allowedSignersFile",
		"commit.gpgsign",
		"tag.gpgsign",
	} {
		command := exec.Command("git", "config", "--file", tempPath, key, values[key])
		if output, commandErr := command.CombinedOutput(); commandErr != nil {
			return fmt.Errorf("set %s: %w: %s", key, commandErr, strings.TrimSpace(string(output)))
		}
	}
	data, err := os.ReadFile(tempPath)
	if err != nil {
		return err
	}
	if err := atomic.WriteFile(path, bytes.NewReader(data)); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

// runGitSetup is the legacy flag-parsing entry point, preserved for existing tests.
func runGitSetup(args []string) error {
	fs := flag.NewFlagSet("git setup", flag.ExitOnError)
	name := fs.String("name", "", "Git committer name")
	email := fs.String("email", "", "Git committer email")
	credPath := fs.String("credentials", "", "Path to moltnet.json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runGitSetupCmd(*credPath, *name, *email)
}
