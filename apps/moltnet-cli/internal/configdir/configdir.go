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

// Resolve selects an explicit root, MOLTNET_HOME, then the established default.
// A pointer distinguishes an explicitly empty root from an absent option.
func Resolve(root *string) (string, error) {
	source := "explicit root"
	var selected string
	if root != nil {
		selected = *root
	} else {
		source = "default root"
		if _, present := os.LookupEnv("MOLTNET_HOME"); present {
			source = "MOLTNET_HOME"
		}
		var err error
		selected, err = SelectedRoot()
		if err != nil {
			return "", fmt.Errorf("%w (%s): %w", ErrInvalidRoot, source, err)
		}
	}
	result, err := Canonical(selected)
	if err != nil {
		return "", fmt.Errorf("%w (%s): %w", ErrInvalidRoot, source, err)
	}
	return result, nil
}

// SelectedRoot snapshots the environment/default selection without filesystem
// access. Relative roots are anchored to the current directory without cleaning
// parent segments, which must be evaluated after symlinks.
func SelectedRoot() (string, error) {
	root, present := os.LookupEnv("MOLTNET_HOME")
	if !present {
		var err error
		root, err = defaultDir()
		if err != nil {
			return "", err
		}
	}
	if strings.TrimSpace(root) == "" || filepath.IsAbs(root) {
		return root, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return cwd + string(filepath.Separator) + root, nil
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
	current := volume + string(filepath.Separator)
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
	selected, err := Resolve(root)
	if err != nil {
		return "", err
	}
	defaultRoot, err := defaultDir()
	if err != nil {
		return "", err
	}
	defaultRoot, err = Canonical(defaultRoot)
	if err != nil {
		return "", err
	}
	if selected == defaultRoot {
		return SecretServiceName, nil
	}
	return fmt.Sprintf("%s/store/%x", SecretServiceName, sha256.Sum256([]byte(selected))), nil
}
