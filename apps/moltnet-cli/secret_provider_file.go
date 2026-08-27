package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const (
	fileProviderName      = "file"
	secretRootEnv         = "MOLTNET_SECRET_ROOT"
	secretRootWritableEnv = "MOLTNET_SECRET_ROOT_WRITABLE"
	secretMaxBytesEnv     = "MOLTNET_SECRET_MAX_BYTES"
	defaultSecretMaxBytes = int64(65536)
)

var fileSecretKeySegment = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// FileSecretErrorCode classifies file provider failures. The set matches the
// Node SDK's FileSecretErrorCode and the shared conformance fixture.
type FileSecretErrorCode string

const (
	fileSecretProviderUnavailable FileSecretErrorCode = "provider_unavailable"
	fileSecretInvalidKey          FileSecretErrorCode = "invalid_key"
	fileSecretSymlinkEscape       FileSecretErrorCode = "symlink_escape"
	fileSecretUnsafeTarget        FileSecretErrorCode = "unsafe_target"
	fileSecretOversized           FileSecretErrorCode = "oversized"
	fileSecretReadOnly            FileSecretErrorCode = "read_only"
)

// FileSecretError names the logical key and a failure class; it never
// carries file contents.
type FileSecretError struct {
	Code   FileSecretErrorCode
	Key    string
	Detail string
}

func (e *FileSecretError) Error() string {
	return fmt.Sprintf("file secret %q: %s (%s)", e.Key, e.Detail, e.Code)
}

func fileErr(code FileSecretErrorCode, key, detail string) error {
	return &FileSecretError{Code: code, Key: key, Detail: detail}
}

func validateFileSecretKey(key string) error {
	switch {
	case key == "":
		return fileErr(fileSecretInvalidKey, key, "key is empty")
	case strings.ContainsRune(key, 0):
		return fileErr(fileSecretInvalidKey, key, "key contains NUL")
	case strings.HasPrefix(key, "/"), strings.HasPrefix(key, "\\"), hasDriveLetter(key):
		return fileErr(fileSecretInvalidKey, key, "key must be relative")
	}
	for _, segment := range strings.Split(key, "/") {
		switch {
		case segment == "":
			return fileErr(fileSecretInvalidKey, key, "key has an empty segment")
		case segment == "." || segment == "..":
			return fileErr(fileSecretInvalidKey, key, "key must not traverse")
		case !fileSecretKeySegment.MatchString(segment):
			return fileErr(fileSecretInvalidKey, key, "key segments must match [A-Za-z0-9._-]")
		}
	}
	return nil
}

