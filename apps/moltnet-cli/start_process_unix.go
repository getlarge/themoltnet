//go:build !windows

package main

import "syscall"

func launchProcess(targetPath string, argv, env []string) error {
	return syscall.Exec(targetPath, argv, env)
}
