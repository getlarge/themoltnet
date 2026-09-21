package configdir

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestTraverseOnlyDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permissions")
	}
	root := filepath.Join(t.TempDir(), "CaseStore")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	actual, err := Canonical(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0111); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(root, 0700) })
	if _, err := os.ReadDir(root); err == nil {
		t.Skip("filesystem or user bypasses directory read permissions")
	}
	alias := filepath.Join(filepath.Dir(root), "casestore")
	if _, err := os.Stat(alias); os.IsNotExist(err) {
		alias = root
	}
	got, err := Canonical(filepath.Join(alias, "new"))
	if err != nil || got != filepath.Join(actual, "new") {
		t.Fatalf("traverse-only: %q, %v", got, err)
	}
}
