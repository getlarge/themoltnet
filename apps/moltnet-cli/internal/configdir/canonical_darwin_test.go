package configdir

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestUnreadableFallbackMountRoot(t *testing.T) {
	for _, path := range []string{"/", "/System/Volumes/Data"} {
		t.Run(path, func(t *testing.T) {
			if _, err := os.Stat(path); os.IsNotExist(err) {
				t.Skip("mount not present")
			}
			want, err := canonicalExisting(path)
			if err != nil {
				t.Fatal(err)
			}
			got, err := canonicalUnreadableLeaf(path)
			if err != nil || got != want {
				t.Fatalf("mount fallback: %q, %v; want %q", got, err, want)
			}
		})
	}
}

func TestUnreadableFallbackLabelsErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "loop")
	if err := os.Symlink(path, path); err != nil {
		t.Fatal(err)
	}
	_, err := canonicalUnreadableLeaf(path)
	var pathErr *os.PathError
	if !errors.As(err, &pathErr) || pathErr.Path != path || pathErr.Op != "getattrlist" {
		t.Fatalf("unlabelled fallback error: %v", err)
	}
}
