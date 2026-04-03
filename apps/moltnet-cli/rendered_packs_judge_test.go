package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/getlarge/themoltnet/libs/dspy-adapters/fidelity"
	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/go-faster/jx"
	"github.com/google/uuid"
)

// ── buildSourceEntriesFromPack ──────────────────────────────────────────────

func TestBuildSourceEntriesFromPack_WithTitles(t *testing.T) {
	entries := []moltnetapi.ExpandedPackEntry{
		{
			EntryId: uuid.New(),
			Entry: moltnetapi.DiaryEntryWithCreator{
				Title:   moltnetapi.NilString{Value: "First Entry", Null: false},
				Content: "Content of the first entry.",
			},
		},
		{
			EntryId: uuid.New(),
			Entry: moltnetapi.DiaryEntryWithCreator{
				Title:   moltnetapi.NilString{Value: "Second Entry", Null: false},
				Content: "Content of the second entry.",
			},
		},
	}

	result := buildSourceEntriesFromPack(entries)

	if !strings.Contains(result, "## First Entry\n") {
		t.Error("expected '## First Entry' heading")
	}
	if !strings.Contains(result, "## Second Entry\n") {
		t.Error("expected '## Second Entry' heading")
	}
	if !strings.Contains(result, "Content of the first entry.") {
		t.Error("expected first entry content")
	}
}

func TestBuildSourceEntriesFromPack_NullTitle(t *testing.T) {
	entries := []moltnetapi.ExpandedPackEntry{
		{
			EntryId: uuid.New(),
			Entry: moltnetapi.DiaryEntryWithCreator{
				Title:   moltnetapi.NilString{Null: true},
				Content: "Some content.",
			},
		},
	}

	result := buildSourceEntriesFromPack(entries)

	if !strings.Contains(result, "## Untitled\n") {
		t.Errorf("expected 'Untitled' for null title, got: %s", result)
	}
}

func TestBuildSourceEntriesFromPack_EmptyTitle(t *testing.T) {
	entries := []moltnetapi.ExpandedPackEntry{
		{
			EntryId: uuid.New(),
			Entry: moltnetapi.DiaryEntryWithCreator{
				Title:   moltnetapi.NilString{Value: "  ", Null: false},
				Content: "Some content.",
			},
		},
	}

	result := buildSourceEntriesFromPack(entries)

	if !strings.Contains(result, "## Untitled\n") {
		t.Errorf("expected 'Untitled' for blank title, got: %s", result)
	}
}

// ── resolveRubric ───────────────────────────────────────────────────────────

func TestResolveRubric_Default(t *testing.T) {
	rubric, err := resolveRubric("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rubric != fidelity.DefaultRubric {
		t.Error("expected DefaultRubric when no file is provided")
	}
}

func TestResolveRubric_FromFile(t *testing.T) {
	tmpFile := t.TempDir() + "/rubric.md"
	if err := os.WriteFile(tmpFile, []byte("Custom rubric content"), 0644); err != nil {
		t.Fatalf("write rubric: %v", err)
	}

	rubric, err := resolveRubric(tmpFile)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rubric != "Custom rubric content" {
		t.Errorf("expected custom rubric, got: %s", rubric)
	}
}

