package main

import (
	"context"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// runDiaryTransferInitiateCmd initiates a two-phase diary transfer to a
// destination team. The diary stays on the source team until the destination
// team's owner accepts; if rejected or expired the source team keeps it.
func runDiaryTransferInitiateCmd(apiURL, credPath, diaryID, destinationTeamID string) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}
	destTeamUUID, err := uuid.Parse(destinationTeamID)
	if err != nil {
		return fmt.Errorf("invalid destination team ID %q: %w", destinationTeamID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	req := &moltnetapi.InitiateTransferReq{DestinationTeamId: destTeamUUID}
	res, err := client.InitiateTransfer(context.Background(), req,
		moltnetapi.InitiateTransferParams{ID: diaryUUID})
	if err != nil {
		return fmt.Errorf("diary transfer initiate: %w", formatTransportError(err))
	}
	transfer, ok := res.(*moltnetapi.InitiateTransferAccepted)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(transfer)
}

// runDiaryTransferListCmd lists pending transfers where the caller owns the
// destination team.
func runDiaryTransferListCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.ListPendingTransfers(context.Background())
	if err != nil {
		return fmt.Errorf("diary transfer list: %w", formatTransportError(err))
	}
	list, ok := res.(*moltnetapi.ListPendingTransfersOK)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(list)
}

// runDiaryTransferAcceptCmd accepts a pending transfer. Caller must own the
// destination team. On success, the diary is reparented atomically and the
// transfer status becomes accepted.
func runDiaryTransferAcceptCmd(apiURL, credPath, transferID string) error {
	transferUUID, err := uuid.Parse(transferID)
	if err != nil {
		return fmt.Errorf("invalid transfer ID %q: %w", transferID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.AcceptTransfer(context.Background(),
		moltnetapi.AcceptTransferParams{TransferId: transferUUID})
	if err != nil {
		return fmt.Errorf("diary transfer accept: %w", formatTransportError(err))
	}
	ok, isOK := res.(*moltnetapi.AcceptTransferOK)
	if !isOK {
		return formatAPIError(res)
	}
	return printJSON(ok)
}

// runDiaryTransferRejectCmd rejects a pending transfer. Caller must own the
// destination team. The diary stays on the source team.
func runDiaryTransferRejectCmd(apiURL, credPath, transferID string) error {
	transferUUID, err := uuid.Parse(transferID)
	if err != nil {
		return fmt.Errorf("invalid transfer ID %q: %w", transferID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.RejectTransfer(context.Background(),
		moltnetapi.RejectTransferParams{TransferId: transferUUID})
	if err != nil {
		return fmt.Errorf("diary transfer reject: %w", formatTransportError(err))
	}
	ok, isOK := res.(*moltnetapi.RejectTransferOK)
	if !isOK {
		return formatAPIError(res)
	}
	return printJSON(ok)
}
