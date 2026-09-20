package configdir

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Dir is the central store root shared by credentials and project bindings.
func Dir() (string, error) {
	return Resolve(nil)
}

// Resolve selects an explicit root, MOLTNET_HOME, then the established default.
// A pointer distinguishes an explicitly empty root from an absent option.
func Resolve(root *string) (string, error) {
	if root != nil {
		return Canonical(*root)
	}
	if value, present := os.LookupEnv("MOLTNET_HOME"); present {
		return Canonical(value)
	}
	return defaultDir()
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
	ancestor, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	var missing []string
	for {
		_, err := os.Lstat(ancestor)
		if err != nil {
			if !os.IsNotExist(err) {
				return "", err
			}
			parent := filepath.Dir(ancestor)
			if parent == ancestor {
				return "", err
			}
			missing = append(missing, filepath.Base(ancestor))
			ancestor = parent
			continue
		}
		canonical, err := filepath.EvalSymlinks(ancestor)
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
		for i := len(missing) - 1; i >= 0; i-- {
			canonical = filepath.Join(canonical, missing[i])
		}
		return canonical, nil
	}
}

// SecretService preserves default-store keyring references and separates stores.
func SecretService(root *string) (string, error) {
	selected, err := Resolve(root)
	if err != nil {
		return "", err
	}
	selected, err = Canonical(selected)
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
		return "themolt.net", nil
	}
	return fmt.Sprintf("themolt.net/store/%x", sha256.Sum256([]byte(selected))), nil
}
