package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// migrateLegacyIdentityStore is intentionally reachable only through an
// explicit --credentials path. It never participates in normal resolution.
func migrateLegacyIdentityStore(credentialsPath, requestedAlias string, dryRun bool) (map[string]interface{}, error) {
	path, err := absolutePath(credentialsPath)
	if err != nil {
		return nil, err
	}
	root, err := identityStoreDir()
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(path, filepath.Join(root, "identities")+string(filepath.Separator)) {
		return nil, nil
	}
	alias := strings.TrimSpace(requestedAlias)
	legacyDir := filepath.Dir(path)
	if alias == "" && filepath.Base(filepath.Dir(legacyDir)) == ".moltnet" {
		alias = filepath.Base(legacyDir)
	}
	if alias == "" {
		return nil, fmt.Errorf("--name is required when the legacy credentials path is not .moltnet/<alias>/moltnet.json")
	}
	if err := validateAgentName(alias); err != nil {
		return nil, err
	}
	if regularFileExists(filepath.Join(legacyDir, agentsInitStateFile)) {
		return nil, fmt.Errorf("cannot migrate incomplete onboarding; resume 'moltnet agents init --name %s' first", alias)
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		return nil, err
	}
	if creds == nil {
		return nil, fmt.Errorf("legacy credentials not found at %s", path)
	}
	target, err := identityCredentialsPath(alias)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{"alias": alias, "source": path, "destination": target, "changed": !regularFileExists(target)}
	if dryRun {
		return result, nil
	}
	if existing, err := ReadConfigFrom(target); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.IdentityID != creds.IdentityID || existing.Keys.PublicKey != creds.Keys.PublicKey {
			return nil, fmt.Errorf("central identity %q already exists with different immutable identity fields", alias)
		}
		return result, nil
	}
	identitiesDir := filepath.Dir(filepath.Dir(target))
	if err := os.MkdirAll(identitiesDir, 0o700); err != nil {
		return nil, fmt.Errorf("create central identity store: %w", err)
	}
	stagingDir, err := os.MkdirTemp(identitiesDir, "."+alias+"-")
	if err != nil {
		return nil, fmt.Errorf("create migration staging directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(stagingDir) }()
	stagedConfig := filepath.Join(stagingDir, "moltnet.json")
	if _, err := WriteConfigTo(creds, stagedConfig); err != nil {
		return nil, err
	}
	// SSH and Git paths are derived deployment artifacts. Recreate them beneath
	// the central identity directory rather than retaining repository paths.
	if err := runSSHKeyExportCmd(stagedConfig, filepath.Join(stagingDir, "ssh")); err != nil {
		return nil, fmt.Errorf("regenerate SSH exports: %w", err)
	}
	gitName, gitEmail := alias, creds.IdentityID+"@agents.themolt.net"
	if creds.Git != nil {
		if creds.Git.Name != "" {
			gitName = creds.Git.Name
		}
		if creds.Git.Email != "" {
			gitEmail = creds.Git.Email
		}
	}
	if err := runGitSetupCmd(stagedConfig, gitName, gitEmail); err != nil {
		return nil, fmt.Errorf("regenerate Git configuration: %w", err)
	}
	if regenerated, err := ReadConfigFrom(stagedConfig); err != nil {
		return nil, err
	} else if regenerated != nil && regenerated.GitHub != nil && regenerated.Git != nil {
		if err := ensureGitHubCredentialConfig(regenerated.Git.ConfigPath, stagedConfig); err != nil {
			return nil, fmt.Errorf("enforce tokenless GitHub credential helper: %w", err)
		}
	}
	// Preserve only user-provided environment lines. Managed values, including
	// old repository Git/SSH paths, are regenerated for the central directory.
	if data, err := os.ReadFile(filepath.Join(legacyDir, "env")); err == nil {
		if err := writeFileAtomic(filepath.Join(stagingDir, "env"), data); err != nil {
			return nil, fmt.Errorf("copy legacy environment: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read legacy environment: %w", err)
	}
	regenerated, err := ReadConfigFrom(stagedConfig)
	if err != nil {
		return nil, err
	}
	if err := writeAgentEnvFile(stagingDir, alias, regenerated); err != nil {
		return nil, fmt.Errorf("regenerate central environment: %w", err)
	}
	if err := rewriteStagedIdentityPaths(stagingDir, filepath.Dir(target), regenerated); err != nil {
		return nil, err
	}
	if err := os.Rename(stagingDir, filepath.Dir(target)); err != nil {
		return nil, fmt.Errorf("publish central identity: %w", err)
	}
	if selector, err := readIdentitySelector(); err != nil {
		return nil, err
	} else if selector == nil || selector.DefaultIdentity == "" {
		if err := writeIdentitySelector(alias); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// rewriteStagedIdentityPaths keeps a staged migration atomic while ensuring
// the published document and activation files never retain temporary paths.
func rewriteStagedIdentityPaths(stagingDir, targetDir string, creds *CredentialsFile) error {
	replace := func(value string) string { return strings.ReplaceAll(value, stagingDir, targetDir) }
	if creds.SSH != nil {
		creds.SSH.PrivateKeyPath = replace(creds.SSH.PrivateKeyPath)
		creds.SSH.PublicKeyPath = replace(creds.SSH.PublicKeyPath)
	}
	if creds.Git != nil {
		creds.Git.ConfigPath = replace(creds.Git.ConfigPath)
	}
	if creds.GitHub != nil {
		creds.GitHub.PrivateKeyPath = replace(creds.GitHub.PrivateKeyPath)
	}
	if _, err := WriteConfigTo(creds, filepath.Join(stagingDir, "moltnet.json")); err != nil {
		return fmt.Errorf("rewrite staged credentials paths: %w", err)
	}
	for _, name := range []string{"gitconfig", "env"} {
		path := filepath.Join(stagingDir, name)
		data, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read staged %s: %w", name, err)
		}
		if err := writeFileAtomic(path, []byte(strings.ReplaceAll(string(data), stagingDir, targetDir))); err != nil {
			return fmt.Errorf("rewrite staged %s paths: %w", name, err)
		}
	}
	return nil
}
