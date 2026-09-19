//go:build !windows

package projectconfig

import (
	"errors"
	"os"
	"syscall"
)

func validateOwner(info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || (stat.Uid != 0 && int(stat.Uid) != os.Getuid()) || info.Mode().Perm()&0022 != 0 {
		return errors.New("project config must be owned by root or the current user and not group/world writable")
	}
	return nil
}
