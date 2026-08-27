package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type fileConformanceFixture struct {
	File struct {
		Keys []struct {
			Key    string `json:"key"`
			Valid  bool   `json:"valid"`
			Reason string `json:"reason"`
		} `json:"keys"`
		Layouts []fileLayout `json:"layouts"`
	} `json:"file"`
}

type fileLayout struct {
	Name  string `json:"name"`
	Files map[string]struct {
		Content       string `json:"content"`
		ContentRepeat *struct {
			Char  string `json:"char"`
			Count int    `json:"count"`
		} `json:"contentRepeat"`
		Mode string `json:"mode"`
	} `json:"files"`
	Dirs     []string          `json:"dirs"`
	Outside  map[string]string `json:"outside"`
	Symlinks map[string]string `json:"symlinks"`
	Key      string            `json:"key"`
	Expect   struct {
		Value *string `json:"value"`
		Error string  `json:"error"`
	} `json:"expect"`
	SkipOn []string `json:"skipOn"`
}

func loadFileConformance(t *testing.T) fileConformanceFixture {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "test-fixtures", "keyring-conformance.json"))
	if err != nil {
		t.Fatalf("read conformance fixture: %v", err)
	}
	var fixture fileConformanceFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse conformance fixture: %v", err)
	}
	if len(fixture.File.Keys) == 0 || len(fixture.File.Layouts) == 0 {
		t.Fatal("file conformance fixture is empty")
	}
	return fixture
}

