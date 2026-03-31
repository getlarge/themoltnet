package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

type stubRenderPackHandler struct {
	moltnetapi.UnimplementedHandler
	previewCalls            int
	persistCalls            int
	previewIncludedMarkdown bool
	persistIncludedMarkdown bool
	previewMarkdown         string
	persistMarkdown         string
}

func (h *stubRenderPackHandler) RenderContextPack(_ context.Context, req *moltnetapi.RenderContextPackReq, params moltnetapi.RenderContextPackParams) (moltnetapi.RenderContextPackRes, error) {
	if markdown, ok := req.RenderedMarkdown.Get(); ok {
		h.persistIncludedMarkdown = true
		h.persistMarkdown = markdown
	}

	h.persistCalls++
	return &moltnetapi.RenderedPackResult{
		ContentHash:      "bafkreiresult",
		DiaryId:          uuid.MustParse("00000000-0000-0000-0000-000000000002"),
		ID:               uuid.MustParse("00000000-0000-0000-0000-000000000003"),
		PackCid:          "bafy-rendered",
		Pinned:           false,
		RenderedMarkdown: "# Server Markdown\n",
		RenderMethod:     req.RenderMethod,
		SourcePackCid:    "bafy-source",
		SourcePackId:     params.ID,
		TotalTokens:      3,
	}, nil
}

func (h *stubRenderPackHandler) PreviewRenderedPack(_ context.Context, req *moltnetapi.PreviewRenderedPackReq, params moltnetapi.PreviewRenderedPackParams) (moltnetapi.PreviewRenderedPackRes, error) {
	if markdown, ok := req.RenderedMarkdown.Get(); ok {
		h.previewIncludedMarkdown = true
		h.previewMarkdown = markdown
	}

	h.previewCalls++
	return &moltnetapi.RenderedPackPreview{
		RenderMethod:     req.RenderMethod,
		RenderedMarkdown: "# Server Markdown\n",
		SourcePackCid:    "bafy-source",
		SourcePackId:     params.ID,
		TotalTokens:      3,
	}, nil
}

func TestRunServerPackRenderCmd_WritesMarkdownToOutOnPersist(t *testing.T) {
	t.Parallel()

	packID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	handler := &stubRenderPackHandler{}
	_, _, client := newTestServer(t, handler)
	out := filepath.Join(t.TempDir(), "rendered.md")

	if err := runServerPackRenderCmd(
		client,
		packID,
		"server:pack-to-docs-v1",
		false,
		nil,
		out,
	); err != nil {
		t.Fatalf("runServerPackRenderCmd() error: %v", err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", out, err)
	}

	if string(got) != "# Server Markdown\n" {
		t.Fatalf("expected markdown output, got %q", string(got))
	}
	if handler.persistCalls != 1 {
		t.Fatalf("expected one persist call, got %d", handler.persistCalls)
	}
	if handler.persistIncludedMarkdown {
		t.Fatal("persist request unexpectedly included renderedMarkdown")
	}
	if handler.previewCalls != 0 {
		t.Fatalf("expected no preview calls, got %d", handler.previewCalls)
	}
}

func TestRunServerPackRenderCmd_WritesMarkdownToOutOnPreview(t *testing.T) {
	t.Parallel()

	packID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	handler := &stubRenderPackHandler{}
	_, _, client := newTestServer(t, handler)
	out := filepath.Join(t.TempDir(), "preview.md")

	if err := runServerPackRenderCmd(
		client,
		packID,
		"server:pack-to-docs-v1",
		true,
		nil,
		out,
	); err != nil {
		t.Fatalf("runServerPackRenderCmd() error: %v", err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", out, err)
	}

	if string(got) != "# Server Markdown\n" {
		t.Fatalf("expected markdown output, got %q", string(got))
	}
	if handler.previewCalls != 1 {
		t.Fatalf("expected one preview call, got %d", handler.previewCalls)
	}
	if handler.persistCalls != 0 {
		t.Fatalf("expected no persist calls, got %d", handler.persistCalls)
	}
	if handler.previewIncludedMarkdown {
		t.Fatal("preview request unexpectedly included renderedMarkdown")
	}
}

func TestResolvePackRenderMarkdown_ReadsFile(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "rendered.md")
	want := "# Caller Markdown\n"
	if err := os.WriteFile(path, []byte(want), 0644); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}

	got, err := resolvePackRenderMarkdown(nil, uuid.Nil, path, false)
	if err != nil {
		t.Fatalf("resolvePackRenderMarkdown() error: %v", err)
	}
	if got != want {
		t.Fatalf("expected markdown %q, got %q", want, got)
	}
}

func TestResolvePackRenderMarkdown_ReadsStdin(t *testing.T) {
	want := "# Caller Markdown From Stdin\n"
	restore := replaceStdin(t, want)
	defer restore()

	got, err := resolvePackRenderMarkdown(nil, uuid.Nil, "", true)
	if err != nil {
		t.Fatalf("resolvePackRenderMarkdown() error: %v", err)
	}
	if got != want {
		t.Fatalf("expected markdown %q, got %q", want, got)
	}
}

