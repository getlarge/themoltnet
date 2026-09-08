package main

import (
	"encoding/json"
	"fmt"
	"io"
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
	// The early agent daemon stored managed documents as
	// agents/<alias>.json. It has no bundle directory, but its filename still
	// provides the local-only alias required by the central store.
	if alias == "" && filepath.Base(legacyDir) == "agents" && filepath.Ext(path) == ".json" {
		alias = strings.TrimSuffix(filepath.Base(path), ".json")
	}
	if alias == "" {
		return nil, fmt.Errorf("--name is required when the legacy credentials path does not encode an identity alias")
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
	// The conflict check runs before the dry-run return: a dry run that reports
	// success for a migration which will hard-fail on the real run is worse
	// than no dry run at all.
	existing, err := ReadConfigFrom(target)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		sameSubject := strings.TrimSpace(existing.SubjectID) != "" &&
			existing.SubjectID == creds.SubjectID
		if !sameSubject ||
			existing.Keys.PublicKey != creds.Keys.PublicKey {
			return nil, fmt.Errorf(
				"central identity %q already exists and does not match the bundle "+
					"being migrated (subject and/or public key differ).\n"+
					"A different subject is an alias collision; a matching subject with "+
					"a changed key requires authenticated rotation reconciliation.\n"+
					"Migrate under another alias with --name <alias>, or remove %s "+
					"first if you are certain it is the same agent.",
				alias, filepath.Dir(target),
			)
		}
		// Publication and selector seeding are two steps: a crash between them
		// leaves the identity durable but unselected, and this early return
		// would report success forever without ever fixing it. Reconcile here
		// so a retry repairs what the interrupted run could not.
		if err := ensureIdentitySelected(alias); err != nil {
			return nil, err
		}
		return result, nil
	}
	if dryRun {
		return result, nil
	}
	if err := assertPublishableIdentityDir(filepath.Dir(target), alias); err != nil {
		return nil, err
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
	// io.Discard, for the same reason as the Git setup below: these paths are
	// inside the staging directory and stop existing at the publish rename.
	if err := runSSHKeyExportCmd(io.Discard, stagedConfig, filepath.Join(stagingDir, "ssh")); err != nil {
		return nil, fmt.Errorf("regenerate SSH exports: %w", err)
	}
	if creds.Git == nil || strings.TrimSpace(creds.Git.Name) == "" || strings.TrimSpace(creds.Git.Email) == "" {
		return nil, fmt.Errorf(
			"legacy identity %q has no complete Git authorship; configure git.name and git.email or run 'moltnet github setup' before migrating",
			alias,
		)
	}
	// io.Discard: this configures Git inside the staging directory, whose name
	// (.<alias>-<random>) exists only until the publish rename below. Letting
	// runGitSetupCmd print its summary surfaced paths like
	// `.legreffier-1252146280/gitconfig` to the operator as though that were
	// their identity. Migration reports the real destination in its own
	// document.
	if err := runGitSetupCmd(io.Discard, stagedConfig, creds.Git.Name, creds.Git.Email); err != nil {
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
	// io.Discard: this runs inside `config migrate`, which owns a single
	// machine-readable document on stdout and prints its own progress. The
	// env writer's notice would be a second, unrelated voice.
	if err := writeAgentEnvFile(io.Discard, stagingDir, alias, regenerated); err != nil {
		return nil, fmt.Errorf("regenerate central environment: %w", err)
	}
	if err := rewriteStagedIdentityPaths(stagingDir, filepath.Dir(target), regenerated); err != nil {
		return nil, err
	}
	// The public config writer intentionally cannot serialize identity_id. A
	// relocated legacy document still needs that private compatibility value
	// for the older OAuth2 transition, which runs before subject anchoring.
	// Preserve it only in this staged copy; the final subject migration removes
	// it atomically after the provider references have been re-keyed.
	if creds.legacyIdentityID != "" {
		if err := restoreLegacyIdentityField(stagedConfig, creds.legacyIdentityID); err != nil {
			return nil, err
		}
	}
	if err := os.Rename(stagingDir, filepath.Dir(target)); err != nil {
		return nil, fmt.Errorf(
			"publish central identity %q to %s: %w",
			alias, filepath.Dir(target), err,
		)
	}
	if err := ensureIdentitySelected(alias); err != nil {
		return nil, err
	}
	return result, nil
}

func restoreLegacyIdentityField(path, identityID string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read staged legacy credentials: %w", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(data, &document); err != nil {
		return fmt.Errorf("parse staged legacy credentials: %w", err)
	}
	updated, err := rewriteCredentialsDocument(document, func(top map[string]json.RawMessage) error {
		encoded, marshalErr := json.Marshal(identityID)
		if marshalErr != nil {
			return marshalErr
		}
		top["identity_id"] = encoded
		return nil
	})
	if err != nil {
		return err
	}
	if err := writeFileAtomic(path, updated); err != nil {
		return fmt.Errorf("preserve staged legacy identity: %w", err)
	}
	return nil
}

// ensureIdentitySelected seeds the selector when no default is set. Idempotent
// so it can run both after a fresh publish and on a retry that found the
// identity already published.
func ensureIdentitySelected(alias string) error {
	selector, err := readIdentitySelector()
	if err != nil {
		return err
	}
	if selector != nil && selector.DefaultIdentity != "" {
		return nil
	}
	return writeIdentitySelector(alias)
}

// assertPublishableIdentityDir rejects a target directory that exists but holds
// no moltnet.json — the residue of an earlier run that failed after creating
// the directory. os.Rename onto it fails with a bare ENOTEMPTY that names
// neither the cause nor the remedy, leaving the alias permanently unmigratable.
func assertPublishableIdentityDir(dir, alias string) error {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect central identity directory %s: %w", dir, err)
	}
	if len(entries) == 0 {
		return os.Remove(dir)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return fmt.Errorf(
		"central identity directory %s already exists without %s "+
			"(contains: %s); it is likely the residue of an interrupted "+
			"migration — inspect it and remove it before retrying "+
			"'moltnet config migrate --credentials <path> --name %s'",
		dir, identityConfigFileName, strings.Join(names, ", "), alias,
	)
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
