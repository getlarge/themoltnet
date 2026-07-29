package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const privateFileMode os.FileMode = 0o600

func writeFileAtomic(
	path string,
	data []byte,
	tempPattern string,
) error {
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, tempPattern)
	if err != nil {
		return err
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)

	if err := file.Chmod(privateFileMode); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}

	syncDirectoryBestEffort(dir)
	return nil
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeFileAtomic(
		path,
		append(data, '\n'),
		".gh-token-cache-*",
	)
}

func syncDirectoryBestEffort(path string) {
	dir, err := os.Open(path)
	if err != nil {
		return
	}
	defer dir.Close()
	_ = dir.Sync()
}
