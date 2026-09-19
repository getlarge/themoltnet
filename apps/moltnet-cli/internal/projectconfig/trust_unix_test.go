//go:build !windows

package projectconfig

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

type ownerInfo struct {
	os.FileInfo
	uid  uint32
	mode os.FileMode
}

func (i ownerInfo) Sys() any          { return &syscall.Stat_t{Uid: i.uid} }
func (i ownerInfo) Mode() os.FileMode { return i.mode }

func TestProjectTrustedOwners(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		uid     uint32
		mode    os.FileMode
		allowed bool
	}{
		{0, 0644, true}, {uint32(os.Getuid()), 0600, true}, {uint32(os.Getuid() + 1), 0600, false}, {0, 0664, false},
	} {
		err := validateOwner(ownerInfo{info, tc.uid, tc.mode})
		if (err == nil) != tc.allowed {
			t.Errorf("uid=%d mode=%o: %v", tc.uid, tc.mode, err)
		}
	}
}
