// Package dspyadapters provides LLM provider initialization for dspy-go.
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
	switch provider {
	case claudecode.ProviderName:
		return claudecode.New(claudecode.Config{
			Model: model,
		})
	case "ollama":
		ctx := context.Background()
		return core.CreateLLMFromRegistry(ctx, "", core.ModelID("ollama:"+model))
	case "anthropic":
		ctx := context.Background()
		return core.CreateLLMFromRegistry(
			ctx,
			"",
			core.ModelID("anthropic:"+model),
		)
	case "openai":
		ctx := context.Background()
		return core.CreateLLMFromRegistry(ctx, "", core.ModelID("openai:"+model))
	case codex.ProviderName:
		return codex.New(codex.Config{
			Model: model,
		})
	default:
		return nil, fmt.Errorf(
			"unknown provider: %q (available: claude-code, codex, ollama, anthropic, openai)",
			provider,
		)
	}
}
