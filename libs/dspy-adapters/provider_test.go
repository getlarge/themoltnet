package dspyadapters

import (
	stderrors "errors"
	"os/exec"
	"testing"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
)

func TestInitDefaultProviderRejectsUnknownProvider(t *testing.T) {
	t.Parallel()

	_, err := InitDefaultProvider("definitely-not-real", "model")
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
	if fields := coded.Fields(); fields["provider"] != "definitely-not-real" {
		t.Fatalf("expected provider field, got %#v", fields)
	}
}

func TestInitDefaultProviderSetsDefaultLLM(t *testing.T) {
	if _, err := exec.LookPath("codex"); err != nil {
		t.Skip("codex CLI not available on PATH")
	}

	original := core.GetDefaultLLM()
	defer core.SetDefaultLLM(original)

	llm, err := InitDefaultProvider("codex", "gpt-5.3-codex")
	if err != nil {
		t.Fatalf("init default provider: %v", err)
	}
	if core.GetDefaultLLM() != llm {
		t.Fatal("expected initialized llm to be installed as default")
	}
}
