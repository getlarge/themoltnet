package main

import (
	"context"
	"os"
	"path/filepath"
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
}

func (h *stubRenderPackHandler) RenderContextPack(_ context.Context, req *moltnetapi.RenderContextPackReq, params moltnetapi.RenderContextPackParams) (moltnetapi.RenderContextPackRes, error) {
	if _, ok := req.RenderedMarkdown.Get(); ok {
		if req.Preview.Or(false) {
			h.previewIncludedMarkdown = true
		} else {
			h.persistIncludedMarkdown = true
		}
	}

	if req.Preview.Or(false) {
		h.previewCalls++
		return &moltnetapi.RenderedPackPreview{
			RenderMethod:     req.RenderMethod,
			RenderedMarkdown: "# Server Markdown\n",
			SourcePackCid:    "bafy-source",
			SourcePackId:     params.ID,
			TotalTokens:      3,
		}, nil
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
}
