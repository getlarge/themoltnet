package solver

import (
	"context"
	"strings"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/XiaoConstantine/dspy-go/pkg/tools"
)

func TestParseKind(t *testing.T) {
	cases := []struct {
		in      string
		want    Kind
		wantErr bool
	}{
		{"cot", KindChainOfThought, false},
		{"react", KindReAct, false},
		{"", "", true},
		{"chainofthought", "", true},
		{"COT", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ParseKind(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseKind(%q) expected error, got %v", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseKind(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("ParseKind(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestNew_RequiresLLM(t *testing.T) {
	_, err := New(Config{
		Kind:      KindChainOfThought,
		Signature: VitroSignature(),
	})
	if err == nil {
		t.Fatal("New without LLM must error")
	}
}

func TestNew_RequiresSignature(t *testing.T) {
	cases := []struct {
		name string
		sig  core.Signature
	}{
		{"empty", core.Signature{}},
		{"inputs_only", core.NewSignature(
			[]core.InputField{{Field: core.Field{Name: "x"}}},
			nil,
		)},
		{"outputs_only", core.NewSignature(
			nil,
			[]core.OutputField{{Field: core.Field{Name: "y"}}},
		)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(Config{
				Kind:      KindChainOfThought,
				Signature: tc.sig,
				LLM:       &stubLLM{},
			})
			if err == nil {
				t.Fatalf("New with %s signature must error", tc.name)
			}
		})
	}
}

func TestNew_ChainOfThoughtReturnsModule(t *testing.T) {
	m, err := New(Config{
		Kind:      KindChainOfThought,
		Signature: VitroSignature(),
		LLM:       &stubLLM{},
	})
	if err != nil {
		t.Fatalf("New(cot) unexpected error: %v", err)
	}
	if m == nil {
		t.Fatal("New(cot) returned nil module")
	}
}

func TestNew_ReActReturnsModule(t *testing.T) {
	registry := tools.NewInMemoryToolRegistry()
	m, err := New(Config{
		Kind:      KindReAct,
		Signature: VivoSignature(),
		LLM:       &stubLLM{},
		Registry:  registry,
	})
	if err != nil {
		t.Fatalf("New(react) unexpected error: %v", err)
	}
	if m == nil {
		t.Fatal("New(react) returned nil module")
	}
	if _, ok := m.(TraceProvider); !ok {
		t.Fatal("react module does not implement TraceProvider")
	}
}

func TestNew_ReActRequiresRegistry(t *testing.T) {
	_, err := New(Config{
		Kind:      KindReAct,
		Signature: VivoSignature(),
		LLM:       &stubLLM{},
	})
	if err == nil {
		t.Fatal("New(react) without registry must error")
	}
	if !strings.Contains(err.Error(), "Registry") {
		t.Errorf("expected 'Registry' in error, got: %v", err)
	}
}

// TestNew_ReActAcceptsZeroMaxIterations verifies that passing zero
// MaxIterations constructs successfully (the default is applied internally
// by New; the value cannot be observed via the public API).
func TestNew_ReActAcceptsZeroMaxIterations(t *testing.T) {
	registry := tools.NewInMemoryToolRegistry()
	m, err := New(Config{
		Kind:      KindReAct,
		Signature: VivoSignature(),
		LLM:       &stubLLM{},
		Registry:  registry,
	})
	if err != nil {
		t.Fatalf("New(react) unexpected error: %v", err)
	}
	if m == nil {
		t.Fatal("New(react) returned nil module")
	}
}

func TestNew_UnknownKind(t *testing.T) {
	_, err := New(Config{
		Kind:      Kind("bogus"),
		Signature: VitroSignature(),
		LLM:       &stubLLM{},
	})
	if err == nil {
		t.Fatal("New with unknown kind must error")
	}
}

func TestVitroSignatureFields(t *testing.T) {
	sig := VitroSignature()
	wantIn := map[string]bool{"task_markdown": true, "context_pack": true}
	wantOut := map[string]bool{"reasoning": true, "workspace_summary": true}
	if len(sig.Inputs) != len(wantIn) {
		t.Fatalf("vitro inputs: got %d want %d", len(sig.Inputs), len(wantIn))
	}
	for _, f := range sig.Inputs {
		if !wantIn[f.Name] {
			t.Errorf("unexpected vitro input %q", f.Name)
		}
	}
	for _, f := range sig.Outputs {
		if !wantOut[f.Name] {
			t.Errorf("unexpected vitro output %q", f.Name)
		}
	}
}

func TestVivoSignatureFields(t *testing.T) {
	sig := VivoSignature()
	wantIn := map[string]bool{"task_markdown": true, "context_pack": true, "repo_ref": true}
	wantOut := map[string]bool{"reasoning": true, "workspace_summary": true, "tool_trace": true}
	if len(sig.Inputs) != len(wantIn) {
		t.Fatalf("vivo inputs: got %d want %d", len(sig.Inputs), len(wantIn))
	}
	for _, f := range sig.Inputs {
		if !wantIn[f.Name] {
			t.Errorf("unexpected vivo input %q", f.Name)
		}
	}
	for _, f := range sig.Outputs {
		if !wantOut[f.Name] {
			t.Errorf("unexpected vivo output %q", f.Name)
		}
	}
}

// stubLLM satisfies core.LLM with minimal responses for test isolation.
type stubLLM struct{}

func (s *stubLLM) Generate(_ context.Context, _ string, _ ...core.GenerateOption) (*core.LLMResponse, error) {
	return &core.LLMResponse{Content: "reasoning: stub\nworkspace_summary: stub"}, nil
}

func (s *stubLLM) GenerateWithJSON(_ context.Context, _ string, _ ...core.GenerateOption) (map[string]interface{}, error) {
	return map[string]interface{}{}, nil
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
