package configdir

import (
	"fmt"
	"os"
	"path/filepath"
)

// Dir is the central store root shared by credentials and project bindings.
func Dir() (string, error) {
	// Honour HOME explicitly so CLI tests and containerized deployments can
	// relocate the user-local store without changing the process user record.
	if home := os.Getenv("HOME"); home != "" {
		return filepath.Join(home, ".config", "moltnet"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}
	return filepath.Join(home, ".config", "moltnet"), nil
}
