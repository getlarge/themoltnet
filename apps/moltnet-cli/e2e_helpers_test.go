//go:build e2e

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// Shared e2e test harness: builds the moltnet CLI binary once per test run,
// writes a temporary credentials file, and provides a bounded exec wrapper.
// Any //go:build e2e file in this package can reuse these helpers.

var (
	e2eCLIBinaryOnce sync.Once
	e2eCLIBinaryPath string
	e2eCLIBuildErr   error
)

// ensureE2ECLIBinary builds the moltnet CLI once for the test run and returns
// the path to the compiled binary. Subsequent calls return the cached path.
func ensureE2ECLIBinary() (string, error) {
	e2eCLIBinaryOnce.Do(func() {
		tmpDir, err := os.MkdirTemp("", "moltnet-e2e-bin-*")
		if err != nil {
			e2eCLIBuildErr = fmt.Errorf("create temp dir: %w", err)
			return
		}
		binPath := filepath.Join(tmpDir, "moltnet-e2e")
		cmd := exec.Command("go", "build", "-o", binPath, ".")
		cmd.Dir = "."
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			e2eCLIBuildErr = fmt.Errorf("go build: %w (%s)", err, stderr.String())
			return
		}
		e2eCLIBinaryPath = binPath
	})

	if e2eCLIBuildErr != nil {
		return "", e2eCLIBuildErr
	}
	return e2eCLIBinaryPath, nil
}

// writeE2ECredsFile serializes the in-memory credentials to a fresh temp
// moltnet.json that the CLI binary can read via --credentials.
func writeE2ECredsFile(base *CredentialsFile) (string, error) {
	tmpDir, err := os.MkdirTemp("", "moltnet-e2e-creds-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	path := filepath.Join(tmpDir, "moltnet.json")
	_, err = WriteConfigTo(base, path)
	if err != nil {
		return "", fmt.Errorf("write creds: %w", err)
	}
	return path, nil
}

// e2eCLIInvocationTimeout bounds a single CLI binary invocation. The outer
// CI job has a ~15min timeout, but a single hung call would starve every
// subsequent test of signal, so each call fails fast instead.
const e2eCLIInvocationTimeout = 30 * time.Second

// runE2ECLI execs the compiled moltnet binary with --api-url and --credentials
// pre-filled, bounded by e2eCLIInvocationTimeout. Returns stdout, stderr, and
// a non-nil error on non-zero exit or timeout.
func runE2ECLI(
	binPath string,
	credsPath string,
	args ...string,
) (stdout string, stderr string, runErr error) {
	ctx, cancel := context.WithTimeout(context.Background(), e2eCLIInvocationTimeout)
	defer cancel()

	fullArgs := append(
		[]string{
			"--api-url", e2eAPIURL,
			"--credentials", credsPath,
		},
		args...,
	)

	cmd := exec.CommandContext(ctx, binPath, fullArgs...)
	var outBuf bytes.Buffer
	var errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	cmd.Env = os.Environ()
	runErr = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		runErr = fmt.Errorf(
			"CLI call timed out after %s: %w",
			e2eCLIInvocationTimeout,
			runErr,
		)
	}
	return outBuf.String(), errBuf.String(), runErr
}
