package main

import (
	"context"
	stderrors "errors"
	"fmt"
	"os"
	"strings"
	"time"

	dspyerrors "github.com/XiaoConstantine/dspy-go/pkg/errors"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/fidelity"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func newRenderedPacksJudgeCmd() *cobra.Command {
	var (
		id         string
		provider   string
		model      string
		rubricFile string
	)

	cmd := &cobra.Command{
		Use:   "judge",
		Short: "Run fidelity judge for a rendered pack",
		Long: `Fetch the rendered pack and its source pack, run the fidelity judge locally,
and print scores. No score submission — use PATCH /rendered-packs/:id with a
completed judge_pack task ID to record verification.`,
		Example: `  # Run judge with default rubric
  moltnet rendered-packs judge --id <rp-uuid>

  # Run with custom rubric file
  moltnet rendered-packs judge --id <rp-uuid> --rubric-file rubric.md --provider anthropic`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			if !cmd.Flags().Changed("model") {
				model = defaultModelForProvider(provider)
			}
			return runRenderedPacksJudgeLocal(apiURL, credPath, id, rubricFile, provider, model)
		},
	}
	cmd.Flags().StringVar(&id, "id", "", "Rendered pack ID (required)")
	cmd.Flags().StringVar(&rubricFile, "rubric-file", "", "Custom rubric file (uses default if omitted)")
	cmd.Flags().StringVar(
		&provider,
		"provider",
		"claude-code",
		"LLM provider (claude-code, codex, ollama, anthropic, openai)",
	)
	cmd.Flags().StringVar(&model, "model", "claude-sonnet-4-6", "Model ID")
	_ = cmd.MarkFlagRequired("id")
	return cmd
}

func runRenderedPacksJudgeLocal(
	apiURL,
	credPath,
	id,
	rubricFile,
	providerName,
	modelID string,
) error {
	renderedPackID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid --id: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return fmt.Errorf("auth failed: %w", err)
	}

	fmt.Fprintln(os.Stderr, "Fetching rendered pack...")
	rpRes, err := client.GetRenderedPackById(
		ctx,
		moltnetapi.GetRenderedPackByIdParams{ID: renderedPackID},
	)
	if err != nil {
		return fmt.Errorf("fetch rendered pack: %w", formatTransportError(err))
	}
	rp, ok := rpRes.(*moltnetapi.RenderedPackWithContent)
	if !ok {
		return formatAPIError(rpRes)
	}

	if strings.TrimSpace(rp.Content) == "" {
		return fmt.Errorf("rendered pack %s has empty content", renderedPackID)
	}

	fmt.Fprintf(os.Stderr, "Fetching source pack %s with entries...\n", rp.SourcePackId)
	spRes, err := client.GetContextPackById(ctx, moltnetapi.GetContextPackByIdParams{
		ID:     rp.SourcePackId,
		Expand: moltnetapi.NewOptGetContextPackByIdExpand(moltnetapi.GetContextPackByIdExpandEntries),
	})
	if err != nil {
		return fmt.Errorf("fetch source pack: %w", formatTransportError(err))
	}
	sp, ok := spRes.(*moltnetapi.ContextPackResponse)
	if !ok {
		return formatAPIError(spRes)
	}

	if len(sp.Entries) == 0 {
		return fmt.Errorf("source pack %s has no entries", rp.SourcePackId)
	}

	sourceEntriesMD := buildSourceEntriesFromPack(sp.Entries)
	rubric, err := resolveRubric(rubricFile)
	if err != nil {
		return err
	}

	fmt.Fprintf(
		os.Stderr,
		"Running fidelity judge (local) with %s:%s...\n",
		providerName,
		modelID,
	)
	scores, err := fidelity.Run(ctx, fidelity.Request{
		Provider:        providerName,
		Model:           modelID,
		SourceEntries:   sourceEntriesMD,
		RenderedContent: rp.Content,
		Rubric:          rubric,
	})
	if err != nil {
		return formatDSPyJudgeError(err)
	}

	fmt.Printf("\nFidelity scores (local, no submission):\n")
	fmt.Printf("  Composite:      %.2f\n", scores.Composite)
	fmt.Printf("  Coverage:       %.2f\n", scores.Coverage)
	fmt.Printf("  Grounding:      %.2f\n", scores.Grounding)
	fmt.Printf("  Faithfulness:   %.2f\n", scores.Faithfulness)
	if scores.Reasoning != "" {
		fmt.Printf("\nReasoning:\n%s\n", scores.Reasoning)
	}
	return nil
}

func defaultModelForProvider(provider string) string {
	switch provider {
	case "codex":
		return "gpt-5.3-codex"
	case "ollama":
		return "llama3"
	default:
		return "claude-sonnet-4-6"
	}
}

func buildSourceEntriesFromPack(entries []moltnetapi.ExpandedPackEntry) string {
	var b strings.Builder
	for _, entry := range entries {
		title := strings.TrimSpace(entry.Entry.GetTitle().Value)
		if title == "" {
			title = "Untitled"
		}
		b.WriteString("## ")
		b.WriteString(title)
		b.WriteString("\n")
		b.WriteString(entry.Entry.Content)
		b.WriteString("\n\n")
	}
	return b.String()
}

func resolveRubric(rubricFile string) (string, error) {
	if rubricFile == "" {
		return fidelity.DefaultRubric, nil
	}
	data, err := os.ReadFile(rubricFile)
	if err != nil {
		return "", fmt.Errorf("read rubric file: %w", err)
	}
	content := strings.TrimSpace(string(data))
	if content == "" {
		return "", fmt.Errorf("rubric file %q is empty", rubricFile)
	}
	return content, nil
}

func formatDSPyJudgeError(err error) error {
	var coded *dspyerrors.Error
	if !stderrors.As(err, &coded) {
		return fmt.Errorf("judge failed: %w", err)
	}

	switch coded.Code() {
	case dspyerrors.Timeout:
		return fmt.Errorf("judge timed out: %w", err)
	case dspyerrors.RateLimitExceeded:
		return fmt.Errorf("judge hit provider rate limits: %w", err)
	case dspyerrors.ProviderNotFound:
		return fmt.Errorf("judge provider is not supported: %w", err)
	case dspyerrors.ModelNotSupported:
		return fmt.Errorf("judge model is not supported: %w", err)
	case dspyerrors.ConfigurationError:
		return fmt.Errorf("judge provider is not configured correctly: %w", err)
	case dspyerrors.InvalidResponse:
		return fmt.Errorf("judge returned an invalid structured response: %w", err)
	default:
		return fmt.Errorf("judge failed: %w", err)
	}
}
