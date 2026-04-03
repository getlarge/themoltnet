package clierrors

import (
	stderrors "errors"
	"testing"

	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
)

func TestClassifyCLIErrorWrapsAuthAsConfigurationError(t *testing.T) {
	t.Parallel()

	err := ClassifyCLIError("claude", stderrors.New("exit status 1"), "Not logged in", "")

	var coded *dspyerrors.Error
	if !stderrors.As(err, &coded) {
		t.Fatal("expected dspy structured error")
	}
	if coded.Code() != dspyerrors.ConfigurationError {
		t.Fatalf("expected configuration error, got %v", coded.Code())
	}

	var authErr *CLIAuthError
	if !stderrors.As(err, &authErr) {
		t.Fatal("expected wrapped CLIAuthError")
	}
}

func TestClassifyCLIErrorWrapsModelAsModelNotSupported(t *testing.T) {
	t.Parallel()

	err := ClassifyCLIError("codex", stderrors.New("exit status 1"), "unsupported model", "")

	var coded *dspyerrors.Error
	if !stderrors.As(err, &coded) {
		t.Fatal("expected dspy structured error")
	}
	if coded.Code() != dspyerrors.ModelNotSupported {
		t.Fatalf("expected model not supported, got %v", coded.Code())
	}
}