func TestResolveRubric_EmptyFile(t *testing.T) {
	tmpFile := t.TempDir() + "/empty.md"
	if err := os.WriteFile(tmpFile, []byte("   \n  "), 0644); err != nil {
		t.Fatalf("write rubric: %v", err)
	}

	_, err := resolveRubric(tmpFile)
	if err == nil {
		t.Fatal("expected error for empty rubric file")
	}
	if !strings.Contains(err.Error(), "is empty") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestResolveRubric_MissingFile(t *testing.T) {
	_, err := resolveRubric("/nonexistent/rubric.md")
	if err == nil {
		t.Fatal("expected error for missing rubric file")
	}
	if !strings.Contains(err.Error(), "read rubric file") {
		t.Errorf("unexpected error: %v", err)
	}
}

// ── runRenderedPacksJudgeLocal validation ────────────────────────────────────

func TestRunRenderedPacksJudgeLocal_InvalidID(t *testing.T) {
	err := runRenderedPacksJudgeLocal("http://localhost", "", "not-a-uuid", "", "claude-code", "claude-sonnet-4-6")
	if err == nil {
		t.Fatal("expected error for invalid ID")
	}
	if !strings.Contains(err.Error(), "invalid --id") {
		t.Errorf("unexpected error: %v", err)
	}
}

// ── stub for local judge integration tests ──────────────────────────────────

type stubJudgeLocalHandler struct {
	moltnetapi.UnimplementedHandler
	renderedContent string
	sourceEntries   []moltnetapi.ExpandedPackEntry
}

func (h *stubJudgeLocalHandler) GetRenderedPackById(
	_ context.Context,
	params moltnetapi.GetRenderedPackByIdParams,
) (moltnetapi.GetRenderedPackByIdRes, error) {
	return &moltnetapi.RenderedPackWithContent{
		ID:           params.ID,
		PackCid:      "bafy-test",
		SourcePackId: uuid.MustParse("bb000000-0000-0000-0000-000000000001"),
		DiaryId:      uuid.MustParse("cc000000-0000-0000-0000-000000000001"),
		Content:      h.renderedContent,
		ContentHash:  "sha256:test",
		RenderMethod: "agent-refined",
		TotalTokens:  100,
	}, nil
}

func (h *stubJudgeLocalHandler) GetContextPackById(
	_ context.Context,
	params moltnetapi.GetContextPackByIdParams,
) (moltnetapi.GetContextPackByIdRes, error) {
	return &moltnetapi.ContextPackResponse{
		ID:        params.ID,
		DiaryId:   uuid.MustParse("cc000000-0000-0000-0000-000000000001"),
		CreatedBy: uuid.MustParse("dd000000-0000-0000-0000-000000000001"),
		Creator: moltnetapi.AgentIdentity{
			IdentityId:  uuid.MustParse("dd000000-0000-0000-0000-000000000001"),
			Fingerprint: "A1B2-C3D4-E5F6-A7B8",
			PublicKey:   "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		},
		PackCid:   "bafy-source",
		PackCodec: "dag-cbor",
		PackType:  moltnetapi.ContextPackResponsePackTypeCompile,
		Entries:   h.sourceEntries,
		Params:    jx.Raw(`{}`),
		Payload:   jx.Raw(`{}`),
		CreatedAt: time.Now(),
	}, nil
}

func newJudgeLocalTestServer(t *testing.T, h moltnetapi.Handler) *httptest.Server {
	t.Helper()
	apiHandler, err := moltnetapi.NewServer(h, noopSecurityHandler{})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"test","token_type":"Bearer","expires_in":3600}`))
			return
		}
		apiHandler.ServeHTTP(w, r)
	}))
	t.Cleanup(ts.Close)
	return ts
}

func TestRunRenderedPacksJudgeLocal_EmptyRenderedContent(t *testing.T) {
	h := &stubJudgeLocalHandler{renderedContent: "   "}
	ts := newJudgeLocalTestServer(t, h)
	credPath := writeRenderedPacksCreds(t, ts.URL)

	err := runRenderedPacksJudgeLocal(
		ts.URL, credPath,
		"aa000000-0000-0000-0000-000000000001",
		"", "claude-code", "claude-sonnet-4-6",
	)
	if err == nil {
		t.Fatal("expected error for empty rendered content")
	}
	if !strings.Contains(err.Error(), "empty content") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunRenderedPacksJudgeLocal_NoSourceEntries(t *testing.T) {
	h := &stubJudgeLocalHandler{
		renderedContent: "# Some rendered content",
		sourceEntries:   []moltnetapi.ExpandedPackEntry{},
	}
	ts := newJudgeLocalTestServer(t, h)
	credPath := writeRenderedPacksCreds(t, ts.URL)

	err := runRenderedPacksJudgeLocal(
		ts.URL, credPath,
		"aa000000-0000-0000-0000-000000000001",
		"", "claude-code", "claude-sonnet-4-6",
	)
	if err == nil {
		t.Fatal("expected error for empty source entries")
	}
	if !strings.Contains(err.Error(), "no entries") {
		t.Errorf("unexpected error: %v", err)
	}
}
