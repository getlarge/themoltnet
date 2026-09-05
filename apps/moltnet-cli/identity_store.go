package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// IdentitySelector is deliberately separate from an identity document: aliases
// are local ergonomics and are never part of the cryptographic identity.
type IdentitySelector struct {
	Version         int    `json:"version"`
	DefaultIdentity string `json:"default_identity,omitempty"`
}

const (
	identitySelectorVersion = 1

	// Path shape of the central store. These are load-bearing — the plugin
	// pre-gate, the secrets guard and the daemon all encode the same layout.
	identitiesDirName      = "identities"
	identityConfigFileName = "moltnet.json"
	identitySelectorFile   = "identity-selector.json"

	activeIdentityEnv = "MOLTNET_ACTIVE_IDENTITY"
	// legacyActiveIdentityEnv is still honoured (and still written by
	// `config export-env`) so an env bundle exported before the central-store
	// cutover keeps resolving after upgrade.
	legacyActiveIdentityEnv = "MOLTNET_AGENT_NAME"
)

func identityStoreDir() (string, error) { return GetConfigDir() }

func identityDir(alias string) (string, error) {
	if err := validateAgentName(alias); err != nil {
		return "", fmt.Errorf("invalid identity alias: %w", err)
	}
	root, err := identityStoreDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, identitiesDirName, alias), nil
}

func identityCredentialsPath(alias string) (string, error) {
	dir, err := identityDir(alias)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, identityConfigFileName), nil
}

func identitySelectorPath() (string, error) {
	root, err := identityStoreDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, identitySelectorFile), nil
}

func readIdentitySelector() (*IdentitySelector, error) {
	path, err := identitySelectorPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read identity selector: %w", err)
	}
	var selector IdentitySelector
	if err := json.Unmarshal(data, &selector); err != nil {
		return nil, fmt.Errorf("parse identity selector: %w", err)
	}
	if selector.Version != identitySelectorVersion {
		return nil, fmt.Errorf("identity selector version %d is not supported", selector.Version)
	}
	if selector.DefaultIdentity != "" {
		if err := validateAgentName(selector.DefaultIdentity); err != nil {
			return nil, fmt.Errorf("identity selector: %w", err)
		}
	}
	return &selector, nil
}

func writeIdentitySelector(alias string) error {
	if err := validateAgentName(alias); err != nil {
		return fmt.Errorf("invalid identity alias: %w", err)
	}
	path, err := identitySelectorPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(IdentitySelector{Version: identitySelectorVersion, DefaultIdentity: alias}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal identity selector: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create identity store: %w", err)
	}
	if err := writeFileAtomic(path, append(data, '\n')); err != nil {
		return fmt.Errorf("write identity selector: %w", err)
	}
	return nil
}

// resolveIdentityAlias implements the only automatic discovery mechanism.
// In particular it intentionally does not inspect a repository, Git config, or
// the legacy ~/.config/moltnet/moltnet.json document.
func resolveIdentityAlias(explicit string) (string, error) {
	alias := strings.TrimSpace(explicit)
	if alias == "" {
		alias = strings.TrimSpace(os.Getenv(activeIdentityEnv))
	}
	if alias == "" {
		selector, err := readIdentitySelector()
		if err != nil {
			return "", err
		}
		if selector != nil {
			alias = selector.DefaultIdentity
		}
	}
	if alias == "" {
		// Last resort, deliberately below the selector: this variable predates
		// the central store and is often still exported ambiently (CI images,
		// shell profiles). Ranking it above an explicitly selected identity
		// would let a stale value silently redirect credential resolution.
		alias = strings.TrimSpace(os.Getenv(legacyActiveIdentityEnv))
	}
	if alias == "" {
		return "", noActiveIdentityError()
	}
	if err := validateAgentName(alias); err != nil {
		return "", fmt.Errorf("invalid active identity: %w", err)
	}
	return alias, nil
}

// noActiveIdentityError is the error every user hits on upgrade, so it names
// the sources that were consulted and branches the remedy on whether the store
// is empty (migrate a legacy bundle) or merely unselected (pick one).
func noActiveIdentityError() error {
	selectorPath, pathErr := identitySelectorPath()
	if pathErr != nil {
		selectorPath = identitySelectorFile
	}

	var b strings.Builder
	b.WriteString("no credentials found: no active identity selected.\n")
	b.WriteString("Consulted: --credentials flag, $")
	b.WriteString(activeIdentityEnv)
	b.WriteString(", $")
	b.WriteString(legacyActiveIdentityEnv)
	b.WriteString(", and ")
	b.WriteString(selectorPath)
	b.WriteString("\n")

	aliases, listErr := listIdentityAliases()
	switch {
	case listErr == nil && len(aliases) > 0:
		b.WriteString("Available identities: ")
		b.WriteString(strings.Join(aliases, ", "))
		b.WriteString("\nSelect one with: moltnet config identity select <alias>")
	default:
		b.WriteString("No identities exist yet in the central store.\n")
		b.WriteString("If you are upgrading, migrate an existing bundle with:\n")
		b.WriteString("  moltnet config migrate --credentials <path-to-moltnet.json>\n")
		b.WriteString("Otherwise create one with: moltnet register")
	}
	return fmt.Errorf("%s", b.String())
}

func writeCentralIdentityConfig(alias string, config *CredentialsFile) (string, error) {
	path, err := identityCredentialsPath(alias)
	if err != nil {
		return "", err
	}
	if _, err := WriteConfigTo(config, path); err != nil {
		return "", err
	}
	selector, err := readIdentitySelector()
	if err != nil {
		return "", err
	}
	if selector == nil || selector.DefaultIdentity == "" {
		if err := writeIdentitySelector(alias); err != nil {
			return "", err
		}
	}
	return path, nil
}

func listIdentityAliases() ([]string, error) {
	root, err := identityStoreDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(root, "identities"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("list identities: %w", err)
	}
	aliases := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || validateAgentName(entry.Name()) != nil {
			continue
		}
		if regularFileExists(filepath.Join(root, "identities", entry.Name(), "moltnet.json")) {
			aliases = append(aliases, entry.Name())
		}
	}
	sort.Strings(aliases)
	return aliases, nil
}
