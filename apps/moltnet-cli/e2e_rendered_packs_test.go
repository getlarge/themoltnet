//go:build e2e

package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func parseVerificationIDFromOutput(out string) string {
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "ID: ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "ID: "))
		}
	}
	return ""
}

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

func TestE2E_RenderedPacksVerifyCmd(t *testing.T) {
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build e2e cli binary: %v", err)
	}

	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write e2e creds file: %v", err)
	}

	renderedPackID, err := createAgentRenderedPackForVerification(
		t,
		"# E2E Judge Input\n\nThis is an agent-refined rendered pack.",
	)
	if err != nil {
		t.Fatalf("create rendered pack fixture: %v", err)
	}
	nonce := uuid.New()

	stdout, stderr, err := runE2ECLI(
		binPath,
		credsPath,
		"rendered-packs",
		"verify",
		"--id",
		renderedPackID.String(),
		"--nonce",
		nonce.String(),
	)
	if err != nil {
		t.Fatalf("rendered-packs verify failed: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}

	if !strings.Contains(stdout, "Verification created:") {
		t.Fatalf("expected verificationId in output, got stdout:\n%s\nstderr:\n%s", stdout, stderr)
	}
	if !strings.Contains(stdout, nonce.String()) {
		t.Fatalf("expected nonce in output, got stdout:\n%s\nstderr:\n%s", stdout, stderr)
	}
}

func TestE2E_RenderedPacksJudgeCmd(t *testing.T) {
	if os.Getenv("MOLTNET_E2E_RUN_JUDGE") != "1" {
		t.Skip("set MOLTNET_E2E_RUN_JUDGE=1 to run live judge e2e")
	}

	provider := os.Getenv("MOLTNET_E2E_JUDGE_PROVIDER")
	if provider == "" {
		provider = "claude-code"
	}
	model := os.Getenv("MOLTNET_E2E_JUDGE_MODEL")
	if model == "" {
		model = "claude-sonnet-4-6"
	}

	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build e2e cli binary: %v", err)
	}
	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write e2e creds file: %v", err)
	}

	renderedPackID, err := createAgentRenderedPackForVerification(
		t,
		"# E2E Judge Input\n\nGrounded summary of two entries for fidelity checking.",
	)
	if err != nil {
		t.Fatalf("create rendered pack fixture: %v", err)
	}
	nonce := uuid.New()

	verifyStdout, verifyStderr, err := runE2ECLI(
		binPath,
		credsPath,
		"rendered-packs",
		"verify",
		"--id",
		renderedPackID.String(),
		"--nonce",
		nonce.String(),
	)
	if err != nil {
		t.Fatalf("verify failed: %v\nstdout:\n%s\nstderr:\n%s", err, verifyStdout, verifyStderr)
	}

	judgeStdout, judgeStderr, err := runE2ECLI(
		binPath,
		credsPath,
		"rendered-packs",
		"judge",
		"--id",
		renderedPackID.String(),
		"--nonce",
		nonce.String(),
		"--provider",
		provider,
		"--model",
		model,
	)
	if err != nil {
		t.Fatalf("judge failed: %v\nstdout:\n%s\nstderr:\n%s", err, judgeStdout, judgeStderr)
	}

	if !strings.Contains(judgeStdout, "Fidelity verification complete") {
		t.Fatalf("expected completion output, got stdout:\n%s\nstderr:\n%s", judgeStdout, judgeStderr)
	}
	if !strings.Contains(judgeStdout, "Attestation ID:") {
		t.Fatalf("expected attestation id in output, got stdout:\n%s\nstderr:\n%s", judgeStdout, judgeStderr)
	}
}

func TestE2E_RenderedPacksVerifyCmd_IdempotentNonce(t *testing.T) {
	binPath, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build e2e cli binary: %v", err)
	}
	credsPath, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write e2e creds file: %v", err)
	}

	renderedPackID, err := createAgentRenderedPackForVerification(
		t,
		"# E2E Verify JSON\n\nSchema conformance check.",
	)
	if err != nil {
		t.Fatalf("create rendered pack fixture: %v", err)
	}
	nonce := uuid.New()

	stdout1, stderr1, err := runE2ECLI(
		binPath,
		credsPath,
		"rendered-packs",
		"verify",
		"--id",
		renderedPackID.String(),
		"--nonce",
		nonce.String(),
	)
	if err != nil {
		t.Fatalf("first verify failed: %v\nstdout:\n%s\nstderr:\n%s", err, stdout1, stderr1)
	}

	stdout2, stderr2, err := runE2ECLI(
		binPath,
		credsPath,
		"rendered-packs",
		"verify",
		"--id",
		renderedPackID.String(),
		"--nonce",
		nonce.String(),
	)
	if err != nil {
		t.Fatalf("second verify failed: %v\nstdout:\n%s\nstderr:\n%s", err, stdout2, stderr2)
	}

	id1 := parseVerificationIDFromOutput(stdout1)
	id2 := parseVerificationIDFromOutput(stdout2)
	if id1 == "" || id2 == "" {
		t.Fatalf("unable to parse IDs from output\nfirst:\n%s\nsecond:\n%s", stdout1, stdout2)
	}
	if id1 != id2 {
		t.Fatalf("expected idempotent verification ID, got %s then %s", id1, id2)
	}
}