func TestRunPackRenderCmd_PreviewsCallerMarkdownFromFile(t *testing.T) {
	t.Parallel()

	packID := "00000000-0000-0000-0000-000000000001"
	handler := &stubRenderPackHandler{}
	apiSrv := newCombinedRenderServer(t, handler)
	markdownPath := filepath.Join(t.TempDir(), "caller.md")
	markdown := "# Caller Markdown\n"
	if err := os.WriteFile(markdownPath, []byte(markdown), 0644); err != nil {
		t.Fatalf("WriteFile(%s): %v", markdownPath, err)
	}

	credPath := mustWriteTestCreds(t, apiSrv.URL)

	if err := runPackRenderCmd(
		apiSrv.URL,
		credPath,
		packID,
		"agent:pack-to-docs-v1",
		true,
		nil,
		"",
		markdownPath,
		false,
	); err != nil {
		t.Fatalf("runPackRenderCmd() error: %v", err)
	}

	if handler.previewCalls != 1 {
		t.Fatalf("expected one preview call, got %d", handler.previewCalls)
	}
	if !handler.previewIncludedMarkdown {
		t.Fatal("preview request did not include renderedMarkdown")
	}
	if handler.previewMarkdown != markdown {
		t.Fatalf("expected preview markdown %q, got %q", markdown, handler.previewMarkdown)
	}
	if handler.persistCalls != 0 {
		t.Fatalf("expected no persist calls, got %d", handler.persistCalls)
	}
}

func TestRunPackRenderCmd_PersistsCallerMarkdownFromStdin(t *testing.T) {
	packID := "00000000-0000-0000-0000-000000000001"
	handler := &stubRenderPackHandler{}
	apiSrv := newCombinedRenderServer(t, handler)
	markdown := "# Caller Markdown From Stdin\n"

	restore := replaceStdin(t, markdown)
	defer restore()

	credPath := mustWriteTestCreds(t, apiSrv.URL)

	if err := runPackRenderCmd(
		apiSrv.URL,
		credPath,
		packID,
		"agent:pack-to-docs-v1",
		false,
		nil,
		"",
		"",
		true,
	); err != nil {
		t.Fatalf("runPackRenderCmd() error: %v", err)
	}

	if handler.persistCalls != 1 {
		t.Fatalf("expected one persist call, got %d", handler.persistCalls)
	}
	if !handler.persistIncludedMarkdown {
		t.Fatal("persist request did not include renderedMarkdown")
	}
	if handler.persistMarkdown != markdown {
		t.Fatalf("expected persisted markdown %q, got %q", markdown, handler.persistMarkdown)
	}
	if handler.previewCalls != 0 {
		t.Fatalf("expected no preview calls, got %d", handler.previewCalls)
	}
}

func TestRunPackRenderCmd_RejectsMarkdownFlagsForServerMethods(t *testing.T) {
	t.Parallel()

	packID := "00000000-0000-0000-0000-000000000001"
	handler := &stubRenderPackHandler{}
	apiSrv := newCombinedRenderServer(t, handler)
	markdownPath := filepath.Join(t.TempDir(), "caller.md")
	if err := os.WriteFile(markdownPath, []byte("# Caller Markdown\n"), 0644); err != nil {
		t.Fatalf("WriteFile(%s): %v", markdownPath, err)
	}

	credPath := mustWriteTestCreds(t, apiSrv.URL)

	err := runPackRenderCmd(
		apiSrv.URL,
		credPath,
		packID,
		"server:pack-to-docs-v1",
		false,
		nil,
		"",
		markdownPath,
		false,
	)
	if err == nil {
		t.Fatal("expected error for markdown-file with server render method")
	}
	if !strings.Contains(err.Error(), "server render methods must not be combined") {
		t.Fatalf("unexpected error: %v", err)
	}
	if handler.persistCalls != 0 || handler.previewCalls != 0 {
		t.Fatalf("expected no API calls, got persist=%d preview=%d", handler.persistCalls, handler.previewCalls)
	}
}

func replaceStdin(t *testing.T, content string) func() {
	t.Helper()

	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe(): %v", err)
	}
	if _, err := writer.WriteString(content); err != nil {
		t.Fatalf("writer.WriteString(): %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close(): %v", err)
	}

	original := os.Stdin
	os.Stdin = reader

	return func() {
		_ = reader.Close()
		os.Stdin = original
	}
}

func newCombinedRenderServer(t *testing.T, h moltnetapi.Handler) *httptest.Server {
	t.Helper()

	apiHandler, err := moltnetapi.NewServer(h, noopSecurityHandler{})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"test-token","token_type":"Bearer","expires_in":3600}`))
			return
		}

		apiHandler.ServeHTTP(w, r)
	}))

	t.Cleanup(server.Close)

	return server
}

func mustWriteTestCreds(t *testing.T, apiURL string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "moltnet.json")
	content := fmt.Sprintf(`{"oauth2":{"client_id":"cid","client_secret":"csec"},"endpoints":{"api":"%s","mcp":"%s/mcp"}}`, apiURL, apiURL)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
	return path
}
