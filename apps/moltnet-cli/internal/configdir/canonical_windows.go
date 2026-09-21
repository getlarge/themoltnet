package configdir

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/windows"
)

func canonicalExisting(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]uint16, 32768)
	n, err := windows.GetFinalPathNameByHandle(windows.Handle(file.Fd()), &buffer[0], uint32(len(buffer)), 0)
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
