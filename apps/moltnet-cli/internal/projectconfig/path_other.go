//go:build !darwin

package projectconfig

func canonicalDiskPath(path string) (string, error) { return path, nil }
