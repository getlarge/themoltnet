package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

func newRenderedPacksVerifyCmd() *cobra.Command {
	var (
		id    string
		nonce string
	)

	cmd := &cobra.Command{
		Use:   "verify",
		Short: "Trigger fidelity verification for a rendered pack",
		RunE: func(cmd *cobra.Command, args []string) error {
			apiURL, _ := cmd.Flags().GetString("api-url")
			credPath, _ := cmd.Flags().GetString("credentials")
			return runRenderedPacksVerify(apiURL, credPath, id, nonce)
		},
	}
	cmd.Flags().StringVar(&id, "id", "", "Rendered pack ID (required)")
	cmd.Flags().StringVar(&nonce, "nonce", "", "Idempotency nonce (UUID, required)")
	_ = cmd.MarkFlagRequired("id")
	_ = cmd.MarkFlagRequired("nonce")
	return cmd
}

func runRenderedPacksVerify(apiURL, credPath, id, nonce string) error {
	renderedPackID, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid --id: %w", err)
	}
	nonceID, err := uuid.Parse(nonce)
	if err != nil {
		return fmt.Errorf("invalid --nonce: %w", err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return fmt.Errorf("auth failed: %w", err)
	}

	res, err := client.VerifyRenderedPack(
		context.Background(),
		&moltnetapi.VerifyRenderedPackReq{
			Nonce: nonceID,
		},
		moltnetapi.VerifyRenderedPackParams{
			ID: renderedPackID,
		},
	)
	if err != nil {
		return fmt.Errorf("verify request failed: %w", err)
	}

	success, ok := res.(*moltnetapi.VerifyRenderedPackResponse)
	if !ok {
		return formatAPIError(res)
	}

	fmt.Printf(
		"Verification created:\n  ID: %s\n  Nonce: %s\n",
		success.VerificationId,
		success.Nonce,
	)
	return nil
}
