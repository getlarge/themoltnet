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
	if _, err := WriteConfigTo(creds, target); err != nil {
		return nil, err
	}
	// SSH and Git paths are derived deployment artifacts. Recreate them beneath
	// the central identity directory rather than retaining repository paths.
	if err := runSSHKeyExportCmd(target, filepath.Join(filepath.Dir(target), "ssh")); err != nil {
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
	if err := runGitSetupCmd(target, gitName, gitEmail); err != nil {
		return nil, fmt.Errorf("regenerate Git configuration: %w", err)
	}
	if regenerated, err := ReadConfigFrom(target); err != nil {
		return nil, err
	} else if regenerated != nil && regenerated.GitHub != nil && regenerated.Git != nil {
		if err := ensureGitHubCredentialConfig(regenerated.Git.ConfigPath, target); err != nil {
			return nil, fmt.Errorf("enforce tokenless GitHub credential helper: %w", err)
		}
	}
	// env is non-secret activation context. Preserve it verbatim with owner-only
	// permissions; derived SSH/Git/cache files are regenerated in later steps.
	if data, err := os.ReadFile(filepath.Join(legacyDir, "env")); err == nil {
		if err := writeFileAtomic(filepath.Join(filepath.Dir(target), "env"), data); err != nil {
			return nil, fmt.Errorf("copy legacy environment: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read legacy environment: %w", err)
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
