package fidelity

import (
	"context"
	stderrors "errors"
	"testing"

	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
)

func TestParseRequiredScoreRequiresField(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{}, "coverage")
	if err == nil {
		t.Fatal("expected error for missing score field")
	}
}

func TestParseRequiredScoreRejectsNonNumeric(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": "oops"}, "coverage")
	if err == nil {
		t.Fatal("expected error for unparseable score")
	}
}

func TestParseRequiredScoreRejectsOutOfRange(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": 1.2}, "coverage")
	if err == nil {
		t.Fatal("expected out-of-range error")
	}
}

func TestParseRequiredScoreRejectsEmptyString(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": ""}, "coverage")
	if err == nil {
		t.Fatal("expected error for empty string score")
	}
}

func TestParseRequiredScoreRejectsWhitespaceString(t *testing.T) {
	t.Parallel()

	_, err := parseRequiredScore(map[string]any{"coverage": "  "}, "coverage")
	if err == nil {
		t.Fatal("expected error for whitespace-only score")
	}
}

func TestRunRejectsUnknownProvider(t *testing.T) {
	t.Parallel()

	_, err := Run(context.Background(), Request{
		Provider:        "definitely-not-real",
		Model:           "model",
		SourceEntries:   "## Source\nHello",
		RenderedContent: "Hello",
	})
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}

	var coded *dspyerrors.Error
	if !stderrors.As(err, &coded) {
		t.Fatal("expected dspy structured error")
	}
	if coded.Code() != dspyerrors.ProviderNotFound {
		t.Fatalf("expected provider not found, got %v", coded.Code())
	}
}
