package checklist

import (
	"context"
	stderrors "errors"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
)

func TestParseScoresAcceptsJSONString(t *testing.T) {
	t.Parallel()

	items, err := parseScores(`[{"name":"Criterion A","score":2,"max_score":4,"evidence":"ok"}]`)
	if err != nil {
		t.Fatalf("parseScores: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Name != "Criterion A" {
		t.Fatalf("unexpected item: %+v", items[0])
	}
}

func TestNormalizeScoreKey(t *testing.T) {
	t.Parallel()

	if got := normalizeScoreKey("OpenAPI spec generation mentioned"); got != "openapi_spec_generation_mentioned" {
		t.Fatalf("normalizeScoreKey() = %q", got)
	}
}

func TestRunRejectsUnknownProviderWhenNoLLM(t *testing.T) {
	t.Parallel()

	_, err := Run(context.Background(), Request{
		Provider:         "definitely-not-real",
		Model:            "model",
		WorkspaceSummary: "## file.txt\nhello",
		Criteria:         Criteria{Checklist: []Criterion{{Name: "A", MaxScore: 1}}},
	})
	if err == nil {
		t.Fatal("expected error for unknown provider")
	}
	var coded *dspyerrors.Error
	if !stderrors.As(err, &coded) {
		t.Fatal("expected dspy structured error")
	}
	if coded.Code() != dspyerrors.ProviderNotFound {
		t.Fatalf("expected ProviderNotFound, got %v", coded.Code())
	}
}

func TestRunUsesExplicitLLMWhenProvided(t *testing.T) {
	t.Parallel()

	// When LLM is set, Provider/Model should be ignored (even if invalid).
	// The run will fail at Process time (mock LLM returns wrong shape),
	// but it must NOT fail at provider init.
	_, err := Run(context.Background(), Request{
		LLM:              &stubLLM{},
		Provider:         "should-be-ignored",
		Model:            "should-be-ignored",
		WorkspaceSummary: "## file.txt\nhello",
		Criteria:         Criteria{Checklist: []Criterion{{Name: "A", MaxScore: 1}}},
	})
	// The stub LLM produces invalid output for the judge, so we expect a
	// workflow or response error — but NOT a ProviderNotFound error.
	if err == nil {
		return // unlikely but acceptable if dspy-go tolerates stub output
	}
	var coded *dspyerrors.Error
	if stderrors.As(err, &coded) && coded.Code() == dspyerrors.ProviderNotFound {
		t.Fatal("Run should not attempt provider init when LLM is set")
	}
}

// stubLLM satisfies core.LLM with minimal responses for test isolation.
type stubLLM struct{}

func (s *stubLLM) Generate(_ context.Context, _ string, _ ...core.GenerateOption) (*core.LLMResponse, error) {
	return &core.LLMResponse{Content: `{"scores_json":[],"reasoning":"stub"}`}, nil
}

func (s *stubLLM) GenerateWithJSON(_ context.Context, _ string, _ ...core.GenerateOption) (map[string]interface{}, error) {
	return map[string]interface{}{
		"scores_json": "[]",
		"reasoning":   "stub",
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
