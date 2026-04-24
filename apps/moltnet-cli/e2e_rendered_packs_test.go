//go:build e2e

package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func createAgentRenderedPackForVerification(
	t *testing.T,
	markdown string,
) (renderedPackID uuid.UUID, err error) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	entry1Res, err := e2eClient.CreateDiaryEntry(
		ctx,
		&moltnetapi.CreateDiaryEntryReq{
			Content: fmt.Sprintf("E2E rendered pack entry A %s", uuid.NewString()),
			Title:   moltnetapi.NewOptString("E2E A"),
		},
		moltnetapi.CreateDiaryEntryParams{DiaryId: e2eDiaryID},
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("create entry A: %w", err)
	}
	entry1, ok := entry1Res.(*moltnetapi.DiaryEntry)
	if !ok {
		return uuid.Nil, fmt.Errorf("unexpected entry A response: %T", entry1Res)
	}

	entry2Res, err := e2eClient.CreateDiaryEntry(
		ctx,
		&moltnetapi.CreateDiaryEntryReq{
			Content: fmt.Sprintf("E2E rendered pack entry B %s", uuid.NewString()),
			Title:   moltnetapi.NewOptString("E2E B"),
		},
		moltnetapi.CreateDiaryEntryParams{DiaryId: e2eDiaryID},
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("create entry B: %w", err)
	}
	entry2, ok := entry2Res.(*moltnetapi.DiaryEntry)
	if !ok {
		return uuid.Nil, fmt.Errorf("unexpected entry B response: %T", entry2Res)
	}

	customPackRes, err := e2eClient.CreateDiaryCustomPack(
		ctx,
		&moltnetapi.CreateDiaryCustomPackReq{
			PackType: moltnetapi.CreateDiaryCustomPackReqPackTypeCustom,
			Params:   moltnetapi.CreateDiaryCustomPackReqParams{},
			Entries: []moltnetapi.CreateDiaryCustomPackReqEntriesItem{
				{EntryId: entry1.ID, Rank: 1},
				{EntryId: entry2.ID, Rank: 2},
			},
			Pinned: moltnetapi.NewOptBool(true),
		},
		moltnetapi.CreateDiaryCustomPackParams{ID: e2eDiaryID},
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("create custom pack: %w", err)
	}
	customPack, ok := customPackRes.(*moltnetapi.CustomPackResult)
	if !ok {
		return uuid.Nil, fmt.Errorf(
			"unexpected custom pack response: %T",
			customPackRes,
		)
	}

	listRes, err := e2eClient.ListDiaryPacks(
		ctx,
		moltnetapi.ListDiaryPacksParams{ID: e2eDiaryID},
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("list diary packs: %w", err)
	}
	packList, ok := listRes.(*moltnetapi.ContextPackResponseList)
	if !ok {
		return uuid.Nil, fmt.Errorf("unexpected list packs response: %T", listRes)
	}

	var sourcePackID uuid.UUID
	for _, item := range packList.Items {
		if item.PackCid == customPack.PackCid {
			sourcePackID = item.ID
			break
		}
	}
	if sourcePackID == uuid.Nil {
		return uuid.Nil, fmt.Errorf(
			"source pack not found after create (cid=%s)",
			customPack.PackCid,
		)
	}

	renderRes, err := e2eClient.RenderContextPack(
		ctx,
		&moltnetapi.RenderContextPackReq{
			RenderMethod:     "agent-refined",
			RenderedMarkdown: moltnetapi.NewOptString(markdown),
			Pinned:           moltnetapi.NewOptBool(true),
		},
		moltnetapi.RenderContextPackParams{ID: sourcePackID},
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("render context pack: %w", err)
	}
	rendered, ok := renderRes.(*moltnetapi.RenderedPackResult)
	if !ok {
		return uuid.Nil, fmt.Errorf("unexpected rendered pack response: %T", renderRes)
	}

	return rendered.ID, nil
}

func TestE2E_RenderedPacksUpdateCmd(t *testing.T) {
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build CLI: %v", err)
	}
	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write creds: %v", err)
	}

	renderedPackID, err := createAgentRenderedPackForVerification(
		t,
		"# E2E update test pack\nContent for update testing.",
	)
	if err != nil {
		t.Fatalf("create rendered pack: %v", err)
	}

	t.Run("pin", func(t *testing.T) {
		stdout, stderr, err := runE2ECLI(
			binPath, credsPath,
			"rendered-packs", "update",
			"--id", renderedPackID.String(),
			"--pinned",
		)
		if err != nil {
			t.Fatalf("rendered-packs update --pinned: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"pinned":true`) && !strings.Contains(stdout, `"pinned": true`) {
			t.Errorf("expected pinned:true in output, got:\n%s", stdout)
		}
	})

	t.Run("unpin with expires-at", func(t *testing.T) {
		future := time.Now().Add(14 * 24 * time.Hour).UTC().Format(time.RFC3339)
		stdout, stderr, err := runE2ECLI(
			binPath, credsPath,
			"rendered-packs", "update",
			"--id", renderedPackID.String(),
			"--no-pinned",
			"--expires-at", future,
		)
		if err != nil {
			t.Fatalf("rendered-packs update --no-pinned: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"pinned":false`) && !strings.Contains(stdout, `"pinned": false`) {
			t.Errorf("expected pinned:false in output, got:\n%s", stdout)
		}
	})

	t.Run("update expires-at only", func(t *testing.T) {
		newFuture := time.Now().Add(30 * 24 * time.Hour).UTC().Format(time.RFC3339)
		stdout, stderr, err := runE2ECLI(
			binPath, credsPath,
			"rendered-packs", "update",
			"--id", renderedPackID.String(),
			"--expires-at", newFuture,
		)
		if err != nil {
			t.Fatalf("rendered-packs update --expires-at: err=%v\nstdout=%s\nstderr=%s", err, stdout, stderr)
		}
		if !strings.Contains(stdout, `"pinned":false`) && !strings.Contains(stdout, `"pinned": false`) {
			t.Errorf("expected pinned:false in output, got:\n%s", stdout)
		}
	})
}
