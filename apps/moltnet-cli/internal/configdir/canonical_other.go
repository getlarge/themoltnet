//go:build !darwin && !windows

package configdir

import "path/filepath"

func canonicalExisting(path string) (string, error) { return filepath.EvalSymlinks(path) }
