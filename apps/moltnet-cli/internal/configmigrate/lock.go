package configmigrate

import (
	"fmt"
	"os"
)

type migrationLock struct {
	file *os.File
}

func acquireLock(credentialsPath string) (*migrationLock, error) {
	lockPath := credentialsPath + ".migration.lock"
	if err := EnsureNotSymlink(lockPath); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, privateFileMode)
	if err != nil {
		return nil, err
	}
	if err := file.Chmod(privateFileMode); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := lockFile(file); err != nil {
		_ = file.Close()
		return nil, err
	}
	return &migrationLock{file: file}, nil
}

func (l *migrationLock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	unlockErr := unlockFile(l.file)
	closeErr := l.file.Close()
	if unlockErr != nil {
		return fmt.Errorf("unlock migration file: %w", unlockErr)
	}
	return closeErr
}
