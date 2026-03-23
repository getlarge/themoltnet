package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

func runPack(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet pack <export> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "export":
		return runPackExport(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown pack subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet pack <export> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runPackExport(args []string) error {
	fs := flag.NewFlagSet("pack export", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	out := fs.String("out", "", "Output file path (default: stdout)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet pack export [options] <pack-uuid>")
		fmt.Fprintln(os.Stderr, "\nExport a context pack as markdown. The pack ID must be a UUID (not a CID).")
		fmt.Fprintln(os.Stderr, "Use 'moltnet pack list' or the MCP packs_list tool to find pack UUIDs.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("pack id argument required")
	}

	packUUID, err := uuid.Parse(fs.Arg(0))
	if err != nil {
		return fmt.Errorf("invalid pack ID %q: %w", fs.Arg(0), err)
	}

	client, err := newClientFromCreds(*apiURL)
	if err != nil {
		return err
	}

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
		return fmt.Errorf("pack export: %w", err)
	}
	pack, ok := res.(*moltnetapi.ContextPackResponse)
	if !ok {
		return fmt.Errorf("unexpected response type: %T", res)
	}

	md := renderPackMarkdown(packUUID.String(), pack)

	if *out != "" {
		if err := os.WriteFile(*out, []byte(md), 0644); err != nil {
			return fmt.Errorf("write %s: %w", *out, err)
		}
		fmt.Fprintf(os.Stderr, "[pack export] %d entries → %s\n", len(pack.Entries), *out)
	} else {
		fmt.Print(md)
	}
	return nil
}

func renderPackMarkdown(id string, pack *moltnetapi.ContextPackResponse) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Context Pack %s\n\n", id)
	fmt.Fprintf(&b, "Entries: %d\n", len(pack.Entries))
	fmt.Fprintf(&b, "Created: %s\n", pack.CreatedAt.Format("2006-01-02T15:04:05Z"))
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
