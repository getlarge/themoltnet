package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// ── stubs ────────────────────────────────────────────────────────────────────

type stubRenderedPacksHandler struct {
	moltnetapi.UnimplementedHandler
	listCalls        int
	listDiaryID      uuid.UUID
	listSourcePackID uuid.UUID
	listRenderMethod string
	getCalls         int
	getID            uuid.UUID
}

func (h *stubRenderedPacksHandler) ListDiaryRenderedPacks(
	_ context.Context,
	params moltnetapi.ListDiaryRenderedPacksParams,
) (moltnetapi.ListDiaryRenderedPacksRes, error) {
	h.listCalls++
	h.listDiaryID = params.ID
	if sp, ok := params.SourcePackId.Get(); ok {
		h.listSourcePackID = sp
	}
	if rm, ok := params.RenderMethod.Get(); ok {
		h.listRenderMethod = rm
	}
	return &moltnetapi.RenderedPackList{
		Items: []moltnetapi.RenderedPack{
			{
				ID:           uuid.MustParse("aa000000-0000-0000-0000-000000000001"),
				PackCid:      "bafy-rendered-1",
				SourcePackId: uuid.MustParse("bb000000-0000-0000-0000-000000000001"),
				DiaryId:      params.ID,
				ContentHash:  "sha256:abc",
				RenderMethod: "agent-refined",
				TotalTokens:  200,
				Pinned:       false,
			},
		},
		Total:  1,
		Limit:  20,
		Offset: 0,
	}, nil
}

func (h *stubRenderedPacksHandler) GetRenderedPackById(
	_ context.Context,
	params moltnetapi.GetRenderedPackByIdParams,
) (moltnetapi.GetRenderedPackByIdRes, error) {
	h.getCalls++
	h.getID = params.ID
	return &moltnetapi.RenderedPackWithContent{
		ID:           params.ID,
		PackCid:      "bafy-rendered-1",
		SourcePackId: uuid.MustParse("bb000000-0000-0000-0000-000000000001"),
		DiaryId:      uuid.MustParse("cc000000-0000-0000-0000-000000000001"),
		Content:      "# Rendered",
		ContentHash:  "sha256:abc",
		RenderMethod: "agent-refined",
		TotalTokens:  200,
		Pinned:       false,
	}, nil
}

func newRenderedPacksTestServer(t *testing.T, h *stubRenderedPacksHandler) *httptest.Server {
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

func writeRenderedPacksCreds(t *testing.T, apiURL string) string {
	t.Helper()
	path := fmt.Sprintf("%s/moltnet.json", t.TempDir())
	content := fmt.Sprintf(`{"oauth2":{"client_id":"cid","client_secret":"csec"},"endpoints":{"api":"%s","mcp":"%s/mcp"}}`, apiURL, apiURL)
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("write creds: %v", err)
	}
	return path
}

// ── list ─────────────────────────────────────────────────────────────────────

func TestRunRenderedPacksList_InvalidDiaryID(t *testing.T) {
	err := runRenderedPacksList("http://localhost", "", "not-a-uuid", 0, 0, "", "")
	if err == nil {
		t.Fatal("expected error for invalid diary ID")
	}
	if !strings.Contains(err.Error(), "invalid diary ID") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunRenderedPacksList_InvalidSourcePackID(t *testing.T) {
	h := &stubRenderedPacksHandler{}
	ts := newRenderedPacksTestServer(t, h)
	credPath := writeRenderedPacksCreds(t, ts.URL)

	err := runRenderedPacksList(ts.URL, credPath, "cc000000-0000-0000-0000-000000000001", 0, 0, "not-a-uuid", "")
	if err == nil {
		t.Fatal("expected error for invalid source pack ID")
	}
	if !strings.Contains(err.Error(), "invalid --source-pack-id") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunRenderedPacksList_PassesDiaryAndFilters(t *testing.T) {
	h := &stubRenderedPacksHandler{}
	ts := newRenderedPacksTestServer(t, h)
	credPath := writeRenderedPacksCreds(t, ts.URL)

	diaryID := "cc000000-0000-0000-0000-000000000001"
	sourcePackID := "bb000000-0000-0000-0000-000000000001"
	renderMethod := "agent-refined"

	if err := runRenderedPacksList(ts.URL, credPath, diaryID, 10, 5, sourcePackID, renderMethod); err != nil {
		t.Fatalf("runRenderedPacksList: %v", err)
	}

	if h.listCalls != 1 {
		t.Errorf("expected 1 list call, got %d", h.listCalls)
	}
	if h.listDiaryID.String() != diaryID {
		t.Errorf("diary ID mismatch: got %s want %s", h.listDiaryID, diaryID)
	}
	if h.listSourcePackID.String() != sourcePackID {
		t.Errorf("source pack ID mismatch: got %s want %s", h.listSourcePackID, sourcePackID)
	}
	if h.listRenderMethod != renderMethod {
		t.Errorf("render method mismatch: got %s want %s", h.listRenderMethod, renderMethod)
	}
}

// ── get ──────────────────────────────────────────────────────────────────────

func TestRunRenderedPacksGet_InvalidID(t *testing.T) {
	err := runRenderedPacksGet("http://localhost", "", "not-a-uuid")
	if err == nil {
		t.Fatal("expected error for invalid rendered pack ID")
	}
	if !strings.Contains(err.Error(), "invalid --id") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRunRenderedPacksGet_ReturnsPack(t *testing.T) {
	h := &stubRenderedPacksHandler{}
	ts := newRenderedPacksTestServer(t, h)
	credPath := writeRenderedPacksCreds(t, ts.URL)

	renderedPackID := "aa000000-0000-0000-0000-000000000001"
	if err := runRenderedPacksGet(ts.URL, credPath, renderedPackID); err != nil {
		t.Fatalf("runRenderedPacksGet: %v", err)
	}

	if h.getCalls != 1 {
		t.Errorf("expected 1 get call, got %d", h.getCalls)
	}
	if h.getID.String() != renderedPackID {
		t.Errorf("rendered pack ID mismatch: got %s want %s", h.getID, renderedPackID)
	}
}
