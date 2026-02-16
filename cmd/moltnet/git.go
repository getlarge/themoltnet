package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func runGitSetup(args []string) error {
	fs := flag.NewFlagSet("git setup", flag.ExitOnError)
	name := fs.String("name", "", "Git committer name (default: moltnet-agent-<id-prefix>)")
	email := fs.String("email", "", "Git committer email (default: <identity_id>@agents.themolt.net)")
	credPath := fs.String("credentials", "", "Path to moltnet.json")

	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet git setup [options]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Configure git identity for SSH commit signing.")
		fmt.Fprintln(os.Stderr, "Requires SSH keys (run 'moltnet ssh-key' first).")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Options:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	creds, err := loadCredentials(*credPath)
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
	gitName := *name
	if gitName == "" {
		idPrefix := creds.IdentityID
		if len(idPrefix) > 8 {
			idPrefix = idPrefix[:8]
		}
		gitName = "moltnet-agent-" + idPrefix
	}

	gitEmail := *email
	if gitEmail == "" {
		gitEmail = creds.IdentityID + "@agents.themolt.net"
	}

	// Build allowed_signers
	configDir, err := GetConfigDir()
	if err != nil {
		return err
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

	// Build gitconfig
	gitconfig := fmt.Sprintf(`[user]
	name = %s
	email = %s
	signingkey = %s

[gpg]
	format = ssh

[gpg "ssh"]
	allowedSignersFile = %s

[commit]
	gpgsign = true

[tag]
	gpgsign = true
`, gitName, gitEmail, creds.SSH.PublicKeyPath, allowedSignersPath)

	gitconfigPath := filepath.Join(configDir, "gitconfig")
	if err := os.WriteFile(gitconfigPath, []byte(gitconfig), 0o644); err != nil {
		return fmt.Errorf("write gitconfig: %w", err)
	}

	// Update config
	creds.Git = &GitSection{
		Name:       gitName,
		Email:      gitEmail,
		Signing:    true,
		ConfigPath: gitconfigPath,
	}
	if _, err := WriteConfig(creds); err != nil {
		return fmt.Errorf("update config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Git identity configured:\n")
	fmt.Fprintf(os.Stderr, "  Name:       %s\n", gitName)
	fmt.Fprintf(os.Stderr, "  Email:      %s\n", gitEmail)
	fmt.Fprintf(os.Stderr, "  Gitconfig:  %s\n", gitconfigPath)
	fmt.Fprintf(os.Stderr, "  Signers:    %s\n", allowedSignersPath)
	fmt.Fprintf(os.Stderr, "\nActivate with: export GIT_CONFIG_GLOBAL=%s\n", gitconfigPath)

	return nil
}