func writeFixtureFile(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

func materializeLayout(t *testing.T, layout fileLayout) string {
	t.Helper()
	root := t.TempDir()
	outside := t.TempDir()
	for rel, content := range layout.Outside {
		writeFixtureFile(t, filepath.Join(outside, filepath.FromSlash(rel)), content, 0o600)
	}
	for _, rel := range layout.Dirs {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(rel)), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for rel, spec := range layout.Files {
		content := spec.Content
		if spec.ContentRepeat != nil {
			content = strings.Repeat(spec.ContentRepeat.Char, spec.ContentRepeat.Count)
		}
		mode, err := strconv.ParseUint(spec.Mode, 8, 32)
		if err != nil {
			t.Fatalf("mode %q: %v", spec.Mode, err)
		}
		writeFixtureFile(t, filepath.Join(root, filepath.FromSlash(rel)), content, os.FileMode(mode))
	}
	for link, target := range layout.Symlinks {
		linkPath := filepath.Join(root, filepath.FromSlash(link))
		if err := os.MkdirAll(filepath.Dir(linkPath), 0o700); err != nil {
			t.Fatal(err)
		}
		target = strings.ReplaceAll(target, "<outside>", outside)
		if err := os.Symlink(filepath.FromSlash(target), linkPath); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func fileErrorCode(t *testing.T, err error) FileSecretErrorCode {
	t.Helper()
	var fileErr *FileSecretError
	if !errors.As(err, &fileErr) {
		t.Fatalf("expected *FileSecretError, got %T: %v", err, err)
	}
	return fileErr.Code
}

func TestValidateFileSecretKeyMatchesCrossRuntimeConformance(t *testing.T) {
	t.Parallel()
	for _, vector := range loadFileConformance(t).File.Keys {
		err := validateFileSecretKey(vector.Key)
		if vector.Valid && err != nil {
			t.Errorf("validateFileSecretKey(%q) = %v, want nil", vector.Key, err)
		}
		if !vector.Valid && err == nil {
			t.Errorf("validateFileSecretKey(%q) = nil, want %s", vector.Key, vector.Reason)
		}
	}
}

func TestFileSecretProviderLayoutsMatchCrossRuntimeConformance(t *testing.T) {
	t.Parallel()
	goos := map[string]string{"windows": "win32", "darwin": "darwin", "linux": "linux"}[runtime.GOOS]
	for _, layout := range loadFileConformance(t).File.Layouts {
		layout := layout
		t.Run(layout.Name, func(t *testing.T) {
			t.Parallel()
			for _, skip := range layout.SkipOn {
				if skip == goos {
					t.Skip("skipped on this platform by fixture")
				}
			}
			root := materializeLayout(t, layout)
			provider := FileSecretProvider{Root: root, MaxBytes: defaultSecretMaxBytes}
			value, err := provider.Get(layout.Key)
			switch {
			case layout.Expect.Error == "not_found":
				if !errors.Is(err, ErrSecretNotFound) {
					t.Fatalf("Get(%q) error = %v, want ErrSecretNotFound", layout.Key, err)
				}
			case layout.Expect.Error != "":
				if got := fileErrorCode(t, err); string(got) != layout.Expect.Error {
					t.Fatalf("Get(%q) code = %s, want %s", layout.Key, got, layout.Expect.Error)
				}
				if strings.Contains(err.Error(), "outside-secret") {
					t.Fatalf("error leaked file contents: %v", err)
				}
			default:
				if err != nil {
					t.Fatalf("Get(%q) error = %v", layout.Key, err)
				}
				if value != *layout.Expect.Value {
					t.Fatalf("Get(%q) = %q, want %q", layout.Key, value, *layout.Expect.Value)
				}
			}
		})
	}
}

func TestFileSecretProviderIsUnavailableWithoutRoot(t *testing.T) {
	t.Parallel()
	_, err := FileSecretProvider{}.Get("k")
	if got := fileErrorCode(t, err); got != fileSecretProviderUnavailable {
		t.Fatalf("code = %s, want provider_unavailable", got)
	}
}

func TestFileSecretProviderReadOnlyByDefault(t *testing.T) {
	t.Parallel()
	provider := FileSecretProvider{Root: t.TempDir(), MaxBytes: defaultSecretMaxBytes}
	if got := fileErrorCode(t, provider.Set("k", "v")); got != fileSecretReadOnly {
		t.Fatalf("Set code = %s, want read_only", got)
	}
	if got := fileErrorCode(t, provider.Delete("k")); got != fileSecretReadOnly {
		t.Fatalf("Delete code = %s, want read_only", got)
	}
}

func TestFileSecretProviderWritesAtomicallyWhenWritable(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	provider := FileSecretProvider{Root: root, Writable: true, MaxBytes: defaultSecretMaxBytes}
	if err := provider.Set("agent-key/identity-1", "v1"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	value, err := provider.Get("agent-key/identity-1")
	if err != nil || value != "v1" {
		t.Fatalf("Get = %q, %v; want v1", value, err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(root, "agent-key", "identity-1"))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %o, want 0600", info.Mode().Perm())
		}
	}
	entries, _ := os.ReadDir(filepath.Join(root, "agent-key"))
	if len(entries) != 1 {
		t.Fatalf("expected only the secret file, got %d entries", len(entries))
	}
	if err := provider.Delete("agent-key/identity-1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := provider.Get("agent-key/identity-1"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("after delete: %v", err)
	}
	if err := provider.Delete("agent-key/identity-1"); err != nil {
		t.Fatalf("second Delete: %v", err)
	}
}

func TestFileSecretProviderRefusesWritingThroughSymlink(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	outside := t.TempDir()
	writeFixtureFile(t, filepath.Join(outside, "victim"), "keep", 0o600)
	if err := os.Symlink(filepath.Join(outside, "victim"), filepath.Join(root, "k")); err != nil {
		t.Fatal(err)
	}
	provider := FileSecretProvider{Root: root, Writable: true, MaxBytes: defaultSecretMaxBytes}
	if got := fileErrorCode(t, provider.Set("k", "x")); got != fileSecretUnsafeTarget {
		t.Fatalf("Set code = %s, want unsafe_target", got)
	}
	data, _ := os.ReadFile(filepath.Join(outside, "victim"))
	if string(data) != "keep" {
		t.Fatal("symlink target was overwritten")
	}
}

func TestNewFileSecretProviderFromEnv(t *testing.T) {
	t.Parallel()
	env := map[string]string{
		secretRootEnv:         "/run/secrets",
		secretRootWritableEnv: "1",
		secretMaxBytesEnv:     "1024",
	}
	lookup := func(name string) (string, bool) { v, ok := env[name]; return v, ok }
	got := newFileSecretProviderFromEnv(lookup)
	want := FileSecretProvider{Root: "/run/secrets", Writable: true, MaxBytes: 1024}
	if got != want {
		t.Fatalf("newFileSecretProviderFromEnv = %+v, want %+v", got, want)
	}
	empty := newFileSecretProviderFromEnv(func(string) (string, bool) { return "", false })
	if empty.Root != "" || empty.Writable || empty.MaxBytes != defaultSecretMaxBytes {
		t.Fatalf("defaults = %+v", empty)
	}
}

func TestNewSecretProviderRegistryIncludesFileProvider(t *testing.T) {
	t.Parallel()
	registry := NewSecretProviderRegistry()
	if _, ok := registry.providers[fileProviderName]; !ok {
		t.Fatal("file provider not registered")
	}
}
