// Package dspyadapters provides LLM provider initialization and common DSPy runtime helpers.
package dspyadapters

import (
	"context"
	stderrors "errors"
	"fmt"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
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
		return nil, dspyerrors.WithFields(
			dspyerrors.New(
				dspyerrors.ProviderNotFound,
				fmt.Sprintf(
					"unknown provider: %q (available: claude-code, codex, ollama, anthropic, openai)",
					provider,
				),
			),
			dspyerrors.Fields{"provider": provider, "model": model},
		)
	}
	if err != nil {
		return nil, wrapProviderInitError(provider, model, err)
	}
	return core.NewModelContextDecorator(llm), nil
}

// InitDefaultProvider initializes a provider and installs it as the default LLM
// for downstream DSPy modules that rely on core.GetDefaultLLM().
func InitDefaultProvider(provider, model string) (core.LLM, error) {
	llm, err := InitProvider(provider, model)
	if err != nil {
		return nil, err
	}
	core.SetDefaultLLM(llm)
	return llm, nil
}

func wrapProviderInitError(provider, model string, err error) error {
	var coded *dspyerrors.Error
	if stderrors.As(err, &coded) {
		return dspyerrors.WithFields(err, dspyerrors.Fields{"provider": provider, "model": model})
	}

	return dspyerrors.WithFields(
		dspyerrors.Wrap(err, dspyerrors.ConfigurationError, "initialize DSPy provider"),
		dspyerrors.Fields{"provider": provider, "model": model},
	)
}