func hasDriveLetter(key string) bool {
	if len(key) < 2 || key[1] != ':' {
		return false
	}
	c := key[0]
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

// FileSecretProvider resolves logical keys beneath one trusted directory that
// an orchestrator projects secrets into (Docker secrets, Kubernetes projected
// volumes, systemd LoadCredential). The root is absolute, comes from runtime
// configuration, never from moltnet.json, and is read-only unless Writable.
//
// Every filesystem operation goes through os.Root, so symlinks are followed
// only while they stay inside the root and a link that escapes is rejected
// by the rooted lookup itself rather than by a separate check that a
// concurrent rename could invalidate. Values are resolved on every read.
type FileSecretProvider struct {
	Root     string
	Writable bool
	MaxBytes int64
}

func newFileSecretProviderFromEnv(lookup func(string) (string, bool)) FileSecretProvider {
	provider := FileSecretProvider{MaxBytes: defaultSecretMaxBytes}
	if root, ok := lookup(secretRootEnv); ok {
		provider.Root = strings.TrimSpace(root)
	}
	if writable, ok := lookup(secretRootWritableEnv); ok && strings.TrimSpace(writable) == "1" {
		provider.Writable = true
	}
	if raw, ok := lookup(secretMaxBytesEnv); ok {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && parsed > 0 {
			provider.MaxBytes = parsed
		}
	}
	return provider
}

func (p FileSecretProvider) maxBytes() int64 {
	if p.MaxBytes > 0 {
		return p.MaxBytes
	}
	return defaultSecretMaxBytes
}

// openRoot validates the configured root and opens it as a rooted handle.
func (p FileSecretProvider) openRoot(key string) (*os.Root, error) {
	root := strings.TrimSpace(p.Root)
	if root == "" {
		return nil, fileErr(fileSecretProviderUnavailable, key, secretRootEnv+" is not set")
	}
	if !filepath.IsAbs(root) {
		return nil, fileErr(fileSecretProviderUnavailable, key, secretRootEnv+" must be an absolute path")
	}
	handle, err := os.OpenRoot(root)
	if err != nil {
		return nil, fileErr(fileSecretProviderUnavailable, key, "secret root does not exist or is not a directory")
	}
	return handle, nil
}

// rootedError maps an os.Root failure onto the provider vocabulary without
// leaking the underlying path.
func rootedError(key string, err error, detail string) error {
	if strings.Contains(err.Error(), "escapes from parent") {
		return fileErr(fileSecretSymlinkEscape, key, "resolves outside the secret root")
	}
	return fileErr(fileSecretUnsafeTarget, key, detail)
}

func (p FileSecretProvider) Get(key string) (string, error) {
	if err := validateFileSecretKey(key); err != nil {
		return "", err
	}
	root, err := p.openRoot(key)
	if err != nil {
		return "", err
	}
	defer root.Close()
	rel := filepath.FromSlash(key)
	file, err := root.Open(rel)
	if errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("file secret %q is absent: %w", key, ErrSecretNotFound)
	}
	if err != nil {
		return "", rootedError(key, err, "cannot open target")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", fileErr(fileSecretUnsafeTarget, key, "cannot inspect target")
	}
	if !info.Mode().IsRegular() {
		return "", fileErr(fileSecretUnsafeTarget, key, "not a regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o022 != 0 {
		return "", fileErr(fileSecretUnsafeTarget, key, "group or other write permission set")
	}
	limit := p.maxBytes()
	if info.Size() > limit {
		return "", fileErr(fileSecretOversized, key, fmt.Sprintf("exceeds %d bytes", limit))
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return "", fileErr(fileSecretUnsafeTarget, key, "read failed")
	}
	if int64(len(data)) > limit {
		return "", fileErr(fileSecretOversized, key, fmt.Sprintf("exceeds %d bytes", limit))
	}
	return stripOneNewline(string(data)), nil
}

func (p FileSecretProvider) Set(key, value string) error {
	if err := validateFileSecretKey(key); err != nil {
		return err
	}
	if err := p.requireWritable(key); err != nil {
		return err
	}
	root, err := p.openRoot(key)
	if err != nil {
		return err
	}
	defer root.Close()
	rel := filepath.FromSlash(key)
	if info, err := root.Lstat(rel); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fileErr(fileSecretUnsafeTarget, key, "refusing to write through a symlink")
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return rootedError(key, err, "cannot inspect target")
	}
	dir := path.Dir(key)
	if dir != "." {
		if err := root.MkdirAll(filepath.FromSlash(dir), 0o700); err != nil {
			return rootedError(key, err, "cannot create parent directory")
		}
	}
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		return fileErr(fileSecretUnsafeTarget, key, "cannot generate temp name")
	}
	tempRel := rel + "." + hex.EncodeToString(suffix) + ".tmp"
	temp, err := root.OpenFile(tempRel, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return rootedError(key, err, "cannot create temp file")
	}
	fail := func(detail string) error {
		_ = temp.Close()
		_ = root.Remove(tempRel)
		return fileErr(fileSecretUnsafeTarget, key, detail)
	}
	if _, err := temp.WriteString(value); err != nil {
		return fail("write failed")
	}
	if err := temp.Sync(); err != nil {
		return fail("sync failed")
	}
	if err := temp.Close(); err != nil {
		_ = root.Remove(tempRel)
		return fileErr(fileSecretUnsafeTarget, key, "close failed")
	}
	if err := root.Rename(tempRel, rel); err != nil {
		_ = root.Remove(tempRel)
		return rootedError(key, err, "rename failed")
	}
	return nil
}

func (p FileSecretProvider) Delete(key string) error {
	if err := validateFileSecretKey(key); err != nil {
		return err
	}
	if err := p.requireWritable(key); err != nil {
		return err
	}
	root, err := p.openRoot(key)
	if err != nil {
		return err
	}
	defer root.Close()
	rel := filepath.FromSlash(key)
	info, err := root.Lstat(rel)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return rootedError(key, err, "cannot inspect target")
	}
	if !info.Mode().IsRegular() {
		return fileErr(fileSecretUnsafeTarget, key, "refusing to delete a non-regular file")
	}
	if err := root.Remove(rel); err != nil {
		return rootedError(key, err, "delete failed")
	}
	return nil
}

func (p FileSecretProvider) requireWritable(key string) error {
	if strings.TrimSpace(p.Root) == "" {
		return fileErr(fileSecretProviderUnavailable, key, secretRootEnv+" is not set")
	}
	if !p.Writable {
		return fileErr(fileSecretReadOnly, key, "set "+secretRootWritableEnv+"=1 to allow writes")
	}
	return nil
}

func stripOneNewline(value string) string {
	if strings.HasSuffix(value, "\r\n") {
		return value[:len(value)-2]
	}
	if strings.HasSuffix(value, "\n") {
		return value[:len(value)-1]
	}
	return value
}
