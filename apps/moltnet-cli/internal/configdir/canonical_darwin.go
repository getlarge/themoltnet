package configdir

import (
	"unsafe"

	"golang.org/x/sys/unix"
)

// F_GETPATH returns the filesystem spelling, including on case-insensitive APFS.
func canonicalExisting(path string) (string, error) {
	fd, err := unix.Open(path, unix.O_EVTONLY, 0)
	if err != nil {
		return "", err
	}
	defer unix.Close(fd)
	// Darwin F_GETPATH requires a MAXPATHLEN (1024-byte) buffer.
	var buffer [1024]byte
	_, _, errno := unix.Syscall(unix.SYS_FCNTL, uintptr(fd), unix.F_GETPATH, uintptr(unsafe.Pointer(&buffer[0])))
	if errno != 0 {
		return "", errno
	}
	return unix.ByteSliceToString(buffer[:]), nil
}
