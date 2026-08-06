// Package safefile serializes cooperating writers and replaces private files
// without exposing partially written contents.
package safefile

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
	"github.com/natefinch/atomic"
)

const PrivateMode os.FileMode = 0o600

// Lock holds the cooperative lock for one file resource.
type Lock struct {
	file *flock.Flock
	path string
}

// Acquire serializes CLI writers that target path.
func Acquire(path string) (*Lock, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return nil, err
	}
	return acquire(canonical+".lock", absolute)
}

// AcquireNamed serializes access to a non-file resource, such as a provider
// credential. The lock name contains only a digest of the resource identifier.
func AcquireNamed(namespace, resource string) (*Lock, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return nil, fmt.Errorf("locate user cache: %w", err)
	}
	lockDir := filepath.Join(cacheDir, "moltnet", "locks")
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	digest := fnv.New128a()
	_, _ = digest.Write([]byte(namespace + "\x00" + resource))
	name := namespace + "-" + hex.EncodeToString(digest.Sum(nil)) + ".lock"
	return acquire(filepath.Join(lockDir, name), namespace+":"+resource)
}

func acquire(lockPath, resource string) (*Lock, error) {
	file := flock.New(
		lockPath,
		flock.SetFlag(os.O_CREATE|os.O_RDWR),
		flock.SetPermissions(PrivateMode),
	)
	if err := file.Lock(); err != nil {
		return nil, fmt.Errorf("lock %s: %w", resource, err)
	}
	lock := &Lock{file: file, path: resource}
	if err := validateLockFile(file, lockPath); err != nil {
		_ = lock.Close()
		return nil, err
	}
	return lock, nil
}

func validateLockFile(file *flock.Flock, path string) error {
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect lock file: %w", err)
	}
	if !pathInfo.Mode().IsRegular() {
		return fmt.Errorf("lock path %s is not a regular file", path)
	}
	openedInfo, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect opened lock file: %w", err)
	}
	if !os.SameFile(pathInfo, openedInfo) {
		return fmt.Errorf("lock path %s changed while it was opened", path)
	}
	if pathInfo.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("lock path %s has unsafe permissions %o", path, pathInfo.Mode().Perm())
	}
	return nil
}

// Close releases the cooperative lock.
func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	err := l.file.Close()
	l.file = nil
	return err
}

// Replace verifies the expected contents while the caller holds the resource
// lock, then atomically replaces the file.
func (l *Lock) Replace(expected, updated []byte, limit int64) error {
	if int64(len(updated)) > limit {
		return fmt.Errorf("%s replacement exceeds the %d-byte limit", l.path, limit)
	}
	current, err := ReadBoundedRegularFile(l.path, limit)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, expected) {
		return fmt.Errorf("%s changed before it could be replaced", l.path)
	}
	return writeLocked(l.path, updated)
}

// Write atomically replaces path while holding the shared CLI writer lock.
func Write(path string, data []byte) error {
	lock, err := Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	return writeLocked(lock.path, data)
}

// Replace acquires the shared CLI writer lock, compares the current contents,
// and atomically replaces path.
func Replace(path string, expected, updated []byte, limit int64) error {
	lock, err := Acquire(path)
	if err != nil {
		return err
	}
	defer lock.Close()
	return lock.Replace(expected, updated, limit)
}

func writeLocked(path string, data []byte) (err error) {
	if info, statErr := os.Lstat(path); statErr == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("%s is not a regular file", path)
		}
		if err := os.Chmod(path, PrivateMode); err != nil {
			return err
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	return atomic.WriteFile(path, bytes.NewReader(data))
}

// ReadBoundedRegularFile reads at most limit bytes from a stable regular-file
// handle and rejects lexical symlinks.
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

func canonicalPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved, nil
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return "", err
	}
	return filepath.Join(parent, filepath.Base(absolute)), nil
}
