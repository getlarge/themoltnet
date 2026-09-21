package configdir

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/unix"
)

// F_GETPATH asks the filesystem for its spelling without listing ancestors.
// Pointer conversions stay in raw syscall arguments so stack relocation cannot
// turn an integer argument into a stale pointer.
func canonicalExisting(path string) (string, error) {
	fd, err := unix.Open(path, unix.O_EVTONLY|unix.O_CLOEXEC, 0)
	if err != nil {
		if err == unix.EACCES || err == unix.EPERM {
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return "", err
			}
			return canonicalUnreadableLeaf(resolved)
		}
		return "", &os.PathError{Op: "open canonical directory", Path: path, Err: err}
	}
	defer unix.Close(fd)
	var buffer [unix.PathMax]byte
	_, _, errno := unix.Syscall(unix.SYS_FCNTL, uintptr(fd), unix.F_GETPATH, uintptr(unsafe.Pointer(&buffer[0])))
	if errno != 0 {
		return "", &os.PathError{Op: "F_GETPATH", Path: path, Err: errno}
	}
	return unix.ByteSliceToString(buffer[:]), nil
}

// getattrlist can read the leaf's stored name without read/search permission on
// the leaf itself. Resolve the parent separately, including traverse-only ones.
func canonicalUnreadableLeaf(path string) (string, error) {
	parent := filepath.Dir(path)
	if parent == path {
		return "", &os.PathError{Op: "canonical directory", Path: path, Err: unix.EACCES}
	}
	canonicalParent, err := canonicalExisting(parent)
	if err != nil {
		return "", err
	}
	name, err := unix.BytePtrFromString(path)
	if err != nil {
		return "", err
	}
	attrs := unix.Attrlist{Bitmapcount: 5, Commonattr: unix.ATTR_CMN_NAME}
	var buffer [unix.PathMax + 16]byte
	_, _, errno := unix.Syscall6(unix.SYS_GETATTRLIST, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&attrs)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0, 0)
	if errno != 0 {
		return "", &os.PathError{Op: "getattrlist", Path: path, Err: errno}
	}
	// uint32 size, then attrreference_t { int32 offset; uint32 length }.
	size := int(binary.LittleEndian.Uint32(buffer[:4]))
	start := 4 + int(int32(binary.LittleEndian.Uint32(buffer[4:8])))
	length := int(binary.LittleEndian.Uint32(buffer[8:12]))
	if size > len(buffer) || start < 12 || length < 2 || start > size-length {
		return "", fmt.Errorf("%s: invalid canonical-name attribute", path)
	}
	leaf := unix.ByteSliceToString(buffer[start : start+length])
	if filepath.Base(leaf) != leaf {
		return "", fmt.Errorf("%s: invalid canonical leaf", path)
	}
	return filepath.Join(canonicalParent, leaf), nil
}
