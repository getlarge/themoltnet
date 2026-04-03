// Package dspyadapters provides LLM provider initialization and common DSPy runtime helpers.
package dspyadapters

import (
	"context"
	"fmt"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/claudecode"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/codex"
)

// InitProvider creates and configures a dspy-go LLM for the given provider and model.
func InitProvider(provider, model string) (core.LLM, error) {
	var llm core.LLM
	var err error

	switch provider {
	case claudecode.ProviderName:
		llm, err = claudecode.New(claudecode.Config{
			Model: model,
		})
	case "ollama":
		ctx := context.Background()
		llm, err = core.CreateLLMFromRegistry(ctx, "", core.ModelID("ollama:"+model))
	case "anthropic":
		ctx := context.Background()
		llm, err = core.CreateLLMFromRegistry(
			ctx,
			"",
			core.ModelID("anthropic:"+model),
		)
	case "openai":
		ctx := context.Background()
		llm, err = core.CreateLLMFromRegistry(ctx, "", core.ModelID("openai:"+model))
	case codex.ProviderName:
		llm, err = codex.New(codex.Config{
			Model: model,
		})
	default:
		return nil, fmt.Errorf(
			"unknown provider: %q (available: claude-code, codex, ollama, anthropic, openai)",
			provider,
		)
	}
	if err != nil {
		return nil, err
	}
	return core.NewModelContextDecorator(llm), nil
}
