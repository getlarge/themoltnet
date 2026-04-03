package dspyadapters

import (
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
)

func TestInitDefaultProviderRejectsUnknownProvider(t *testing.T) {
	t.Parallel()

	if _, err := InitDefaultProvider("definitely-not-real", "model"); err == nil {
		t.Fatal("expected error for unknown provider")
	}
}

func TestInitDefaultProviderSetsDefaultLLM(t *testing.T) {
	original := core.GetDefaultLLM()
	defer core.SetDefaultLLM(original)

	llm, err := InitDefaultProvider("ollama", "llama3")
	if err != nil {
		t.Fatalf("init default provider: %v", err)
	}
	if core.GetDefaultLLM() != llm {
		t.Fatal("expected initialized llm to be installed as default")
	}
}
