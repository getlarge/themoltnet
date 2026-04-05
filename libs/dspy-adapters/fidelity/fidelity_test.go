package fidelity

import (
	"context"
	stderrors "errors"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
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

func TestRunUsesExplicitLLMWhenProvided(t *testing.T) {
	t.Parallel()

	// When LLM is set, Provider/Model should be ignored (even if invalid).
	_, err := Run(context.Background(), Request{
		LLM:             &stubLLM{},
		Provider:        "should-be-ignored",
		Model:           "should-be-ignored",
		SourceEntries:   "## Source\nHello",
		RenderedContent: "Hello",
	})
	// The stub LLM produces invalid output for the judge, so we expect a
	// workflow or response error — but NOT a ProviderNotFound error.
	if err == nil {
		return
	}
	var coded *dspyerrors.Error
	if stderrors.As(err, &coded) && coded.Code() == dspyerrors.ProviderNotFound {
		t.Fatal("Run should not attempt provider init when LLM is set")
	}
}

// stubLLM satisfies core.LLM with minimal responses for test isolation.
type stubLLM struct{}

func (s *stubLLM) Generate(_ context.Context, _ string, _ ...core.GenerateOption) (*core.LLMResponse, error) {
	return &core.LLMResponse{Content: `{"coverage":"0.5","grounding":"0.5","faithfulness":"0.5","reasoning":"stub"}`}, nil
}

func (s *stubLLM) GenerateWithJSON(_ context.Context, _ string, _ ...core.GenerateOption) (map[string]interface{}, error) {
	return map[string]interface{}{
		"coverage":     "0.5",
		"grounding":    "0.5",
		"faithfulness": "0.5",
		"reasoning":    "stub",
	}, nil
}

func (s *stubLLM) GenerateWithFunctions(_ context.Context, _ string, _ []map[string]interface{}, _ ...core.GenerateOption) (map[string]interface{}, error) {
	return nil, nil
}

func (s *stubLLM) CreateEmbedding(_ context.Context, _ string, _ ...core.EmbeddingOption) (*core.EmbeddingResult, error) {
	return &core.EmbeddingResult{}, nil
}

func (s *stubLLM) CreateEmbeddings(_ context.Context, _ []string, _ ...core.EmbeddingOption) (*core.BatchEmbeddingResult, error) {
	return &core.BatchEmbeddingResult{}, nil
}

func (s *stubLLM) StreamGenerate(_ context.Context, _ string, _ ...core.GenerateOption) (*core.StreamResponse, error) {
	return nil, nil
}

func (s *stubLLM) GenerateWithContent(_ context.Context, _ []core.ContentBlock, _ ...core.GenerateOption) (*core.LLMResponse, error) {
	return &core.LLMResponse{Content: "{}"}, nil
}

func (s *stubLLM) StreamGenerateWithContent(_ context.Context, _ []core.ContentBlock, _ ...core.GenerateOption) (*core.StreamResponse, error) {
	return nil, nil
}

func (s *stubLLM) ProviderName() string            { return "stub" }
func (s *stubLLM) ModelID() string                 { return "stub-model" }
func (s *stubLLM) Capabilities() []core.Capability { return nil }
