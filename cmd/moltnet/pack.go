package main

import (
	"compress/flate"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// runPackRenderCmd renders a pack locally for agent-authored methods and
// delegates to the server for trusted server-side render methods.
func runPackRenderCmd(apiURL, credPath, packID, renderMethod string, preview bool, pinned *bool, out string) error {
	packUUID, err := uuid.Parse(packID)
	if err != nil {
		return fmt.Errorf("invalid pack ID %q: %w", packID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	if strings.HasPrefix(renderMethod, "server:") {
		return runServerPackRenderCmd(client, packUUID, renderMethod, preview, pinned, out)
	}

	// Fetch the pack with expanded entries for local rendering
	expand := moltnetapi.NewOptGetContextPackByIdExpand(
		moltnetapi.GetContextPackByIdExpandEntries,
	)
	res, err := client.GetContextPackById(
		context.Background(),
		moltnetapi.GetContextPackByIdParams{
			ID:     packUUID,
			Expand: expand,
		},
	)
	if err != nil {
		return fmt.Errorf("fetch pack: %w", err)
	}
	pack, ok := res.(*moltnetapi.ContextPackResponse)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}

	// Non-server methods still persist caller-authored markdown, so the CLI
	// renders locally before sending the content to the API.
	md := renderPackMarkdown(packUUID.String(), pack)

	if preview {
		if out != "" {
			if err := os.WriteFile(out, []byte(md), 0644); err != nil {
				return fmt.Errorf("write %s: %w", out, err)
			}
			fmt.Fprintf(os.Stderr, "[pack render] preview → %s\n", out)
		} else {
			fmt.Print(md)
		}
		return nil
	}

	// Persist via API
	req := &moltnetapi.RenderContextPackReq{
		RenderedMarkdown: moltnetapi.NewOptString(md),
		RenderMethod:     renderMethod,
	}
	if pinned != nil {
		req.Pinned = moltnetapi.NewOptBool(*pinned)
	}

	renderRes, err := executeRenderContextPack(client, packUUID, req)
	if err != nil {
		return err
	}

	result, ok := renderRes.(*moltnetapi.RenderedPackResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", renderRes)
	}

	if out != "" {
		if err := os.WriteFile(out, []byte(result.RenderedMarkdown), 0644); err != nil {
			return fmt.Errorf("write %s: %w", out, err)
		}
		fmt.Fprintf(os.Stderr, "[pack render] persisted CID=%s → %s\n", result.PackCid, out)
	} else {
		return printJSON(result)
	}
	return nil
}

func executeRenderContextPack(client *moltnetapi.Client, packUUID uuid.UUID, req *moltnetapi.RenderContextPackReq) (moltnetapi.RenderContextPackRes, error) {
	res, err := client.RenderContextPack(
		context.Background(),
		req,
		moltnetapi.RenderContextPackParams{ID: packUUID},
	)
	if err != nil {
		return nil, fmt.Errorf("render pack: %w", err)
	}

	switch res.(type) {
	case *moltnetapi.RenderedPackPreview, *moltnetapi.RenderedPackResult:
		return res, nil
	default:
		return nil, formatAPIError(res)
	}
}

func runServerPackRenderCmd(client *moltnetapi.Client, packUUID uuid.UUID, renderMethod string, preview bool, pinned *bool, out string) error {
	if preview {
		req := &moltnetapi.RenderContextPackReq{
			RenderMethod: renderMethod,
			Preview:      moltnetapi.NewOptBool(true),
		}
		renderRes, err := executeRenderContextPack(client, packUUID, req)
		if err != nil {
			return err
		}
		result, ok := renderRes.(*moltnetapi.RenderedPackPreview)
		if !ok {
			return fmt.Errorf("unexpected response type: %T", renderRes)
		}
		if out != "" {
			if err := os.WriteFile(out, []byte(result.RenderedMarkdown), 0644); err != nil {
				return fmt.Errorf("write %s: %w", out, err)
			}
			fmt.Fprintf(os.Stderr, "[pack render] preview → %s\n", out)
		} else {
			fmt.Print(result.RenderedMarkdown)
		}
		return nil
	}

	req := &moltnetapi.RenderContextPackReq{
		RenderMethod: renderMethod,
	}
	if pinned != nil {
		req.Pinned = moltnetapi.NewOptBool(*pinned)
	}

	renderRes, err := executeRenderContextPack(client, packUUID, req)
	if err != nil {
		return err
	}
	result, ok := renderRes.(*moltnetapi.RenderedPackResult)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", renderRes)
	}

	if out != "" {
		if err := os.WriteFile(out, []byte(result.RenderedMarkdown), 0644); err != nil {
			return fmt.Errorf("write %s: %w", out, err)
		}
		fmt.Fprintf(os.Stderr, "[pack render] persisted CID=%s → %s\n", result.PackCid, out)
		return nil
	}

	return printJSON(result)
}

// runPackProvenanceCmd is the flag-free business logic for pack provenance.
func runPackProvenanceCmd(apiURL, credPath, packID, packCID string, depth int, out, shareURL string) error {
	// Mutual exclusivity: exactly one of packID or packCID must be non-empty.
	if (packID == "") == (packCID == "") {
		return fmt.Errorf("provide exactly one of --pack-id or --pack-cid")
	}

	if depth < 0 {
		return fmt.Errorf("--depth must be a non-negative integer")
	}

	// Validate pack-id early, before loading credentials.
	var packUUID uuid.UUID
	if packID != "" {
		var err error
		packUUID, err = uuid.Parse(packID)
		if err != nil {
			return fmt.Errorf("invalid --pack-id %q: %w", packID, err)
		}
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	ctx := context.Background()
	depthOpt := moltnetapi.NewOptInt(depth)

	// Both endpoints return the same shape; use any to marshal uniformly.
	var graph any
	if packID != "" {
		res, err := client.GetContextPackProvenanceById(ctx, moltnetapi.GetContextPackProvenanceByIdParams{
			ID:    packUUID,
			Depth: depthOpt,
		})
		if err != nil {
			return fmt.Errorf("pack provenance: %w", err)
		}
		g, ok := res.(*moltnetapi.ProvenanceGraph)
		if !ok {
			return formatAPIError(res)
		}
		graph = g
	} else {
		res, err := client.GetContextPackProvenanceByCid(ctx, moltnetapi.GetContextPackProvenanceByCidParams{
			Cid:   packCID,
			Depth: depthOpt,
		})
		if err != nil {
			return fmt.Errorf("pack provenance: %w", err)
		}
		g, ok := res.(*moltnetapi.GetContextPackProvenanceByCidOK)
		if !ok {
			return formatAPIError(res)
		}
		graph = g
	}

	serialized, err := json.MarshalIndent(graph, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal graph: %w", err)
	}

	if shareURL != "" {
		compact, err := json.Marshal(graph)
		if err != nil {
			return fmt.Errorf("compact JSON: %w", err)
		}
		param, err := deflateBase64URL(compact)
		if err != nil {
			return fmt.Errorf("compress graph: %w", err)
		}
		if len(param) > 8000 {
			fmt.Fprintf(os.Stderr, "[pack provenance] warning: URL param is %d bytes — may exceed browser limits\n", len(param))
		}
		viewerURL := strings.TrimRight(shareURL, "/") + "?graph=" + param
		fmt.Println(viewerURL)
		return nil
	}

	if out != "" {
		if err := os.WriteFile(out, append(serialized, '\n'), 0644); err != nil {
			return fmt.Errorf("write %s: %w", out, err)
		}
		fmt.Fprintf(os.Stderr, "[pack provenance] wrote %s\n", out)
		return nil
	}

	fmt.Println(string(serialized))
	return nil
}

// deflateBase64URL compresses data with raw DEFLATE and returns URL-safe base64.
func deflateBase64URL(data []byte) (string, error) {
	var buf strings.Builder
	w, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		return "", err
	}
	if _, err := w.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString([]byte(buf.String())), nil
}

func renderPackMarkdown(id string, pack *moltnetapi.ContextPackResponse) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Context Pack %s\n\n", id)
	fmt.Fprintf(&b, "Entries: %d\n", len(pack.Entries))
	fmt.Fprintf(&b, "Created: %s\n", pack.CreatedAt.UTC().Format(time.RFC3339))
	b.WriteString("\n---\n\n")

	for i, entry := range pack.Entries {
		title := entry.Entry.GetTitle().Value
		if title == "" {
			title = fmt.Sprintf("Entry %d — %s", i+1, entry.EntryId.String()[:8])
		}
		fmt.Fprintf(&b, "### %s\n\n", title)
		fmt.Fprintf(&b, "- Entry ID: `%s`\n", entry.EntryId)
		fmt.Fprintf(&b, "- CID: `%s`\n", entry.EntryCidSnapshot)
		fmt.Fprintf(&b, "- Compression: `%s`\n", entry.CompressionLevel)

		origTokens := "?"
		if !entry.OriginalTokens.Null {
			origTokens = fmt.Sprintf("%.0f", entry.OriginalTokens.Value)
		}
		packedTokens := "?"
		if !entry.PackedTokens.Null {
			packedTokens = fmt.Sprintf("%.0f", entry.PackedTokens.Value)
		}
		fmt.Fprintf(&b, "- Tokens: %s/%s\n\n", packedTokens, origTokens)
		b.WriteString(entry.Entry.Content)
		b.WriteString("\n\n")
	}

	return b.String()
}

