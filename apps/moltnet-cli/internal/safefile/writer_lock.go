package safefile

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Shared with @moltnet/agent-config. Directory ownership never expires: a
// suspended writer must not resume after another process stole its lock.
func acquireWriterDirectory(path string, timeout time.Duration) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return "", err
	}
	lock := filepath.Join(parent, filepath.Base(absolute)) + ".writer-lock"
	deadline := time.Now().Add(timeout)
	for {
		err = os.Mkdir(lock, 0o700)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			return "", err
		}
		if !time.Now().Before(deadline) {
			return "", fmt.Errorf("config writer lock busy: %s; if a writer crashed, confirm no writer is running before removing this directory", lock)
		}
		time.Sleep(25 * time.Millisecond)
	}
	if err := os.WriteFile(filepath.Join(lock, "owner"), []byte(fmt.Sprintf("%d\n", os.Getpid())), PrivateMode); err != nil {
		_ = os.Remove(lock)
		return "", err
	}
	return lock, nil
}

func releaseWriterDirectory(path string) error {
	if path == "" {
		return nil
	}
	if err := os.Remove(filepath.Join(path, "owner")); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Remove(path)
}
