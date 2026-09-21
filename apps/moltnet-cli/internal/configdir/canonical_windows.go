package configdir

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
)

func canonicalExisting(path string) (string, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(name, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	buffer := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
	if err != nil {
		return "", err
	}
	if n >= uint32(len(buffer)) {
		return "", fmt.Errorf("canonical store path exceeds Windows maximum length")
	}
	result := windows.UTF16ToString(buffer[:n])
	if strings.HasPrefix(result, `\\?\UNC\`) {
		return `\\` + strings.TrimPrefix(result, `\\?\UNC\`), nil
	}
	return strings.TrimPrefix(result, `\\?\`), nil
}
