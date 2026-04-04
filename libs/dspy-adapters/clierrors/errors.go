// Package clierrors provides shared error classification for CLI-based LLM adapters.
package clierrors

import (
	stderrors "errors"
	"fmt"
	"os/exec"
	"strings"

	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
)

// CLIAuthError indicates the CLI subprocess failed due to authentication.
type CLIAuthError struct {
	Provider string
	Detail   string
	Err      error
}

func (e *CLIAuthError) Error() string {
	return fmt.Sprintf("%s: authentication failed — %s", e.Provider, e.Detail)
}

func (e *CLIAuthError) Unwrap() error { return e.Err }

// CLIModelError indicates an unsupported or invalid model was requested.
type CLIModelError struct {
	Provider string
	Detail   string
	Err      error
}

func (e *CLIModelError) Error() string {
	return fmt.Sprintf("%s: model error — %s", e.Provider, e.Detail)
}

func (e *CLIModelError) Unwrap() error { return e.Err }

// CLIExecError indicates a generic CLI execution failure with context.
type CLIExecError struct {
	Provider string
	ExitCode int
	Stderr   string
	Stdout   string
	Err      error
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

func (e *CLIExecError) Unwrap() error { return e.Err }

// wrapDSPyError preserves the adapter-specific error while attaching a DSPy
// error code and structured fields for higher-level handlers.
func wrapDSPyError(code dspyerrors.ErrorCode, provider string, err error, stderr, stdout string) error {
	fields := dspyerrors.Fields{"provider": provider}
	var execErr *CLIExecError
	if stderrors.As(err, &execErr) && execErr.ExitCode >= 0 {
		fields["exit_code"] = execErr.ExitCode
	} else {
		var exitErr *exec.ExitError
		if stderrors.As(err, &exitErr) {
		fields["exit_code"] = exitErr.ExitCode()
		}
	}
	if strings.TrimSpace(stderr) != "" {
		fields["stderr"] = strings.TrimSpace(stderr)
	}
	if strings.TrimSpace(stdout) != "" {
		fields["stdout"] = strings.TrimSpace(stdout)
	}
	return dspyerrors.WithFields(dspyerrors.Wrap(err, code, provider+" CLI call failed"), fields)
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
			authErr := &CLIAuthError{Provider: provider, Detail: detail, Err: err}
			return wrapDSPyError(dspyerrors.ConfigurationError, provider, authErr, stderr, stdout)
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
			modelErr := &CLIModelError{Provider: provider, Detail: detail, Err: err}
			return wrapDSPyError(dspyerrors.ModelNotSupported, provider, modelErr, stderr, stdout)
		}
	}

	// Retry- and timeout-adjacent failures should preserve structured error codes.
	if strings.Contains(combined, "timed out") || strings.Contains(combined, "deadline exceeded") {
		execErr := buildExecError(provider, err, stderr, stdout)
		return wrapDSPyError(dspyerrors.Timeout, provider, execErr, stderr, stdout)
	}
	if strings.Contains(combined, "rate limit") || strings.Contains(combined, "too many requests") || strings.Contains(combined, "429") {
		execErr := buildExecError(provider, err, stderr, stdout)
		return wrapDSPyError(dspyerrors.RateLimitExceeded, provider, execErr, stderr, stdout)
	}

	execErr := buildExecError(provider, err, stderr, stdout)
	return wrapDSPyError(dspyerrors.LLMGenerationFailed, provider, execErr, stderr, stdout)
}

func buildExecError(provider string, err error, stderr, stdout string) *CLIExecError {
	exitCode := -1
	if exitErr, ok := err.(*exec.ExitError); ok {
		exitCode = exitErr.ExitCode()
	}

	return &CLIExecError{
		Provider: provider,
		ExitCode: exitCode,
		Stderr:   stderr,
		Stdout:   stdout,
		Err:      err,
	}
}