// runPackCreateCmd is the flag-free business logic for pack create.
func runPackCreateCmd(apiURL, credPath, diaryID, entriesJSON string, tokenBudget int, pinned *bool) error {
	diaryUUID, err := uuid.Parse(diaryID)
	if err != nil {
		return fmt.Errorf("invalid diary ID %q: %w", diaryID, err)
	}

	var items []struct {
		EntryID string `json:"entryId"`
		Rank    int    `json:"rank"`
	}
	if err := json.Unmarshal([]byte(entriesJSON), &items); err != nil {
		return fmt.Errorf("invalid --entries JSON: %w", err)
	}
	if len(items) == 0 {
		return fmt.Errorf("--entries must contain at least one entry")
	}

	entries := make([]moltnetapi.CreateDiaryCustomPackReqEntriesItem, len(items))
	for i, item := range items {
		entryUUID, err := uuid.Parse(item.EntryID)
		if err != nil {
			return fmt.Errorf("invalid entryId %q at index %d: %w", item.EntryID, i, err)
		}
		entries[i] = moltnetapi.CreateDiaryCustomPackReqEntriesItem{
			EntryId: entryUUID,
			Rank:    item.Rank,
		}
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	req := &moltnetapi.CreateDiaryCustomPackReq{
		Entries:  entries,
		PackType: moltnetapi.CreateDiaryCustomPackReqPackTypeCustom,
		Params:   moltnetapi.CreateDiaryCustomPackReqParams{},
	}
	if tokenBudget > 0 {
		req.TokenBudget = moltnetapi.NewOptInt(tokenBudget)
	}
	if pinned != nil {
		req.Pinned = moltnetapi.NewOptBool(*pinned)
	}

	res, err := client.CreateDiaryCustomPack(
		context.Background(),
		req,
		moltnetapi.CreateDiaryCustomPackParams{ID: diaryUUID},
	)
	if err != nil {
		return fmt.Errorf("pack create: %w", err)
	}

	pack, ok := res.(*moltnetapi.CustomPackResult)
	if !ok {
		return formatAPIError(res)
	}

	return printJSON(pack)
}

// runPackUpdateCmd is the flag-free business logic for pack update.
func runPackUpdateCmd(apiURL, credPath, packID string, pinned *bool, expiresAt string) error {
	packUUID, err := uuid.Parse(packID)
	if err != nil {
		return fmt.Errorf("invalid pack ID %q: %w", packID, err)
	}

	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}

	req := moltnetapi.UpdateContextPackReq{}
	if pinned != nil {
		req.Pinned = moltnetapi.NewOptBool(*pinned)
	}
	if expiresAt != "" {
		t, err := time.Parse(time.RFC3339, expiresAt)
		if err != nil {
			return fmt.Errorf("invalid --expires-at %q: %w", expiresAt, err)
		}
		req.ExpiresAt = moltnetapi.NewOptDateTime(t)
	}

	res, err := client.UpdateContextPack(
		context.Background(),
		moltnetapi.OptUpdateContextPackReq{Value: req, Set: true},
		moltnetapi.UpdateContextPackParams{ID: packUUID},
	)
	if err != nil {
		return fmt.Errorf("pack update: %w", err)
	}

	pack, ok := res.(*moltnetapi.ContextPackResponse)
	if !ok {
		return formatAPIError(res)
	}

	return printJSON(pack)
}

// --- Legacy wrappers preserved for existing tests ---

// runPackProvenance is the legacy flag-parsing entry point, preserved for existing tests.
func runPackProvenance(args []string) error {
	fs := flag.NewFlagSet("pack provenance", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	packID := fs.String("pack-id", "", "Pack UUID")
	packCID := fs.String("pack-cid", "", "Pack CID")
	depth := fs.Int("depth", 2, "Follow pack supersession ancestry to this depth")
	out := fs.String("out", "", "Write JSON to file instead of stdout")
	shareURL := fs.String("share-url", "", "Print a shareable viewer URL (e.g. https://themolt.net/labs/provenance)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet pack provenance [options]")
		fmt.Fprintln(os.Stderr, "\nExport the provenance graph for a context pack as JSON.")
		fmt.Fprintln(os.Stderr, "Provide exactly one of --pack-id or --pack-cid.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	return runPackProvenanceCmd(*apiURL, "", *packID, *packCID, *depth, *out, *shareURL)
}
