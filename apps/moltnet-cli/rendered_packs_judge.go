package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/XiaoConstantine/dspy-go/pkg/core"
	dspyadapters "github.com/getlarge/themoltnet/libs/dspy-adapters"
	"github.com/getlarge/themoltnet/libs/dspy-adapters/fidelity"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	gocid "github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
	"github.com/spf13/cobra"
)

func newRenderedPacksJudgeCmd() *cobra.Command {
	var (
		id         string
		nonce      string
		provider   string
		model      string
		rubricFile string
	)

	cmd := &cobra.Command{
		Use:   "judge",
		Short: "Run fidelity judge for a rendered pack",
		Long: `Run fidelity judge in two modes:

  Proctored (with --nonce): claim verification payload from the API,
    run the judge, and submit scores. This is the full trust workflow.

  Local (without --nonce): fetch the rendered pack and its source pack
    directly, run the judge, and print scores. No verification workflow,
    no score submission. Useful for iterating on adapters and rubrics.`,
		Example: `  # Proctored mode (claim + judge + submit)
  moltnet rendered-packs judge --id <rp-uuid> --nonce <uuid>

  # Local mode (fetch + judge, no submit)
  moltnet rendered-packs judge --id <rp-uuid>

  # Local mode with custom rubric
  moltnet rendered-packs judge --id <rp-uuid> --rubric-file rubric.md --provider anthropic`,
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			if nonce != "" {
				return runRenderedPacksJudge(
					apiURL,
					credPath,
					id,
					nonce,
					provider,
					model,
				)
			}
			return runRenderedPacksJudgeLocal(
				apiURL,
				credPath,
				id,
				rubricFile,
				provider,
				model,
			)
		},
	}
	cmd.Flags().StringVar(&id, "id", "", "Rendered pack ID (required)")
	cmd.Flags().StringVar(&nonce, "nonce", "", "Verification nonce (enables proctored mode)")
	cmd.Flags().StringVar(&rubricFile, "rubric-file", "", "Custom rubric file (local mode only, uses default if omitted)")
	cmd.Flags().StringVar(
		&provider,
		"provider",
		"claude-code",
		"LLM provider (claude-code, ollama, anthropic, openai)",
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
		return fmt.Errorf("fetch rendered pack: %w", err)
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
		return fmt.Errorf("fetch source pack: %w", err)
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

	llm, err := dspyadapters.InitProvider(providerName, modelID)
	if err != nil {
		return fmt.Errorf("provider init failed: %w", err)
	}
	core.SetDefaultLLM(llm)

	fmt.Fprintf(
		os.Stderr,
		"Running fidelity judge (local) with %s:%s...\n",
		providerName,
		modelID,
	)
	scores, err := fidelity.Judge(ctx, sourceEntriesMD, rp.Content, rubric)
	if err != nil {
		return fmt.Errorf("judge failed: %w", err)
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

func runRenderedPacksJudge(
	apiURL,
	credPath,
	id,
	nonce,
	providerName,
	modelID string,
) error {
	renderedPackID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid --id: %w", err)
	}
	nonceID, err := uuid.Parse(nonce)
	if err != nil {
		return fmt.Errorf("invalid --nonce: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return fmt.Errorf("auth failed: %w", err)
	}

	binaryCID, err := selfBinaryCID()
	if err != nil {
		return fmt.Errorf("self-hash failed: %w", err)
	}

	fmt.Fprintln(os.Stderr, "Claiming verification payload...")
	claimRes, err := client.ClaimVerification(
		ctx,
		moltnetapi.ClaimVerificationParams{ID: renderedPackID},
	)
	if err != nil {
		return fmt.Errorf("claim failed: %w", err)
	}
	claim, ok := claimRes.(*moltnetapi.ClaimVerificationResponse)
	if !ok {
		return formatAPIError(claimRes)
	}

	llm, err := dspyadapters.InitProvider(providerName, modelID)
	if err != nil {
		return fmt.Errorf("provider init failed: %w", err)
	}
	core.SetDefaultLLM(llm)

	sourceEntriesMD := buildSourceEntriesMarkdown(claim.SourceEntries)
	rubric := claim.Rubric
	if strings.TrimSpace(rubric) == "" {
		rubric = fidelity.DefaultRubric
	}

	fmt.Fprintf(
		os.Stderr,
		"Running fidelity judge with %s:%s...\n",
		providerName,
		modelID,
	)
	scores, err := fidelity.Judge(
		ctx,
		sourceEntriesMD,
		claim.RenderedContent,
		rubric,
	)
	if err != nil {
		return fmt.Errorf("judge failed: %w", err)
	}

	fmt.Fprintln(os.Stderr, "Submitting scores...")
	submitRes, err := client.SubmitVerification(
		ctx,
		&moltnetapi.SubmitVerificationReq{
			Nonce:          nonceID,
			Coverage:       scores.Coverage,
			Grounding:      scores.Grounding,
			Faithfulness:   scores.Faithfulness,
			Transcript:     scores.Reasoning,
			JudgeModel:     modelID,
			JudgeProvider:  providerName,
			JudgeBinaryCid: binaryCID,
		},
		moltnetapi.SubmitVerificationParams{ID: renderedPackID},
	)
	if err != nil {
		return fmt.Errorf("submit failed: %w", err)
	}
	submit, ok := submitRes.(*moltnetapi.SubmitVerificationResponse)
	if !ok {
		return formatAPIError(submitRes)
	}

	fmt.Printf("\nFidelity verification complete:\n")
	fmt.Printf("  Attestation ID: %s\n", submit.AttestationId)
	fmt.Printf("  Composite:      %.2f\n", submit.Composite)
	fmt.Printf("  Coverage:       %.2f\n", scores.Coverage)
	fmt.Printf("  Grounding:      %.2f\n", scores.Grounding)
	fmt.Printf("  Faithfulness:   %.2f\n", scores.Faithfulness)
	return nil
}

func buildSourceEntriesMarkdown(
	entries []moltnetapi.ClaimVerificationResponseSourceEntriesItem,
) string {
	var b strings.Builder
	for _, entry := range entries {
		title := strings.TrimSpace(entry.Title)
		if title == "" {
			title = "Untitled"
		}
		b.WriteString("## ")
		b.WriteString(title)
		b.WriteString("\n")
		b.WriteString(entry.Content)
		b.WriteString("\n\n")
	}
	return b.String()
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

func selfBinaryCID() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("cannot find executable path: %w", err)
	}

	f, err := os.Open(exe)
	if err != nil {
		return "", fmt.Errorf("cannot open executable: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("hash failed: %w", err)
	}

	mh, err := multihash.Encode(h.Sum(nil), multihash.SHA2_256)
	if err != nil {
		return "", fmt.Errorf("multihash encode failed: %w", err)
	}

	c := gocid.NewCidV1(0x55, mh) // raw codec
	encoded, err := c.StringOfBase('b')
	if err != nil {
		return "", fmt.Errorf("cid base32 encode failed: %w", err)
	}
	return encoded, nil
}
