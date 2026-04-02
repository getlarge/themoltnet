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
		id       string
		nonce    string
		provider string
		model    string
	)

	cmd := &cobra.Command{
		Use:   "judge",
		Short: "Run fidelity judge for a rendered pack (claim + LLM + submit)",
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runRenderedPacksJudge(
				apiURL,
				credPath,
				id,
				nonce,
				provider,
				model,
			)
		},
	}
	cmd.Flags().StringVar(&id, "id", "", "Rendered pack ID (required)")
	cmd.Flags().StringVar(&nonce, "nonce", "", "Verification nonce (required)")
	cmd.Flags().StringVar(
		&provider,
		"provider",
		"claude-code",
		"LLM provider (claude-code, ollama, anthropic, openai)",
	)
	cmd.Flags().StringVar(&model, "model", "claude-sonnet-4-6", "Model ID")
	_ = cmd.MarkFlagRequired("id")
	_ = cmd.MarkFlagRequired("nonce")
	return cmd
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
