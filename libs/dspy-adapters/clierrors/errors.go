// Package clierrors provides shared error classification for CLI-based LLM adapters.
package clierrors

import (
	"fmt"
	"os/exec"
	"strings"
)

// CLIAuthError indicates the CLI subprocess failed due to authentication.
type CLIAuthError struct {
	Provider string
	Detail   string
}

func (e *CLIAuthError) Error() string {
	return fmt.Sprintf("%s: authentication failed — %s", e.Provider, e.Detail)
}

// CLIModelError indicates an unsupported or invalid model was requested.
type CLIModelError struct {
	Provider string
	Detail   string
}

func (e *CLIModelError) Error() string {
	return fmt.Sprintf("%s: model error — %s", e.Provider, e.Detail)
}

// CLIExecError indicates a generic CLI execution failure with context.
type CLIExecError struct {
	Provider string
	ExitCode int
	Stderr   string
	Stdout   string
}

func (e *CLIExecError) Error() string {
	msg := fmt.Sprintf("%s CLI failed (exit code %d)", e.Provider, e.ExitCode)
	stderr := strings.TrimSpace(e.Stderr)
	if stderr != "" {
		msg += "\nstderr: " + stderr
	}
	// Include first 200 chars of stdout for debugging if stderr is empty
	if stderr == "" {
		stdout := strings.TrimSpace(e.Stdout)
		if len(stdout) > 200 {
			stdout = stdout[:200] + "..."
		}
		if stdout != "" {
			msg += "\nstdout (truncated): " + stdout
		}
	}
	return msg
}

// ClassifyCLIError inspects stderr/stdout from a failed CLI subprocess and
// returns a typed error for common failure modes.
func ClassifyCLIError(provider string, err error, stderr, stdout string) error {
	combined := strings.ToLower(stderr + " " + stdout)

	// Auth failures
	authSignals := []string{
		"not logged in",
		"please run /login",
		"401 unauthorized",
		"authentication",
		"missing bearer",
		"api key",
		"oauth",
	}
	for _, signal := range authSignals {
		if strings.Contains(combined, signal) {
			detail := strings.TrimSpace(stderr)
			if detail == "" {
				detail = strings.TrimSpace(stdout)
			}
			if len(detail) > 200 {
				detail = detail[:200] + "..."
			}
			return &CLIAuthError{Provider: provider, Detail: detail}
		}
	}

	// Model errors
	modelSignals := []string{
		"model is not supported",
		"unsupported model",
		"invalid model",
		"model not found",
	}
	for _, signal := range modelSignals {
		if strings.Contains(combined, signal) {
			detail := strings.TrimSpace(stderr)
			if detail == "" {
				detail = strings.TrimSpace(stdout)
			}
			if len(detail) > 200 {
				detail = detail[:200] + "..."
			}
			return &CLIModelError{Provider: provider, Detail: detail}
		}
	}

	// Generic failure with exit code
	exitCode := -1
	if exitErr, ok := err.(*exec.ExitError); ok {
		exitCode = exitErr.ExitCode()
	}

	return &CLIExecError{
		Provider: provider,
		ExitCode: exitCode,
		Stderr:   stderr,
		Stdout:   stdout,
	}
}
