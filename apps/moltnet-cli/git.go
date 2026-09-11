package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/natefinch/atomic"
)

// runGitSetupCmd is the flag-free business logic for git setup.
func runGitSetupCmd(errOut io.Writer, credPath, name, email string) error {
	creds, credPath, err := loadCredentialsWithPath(credPath)
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

	gitName, gitEmail := strings.TrimSpace(name), strings.TrimSpace(email)
	if creds.Git != nil {
		if gitName == "" {
			gitName = strings.TrimSpace(creds.Git.Name)
		}
		if gitEmail == "" {
			gitEmail = strings.TrimSpace(creds.Git.Email)
		}
	}
	if gitName == "" || gitEmail == "" {
		return fmt.Errorf(
			"Git name and email are required; pass --name and --email, or run 'moltnet github setup' to resolve the exact bot identity",
		)
	}
	if err := validateGitIdentityValue("Git name", gitName); err != nil {
		return err
	}
	if err := validateGitIdentityValue("Git email", gitEmail); err != nil {
		return err
	}

	// Build allowed_signers beside the identity it belongs to. Without
	// --credentials that is the selected identity, not the store root: writing
	// there left moltnet.json naming a gitconfig that sessions never load.
	configDir := filepath.Dir(credPath)
	allowedSignersPath, err := writeAllowedSignersFile(configDir, gitEmail, pubKeyContent)
	if err != nil {
		return err
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
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		return fmt.Errorf("update config: %w", err)
	}

	fmt.Fprintf(errOut, "Git identity configured:\n")
	fmt.Fprintf(errOut, "  Name:       %s\n", gitName)
	fmt.Fprintf(errOut, "  Email:      %s\n", gitEmail)
	fmt.Fprintf(errOut, "  Gitconfig:  %s\n", gitconfigPath)
	fmt.Fprintf(errOut, "  Signers:    %s\n", allowedSignersPath)
	fmt.Fprintf(errOut, "\nActivate with: export GIT_CONFIG_GLOBAL=%s\n", gitconfigPath)

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

// allowedSignersPathFor returns the canonical allowed_signers location for an
// identity directory. Signing verification reads this file, so it lives beside
// the config it belongs to rather than wherever a previous checkout put it.
func allowedSignersPathFor(configDir string) string {
	return filepath.Join(configDir, "ssh", "allowed_signers")
}

// writeAllowedSignersFile writes the single-signer allowed_signers document for
// an identity and returns its path. `git setup` and `config repair` share it so
// the two cannot drift in format: git verifies signatures against this exact
// content, and a mismatch fails verification rather than erroring loudly.
func writeAllowedSignersFile(configDir, gitEmail string, pubKeyContent []byte) (string, error) {
	sshDir := filepath.Join(configDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		return "", fmt.Errorf("create ssh dir: %w", err)
	}
	path := allowedSignersPathFor(configDir)
	document := fmt.Sprintf("%s %s\n", gitEmail, strings.TrimSpace(string(pubKeyContent)))
	if err := os.WriteFile(path, []byte(document), 0o644); err != nil {
		return "", fmt.Errorf("write allowed_signers: %w", err)
	}
	return path, nil
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
	// Start from the existing gitconfig so only the identity and signing keys
	// change: it also carries the GitHub credential helper and SSH-to-HTTPS
	// rewrite that `github setup` installed, and a fresh file dropped them.
	existing, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.WriteFile(tempPath, existing, 0o600); err != nil {
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
	return runGitSetupCmd(os.Stderr, *credPath, *name, *email)
}
