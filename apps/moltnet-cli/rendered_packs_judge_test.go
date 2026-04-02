package main

import (
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	gocid "github.com/ipfs/go-cid"
)

func TestBuildSourceEntriesMarkdown(t *testing.T) {
	entries := []moltnetapi.ClaimVerificationResponseSourceEntriesItem{
		{
			Title:   "Entry One",
			Content: "First content",
		},
		{
			Title:   "",
			Content: "Second content",
		},
	}

	md := buildSourceEntriesMarkdown(entries)

	if !strings.Contains(md, "## Entry One\nFirst content\n") {
		t.Fatalf("expected first entry in markdown, got: %q", md)
	}
	if !strings.Contains(md, "## Untitled\nSecond content\n") {
		t.Fatalf("expected untitled fallback in markdown, got: %q", md)
	}
}

func TestSelfBinaryCID(t *testing.T) {
	cid, err := selfBinaryCID()
	if err != nil {
		t.Fatalf("selfBinaryCID returned error: %v", err)
	}

	if !strings.HasPrefix(cid, "b") {
		t.Fatalf("expected base32 CID prefix, got %q", cid)
	}
	if _, err := gocid.Decode(cid); err != nil {
		t.Fatalf("expected valid CID, decode failed: %v", err)
	}
}
