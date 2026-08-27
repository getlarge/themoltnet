package main

import (
	"errors"
	"fmt"
	"io"
	"os"
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
// volumes, systemd LoadCredential). The root comes from runtime configuration,
// never from moltnet.json. Read-only unless Writable; values are resolved on
// every read so orchestrator rotation needs no restart.
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

func (p FileSecretProvider) Get(key string) (string, error) {
	target, err := p.resolveExisting(key)
	if err != nil {
		return "", err
	}
	file, err := os.Open(target)
	if err != nil {
		return "", fileErr(fileSecretUnsafeTarget, key, "cannot open target")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return "", fileErr(fileSecretUnsafeTarget, key, "not a regular file")
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
	root, err := p.requireWritable(key)
	if err != nil {
		return err
	}
	if err := validateFileSecretKey(key); err != nil {
		return err
	}
	target := filepath.Join(root, filepath.FromSlash(key))
	if info, err := os.Lstat(target); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fileErr(fileSecretUnsafeTarget, key, "refusing to write through a symlink")
	}
	rootReal, err := resolveSecretRoot(root, key)
	if err != nil {
		return err
	}
	ancestor, err := filepath.EvalSymlinks(firstExistingAncestor(filepath.Dir(target)))
	if err != nil {
		return fileErr(fileSecretUnsafeTarget, key, "cannot resolve parent directory")
	}
	if err := assertInsideRoot(rootReal, ancestor, key, true); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fileErr(fileSecretUnsafeTarget, key, "cannot create parent directory")
	}
	temp, err := os.CreateTemp(filepath.Dir(target), filepath.Base(target)+".*.tmp")
	if err != nil {
		return fileErr(fileSecretUnsafeTarget, key, "cannot create temp file")
	}
	tempPath := temp.Name()
	fail := func(detail string) error {
		_ = temp.Close()
		_ = os.Remove(tempPath)
		return fileErr(fileSecretUnsafeTarget, key, detail)
	}
	if err := temp.Chmod(0o600); err != nil {
		return fail("cannot set temp file mode")
	}
	if _, err := temp.WriteString(value); err != nil {
		return fail("write failed")
	}
	if err := temp.Sync(); err != nil {
		return fail("sync failed")
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return fileErr(fileSecretUnsafeTarget, key, "close failed")
	}
	if err := os.Rename(tempPath, target); err != nil {
		_ = os.Remove(tempPath)
		return fileErr(fileSecretUnsafeTarget, key, "rename failed")
	}
	return nil
}

func (p FileSecretProvider) Delete(key string) error {
	root, err := p.requireWritable(key)
	if err != nil {
		return err
	}
	if err := validateFileSecretKey(key); err != nil {
		return err
	}
	target := filepath.Join(root, filepath.FromSlash(key))
	info, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fileErr(fileSecretUnsafeTarget, key, "cannot inspect target")
	}
	if !info.Mode().IsRegular() {
		return fileErr(fileSecretUnsafeTarget, key, "refusing to delete a non-regular file")
	}
	return os.Remove(target)
}

func (p FileSecretProvider) requireWritable(key string) (string, error) {
	if strings.TrimSpace(p.Root) == "" {
		return "", fileErr(fileSecretProviderUnavailable, key, secretRootEnv+" is not set")
	}
	if !p.Writable {
		return "", fileErr(fileSecretReadOnly, key, "set "+secretRootWritableEnv+"=1 to allow writes")
	}
	return p.Root, nil
}

// resolveExisting returns the real path of an existing, contained, safe
// regular file. Missing keys return ErrSecretNotFound.
func (p FileSecretProvider) resolveExisting(key string) (string, error) {
	if strings.TrimSpace(p.Root) == "" {
		return "", fileErr(fileSecretProviderUnavailable, key, secretRootEnv+" is not set")
	}
	if err := validateFileSecretKey(key); err != nil {
		return "", err
	}
	rootReal, err := resolveSecretRoot(p.Root, key)
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(p.Root, filepath.FromSlash(key))
	real, err := filepath.EvalSymlinks(candidate)
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("file secret %q is absent: %w", key, ErrSecretNotFound)
	}
	if err != nil {
		return "", fileErr(fileSecretUnsafeTarget, key, "cannot resolve path")
	}
	if err := assertInsideRoot(rootReal, real, key, false); err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", fileErr(fileSecretUnsafeTarget, key, "cannot inspect target")
	}
	if !info.Mode().IsRegular() {
		return "", fileErr(fileSecretUnsafeTarget, key, "not a regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o022 != 0 {
		return "", fileErr(fileSecretUnsafeTarget, key, "group or other write permission set")
	}
	return real, nil
}

func resolveSecretRoot(root, key string) (string, error) {
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fileErr(fileSecretProviderUnavailable, key, "secret root does not exist")
	}
	return rootReal, nil
}

func assertInsideRoot(rootReal, candidateReal, key string, allowRoot bool) error {
	rel, err := filepath.Rel(rootReal, candidateReal)
	if err != nil {
		return fileErr(fileSecretSymlinkEscape, key, "resolves outside the secret root")
	}
	if rel == "." {
		if allowRoot {
			return nil
		}
		return fileErr(fileSecretSymlinkEscape, key, "resolves to the secret root itself")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fileErr(fileSecretSymlinkEscape, key, "resolves outside the secret root")
	}
	return nil
}

func firstExistingAncestor(path string) string {
	for {
		if _, err := os.Lstat(path); err == nil {
			return path
		}
		parent := filepath.Dir(path)
		if parent == path {
			return path
		}
		path = parent
	}
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
