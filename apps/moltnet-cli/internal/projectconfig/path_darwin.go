package projectconfig

import (
	"golang.org/x/sys/unix"
	"runtime"
	"unsafe"
)

// O_EVTONLY permits path lookup through traverse-only directories. F_GETPATH
// asks the filesystem for its spelling without enumerating any ancestor.
func canonicalDiskPath(path string) (string, error) {
	fd, err := unix.Open(path, unix.O_EVTONLY|unix.O_CLOEXEC, 0)
	if err != nil {
		return "", err
	}
	defer unix.Close(fd)
	var buffer [1024]byte
	_, err = unix.FcntlInt(uintptr(fd), unix.F_GETPATH, int(uintptr(unsafe.Pointer(&buffer[0]))))
	runtime.KeepAlive(&buffer)
	if err != nil {
		return "", err
	}
	return unix.ByteSliceToString(buffer[:]), nil
}
