package configdir

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// SecretServiceName is the legacy default-store keyring service.
const SecretServiceName = "themolt.net"

// ErrInvalidRoot identifies a store selection failure independently of its source.
var ErrInvalidRoot = errors.New("invalid MoltNet store root")

// Dir is the central store root shared by credentials and project bindings.
func Dir() (string, error) {
	return Resolve(nil)
}

// Selection captures the root and its provenance before lazy keyring access.
type Selection struct {
	Root        string
	source      string
	defaultRoot string
}

// Select snapshots environment, HOME and CWD, validating conflicting aliases.
func Select(root *string) (Selection, error) {
	selection := Selection{source: "explicit root"}
	selection.defaultRoot, _ = defaultDir()
	if root == nil {
		shared, hasShared := os.LookupEnv("MOLTNET_HOME")
		legacy, hasLegacy := os.LookupEnv("MOLTNET_AGENT_SERVER_ROOT")
		if hasShared && hasLegacy {
			a, err := Canonical(shared)
			if err != nil {
				return selection, fmt.Errorf("%w (MOLTNET_HOME): %w", ErrInvalidRoot, err)
			}
			b, err := Canonical(legacy)
			if err != nil {
				return selection, fmt.Errorf("%w (MOLTNET_AGENT_SERVER_ROOT): %w", ErrInvalidRoot, err)
			}
			if a != b {
				return selection, fmt.Errorf("%w: conflicting MOLTNET_HOME and MOLTNET_AGENT_SERVER_ROOT; select one store root", ErrInvalidRoot)
			}
		}
	}
	if root != nil {
		selection.Root = *root
	} else if value, present := os.LookupEnv("MOLTNET_HOME"); present {
		selection.Root, selection.source = value, "MOLTNET_HOME"
	} else if value, present := os.LookupEnv("MOLTNET_AGENT_SERVER_ROOT"); present {
		selection.Root, selection.source = value, "MOLTNET_AGENT_SERVER_ROOT"
	} else {
		selection.source = "default root"
		var err error
		selection.Root, err = defaultDir()
		if err != nil {
			return selection, fmt.Errorf("%w (%s): %w", ErrInvalidRoot, selection.source, err)
		}
	}
	if selection.source != "default root" && strings.TrimSpace(selection.Root) != "" && !filepath.IsAbs(selection.Root) {
		cwd, err := os.Getwd()
		if err != nil {
			return selection, fmt.Errorf("%w (%s): %w", ErrInvalidRoot, selection.source, err)
		}
		selection.Root = cwd + string(filepath.Separator) + selection.Root
	}
	return selection, nil
}

// Resolve preserves the lexical default; explicit selections are canonical.
func Resolve(root *string) (string, error) {
	selection, err := Select(root)
	if err != nil {
		return "", err
	}
	return selection.resolve()
}

func (s Selection) resolve() (string, error) {
	if s.source == "default root" {
		return s.Root, nil
	}
	result, err := Canonical(s.Root)
	if err != nil {
		return "", fmt.Errorf("%w (%s): %w", ErrInvalidRoot, s.source, err)
	}
	return result, nil
}

// SelectedRoot anchors explicit selections to CWD and preserves lexical defaults.
func SelectedRoot() (string, error) {
	selection, err := Select(nil)
	return selection.Root, err
}

func defaultDir() (string, error) {
	// Honour HOME explicitly so CLI tests and containerized deployments can
	// relocate the user-local store without changing the process user record.
	if home := os.Getenv("HOME"); home != "" && runtime.GOOS != "windows" {
		return filepath.Join(home, ".config", "moltnet"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, ".config", "moltnet"), nil
}

// Canonical resolves the deepest existing ancestor without creating state.
func Canonical(root string) (string, error) {
	if strings.TrimSpace(root) == "" || strings.ContainsRune(root, 0) {
		return "", fmt.Errorf("MoltNet store root must be a nonempty directory path")
	}
	absolute := root
	if !filepath.IsAbs(root) {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		absolute = cwd + string(filepath.Separator) + root
	}
	volume := filepath.VolumeName(absolute)
	current, err := canonicalExisting(volume + string(filepath.Separator))
	if err != nil {
		return "", err
	}
	for _, segment := range strings.FieldsFunc(absolute[len(volume):], func(r rune) bool { return r == '/' || (runtime.GOOS == "windows" && r == '\\') }) {
		if segment == "." {
			continue
		}
		if segment == ".." {
			current = filepath.Dir(current)
			continue
		}
		current = filepath.Join(current, segment)
		if _, err := os.Lstat(current); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", err
		}
		canonical, err := canonicalExisting(current)
		if err != nil {
			return "", err
		}
		info, err := os.Stat(canonical)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", fmt.Errorf("MoltNet store root must be a directory")
		}
		current = canonical
	}
	return current, nil
}

// SecretService preserves default-store keyring references and separates stores.
func SecretService(root *string) (string, error) {
	selection, err := Select(root)
	if err != nil {
		return "", err
	}
	return selection.SecretService()
}

// SecretService keeps the default namespace independent of directory health.
func (s Selection) SecretService() (string, error) {
	if s.source == "default root" {
		return SecretServiceName, nil
	}
	selected, err := s.resolve()
	if err != nil {
		return "", err
	}
	if s.defaultRoot != "" {
		if canonical, err := Canonical(s.defaultRoot); err == nil && selected == canonical {
			return SecretServiceName, nil
		}
	}
	return fmt.Sprintf("%s/store/%x", SecretServiceName, sha256.Sum256([]byte(selected))), nil
}

// CanonicalExisting returns the filesystem spelling of an existing path.
// Project bindings use the same platform implementation as store identity.
func CanonicalExisting(path string) (string, error) { return canonicalExisting(path) }

// CacheDir keeps the established default cache location while isolating all
// store-owned recovery artifacts, resource locks, and update metadata.
func CacheDir() (string, error) {
	_, shared := os.LookupEnv("MOLTNET_HOME")
	_, legacy := os.LookupEnv("MOLTNET_AGENT_SERVER_ROOT")
	if shared || legacy {
		root, err := Dir()
		if err != nil {
			return "", err
		}
		service, err := SecretService(nil)
		if err != nil {
			return "", err
		}
		if service != SecretServiceName {
			return filepath.Join(root, "cache"), nil
		}
	}
	root, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "moltnet"), nil
}
