package configmigrate

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const privateFileMode os.FileMode = 0o600

func ReadPlan(path string, limit int64) (Plan, error) {
	data, err := ReadBoundedRegularFile(path, limit)
	if err != nil {
		return Plan{}, fmt.Errorf("read migration plan: %w", err)
	}
	var plan Plan
	if err := json.Unmarshal(data, &plan); err != nil {
		return Plan{}, fmt.Errorf("parse migration plan: %w", err)
	}
	return plan, nil
}

func WritePlan(path string, plan Plan) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal migration plan: %w", err)
	}
	if err := EnsureNotSymlink(path); err != nil {
		return fmt.Errorf("write migration plan: %w", err)
	}
	if err := writeFileAtomic(path, append(data, '\n'), ".moltnet-migrations-*"); err != nil {
		return fmt.Errorf("write migration plan: %w", err)
	}
	return nil
}

func ReadOptionalBoundedRegularFile(path string, limit int64) ([]byte, error) {
	data, err := ReadBoundedRegularFile(path, limit)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return data, err
}

func ReadBoundedRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("%s must not be a symbolic link", path)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(info, openedInfo) {
		return nil, fmt.Errorf("%s changed while it was opened", path)
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s exceeds the %d-byte limit", path, limit)
	}
	return data, nil
}

func ReplaceRegularFileAtomic(path string, expected, updated []byte, limit int64, tempPattern string) error {
	current, err := ReadBoundedRegularFile(path, limit)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, expected) {
		return fmt.Errorf("%s changed before it could be replaced", path)
	}
	return writeFileAtomic(path, updated, tempPattern)
}

func EnsureNotSymlink(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s must not be a symbolic link", path)
	}
	return nil
}

func writeFileAtomic(path string, data []byte, tempPattern string) (err error) {
	if err := EnsureNotSymlink(path); err != nil {
		return err
	}
	directory := filepath.Dir(path)
	file, err := os.CreateTemp(directory, tempPattern)
	if err != nil {
		return err
	}
	tempPath := file.Name()
	defer func() {
		_ = file.Close()
		if err != nil {
			_ = os.Remove(tempPath)
		}
	}()
	if err = file.Chmod(privateFileMode); err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(tempPath, path); err != nil {
		return err
	}
	syncDirectoryBestEffort(directory)
	return nil
}

func syncDirectoryBestEffort(path string) {
	directory, err := os.Open(path)
	if err != nil {
		return
	}
	defer directory.Close()
	_ = directory.Sync()
}
