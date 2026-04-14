package evaltools

import (
	"testing"
)

func TestNewRegistry_DefaultConfig(t *testing.T) {
	dir := t.TempDir()
	reg, err := NewRegistry(Config{WorkDir: dir})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	toolsList := reg.List()
	names := make(map[string]bool, len(toolsList))
	for _, tool := range toolsList {
		names[tool.Name()] = true
	}
	for _, want := range []string{"ls", "read", "write", "edit", "bash"} {
		if !names[want] {
			t.Errorf("missing expected tool %q; got %v", want, names)
		}
	}
}

func TestNewRegistry_EmptyWorkDirErrors(t *testing.T) {
	_, err := NewRegistry(Config{})
	if err == nil {
		t.Fatal("expected error for empty WorkDir")
	}
}

func TestNewRegistry_NonexistentWorkDirErrors(t *testing.T) {
	_, err := NewRegistry(Config{WorkDir: "/nonexistent/path/that/does/not/exist"})
	if err == nil {
		t.Fatal("expected error for nonexistent WorkDir")
	}
}

func TestNewRegistry_PassthroughEnvAccepted(t *testing.T) {
	dir := t.TempDir()
	reg, err := NewRegistry(Config{
		WorkDir:        dir,
		PassthroughEnv: []string{"CUSTOM_VAR"},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if len(reg.List()) == 0 {
		t.Fatal("expected non-empty tool list")
	}
}

func TestNewRegistry_ExtraEnvAccepted(t *testing.T) {
	dir := t.TempDir()
	reg, err := NewRegistry(Config{
		WorkDir:  dir,
		ExtraEnv: map[string]string{"NODE_ENV": "test"},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if len(reg.List()) == 0 {
		t.Fatal("expected non-empty tool list")
	}
}

func TestNewRegistry_CustomTimeoutAccepted(t *testing.T) {
	dir := t.TempDir()
	reg, err := NewRegistry(Config{
		WorkDir:        dir,
		BashTimeoutSec: 300,
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if len(reg.List()) == 0 {
		t.Fatal("expected non-empty tool list")
	}
}

func TestDevToolchainEnvKeys(t *testing.T) {
	keys := DevToolchainEnvKeys()
	if len(keys) == 0 {
		t.Fatal("expected non-empty dev toolchain env keys")
	}
	keySet := make(map[string]bool, len(keys))
	for _, k := range keys {
		keySet[k] = true
	}
	for _, want := range []string{"GOPATH", "GOROOT", "NODE_PATH", "CARGO_HOME", "VIRTUAL_ENV"} {
		if !keySet[want] {
			t.Errorf("missing expected dev toolchain key %q", want)
		}
	}
}

func TestDevToolchainEnvKeys_ReturnsCopy(t *testing.T) {
	a := DevToolchainEnvKeys()
	if len(a) == 0 {
		t.Fatal("expected non-empty slice")
	}
	original := a[0]
	a[0] = "MUTATED"
	b := DevToolchainEnvKeys()
	if b[0] == "MUTATED" {
		t.Errorf("DevToolchainEnvKeys returned shared slice; mutating caller-visible state")
	}
	if b[0] != original {
		t.Errorf("expected second call to return %q, got %q", original, b[0])
	}
}

func TestMergePassthroughEnv_DedupesAndPreservesOrder(t *testing.T) {
	// GOPATH is in devToolchainEnvKeys; supplying it again should not duplicate.
	// FOO_CUSTOM is not in the built-in list; it should be appended at the end.
	merged := mergePassthroughEnv([]string{"GOPATH", "FOO_CUSTOM", "", "  ", "GOPATH"})
	seen := 0
	gotFoo := false
	for _, k := range merged {
		if k == "GOPATH" {
			seen++
		}
		if k == "FOO_CUSTOM" {
			gotFoo = true
		}
		if k == "" {
			t.Errorf("merged list contains empty key")
		}
	}
	if seen != 1 {
		t.Errorf("expected GOPATH exactly once, got %d", seen)
	}
	if !gotFoo {
		t.Errorf("expected FOO_CUSTOM in merged list, got %v", merged)
	}
	// Built-ins come first: the first element should be GOPATH (first in devToolchainEnvKeys).
	if merged[0] != "GOPATH" {
		t.Errorf("expected built-ins first, got first=%q", merged[0])
	}
}
