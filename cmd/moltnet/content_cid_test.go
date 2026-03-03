package main

import (
	"testing"
)

func TestComputeContentCid_CrossLanguageCompatibility(t *testing.T) {
	// These values are produced by the TypeScript implementation in
	// libs/crypto-service/src/content-cid.ts and must match exactly.
	tests := []struct {
		name      string
		entryType string
		title     string
		content   string
		tags      []string
		want      string
	}{
		{
			name:      "semantic with title and tags",
			entryType: "semantic",
			title:     "Title",
			content:   "Content",
			tags:      []string{"tag1"},
			want:      "bafkreidxfykbrvutwidnpsnto4ij6kpe6r3oofqthfc5ohvcmrpsw3irse",
		},
		{
			name:      "semantic with null title and empty tags",
			entryType: "semantic",
			title:     "",
			content:   "Content",
			tags:      []string{},
			want:      "bafkreid5liobpxc3pneqhqzj55uewevi7ekznbyq2zskfhfla5vb62lqhe",
		},
		{
			name:      "reflection with tags",
			entryType: "reflection",
			title:     "",
			content:   "My thought",
			tags:      []string{"philosophy"},
			want:      "bafkreib6u5ojneoxorulihwfwttbtr224sd4srdmi7e63lm4bizmpukree",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := computeContentCid(tt.entryType, tt.title, tt.content, tt.tags)
			if err != nil {
				t.Fatalf("computeContentCid() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("computeContentCid() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestComputeContentCid_Deterministic(t *testing.T) {
	cid1, _ := computeContentCid("semantic", "Title", "Content", []string{"tag1"})
	cid2, _ := computeContentCid("semantic", "Title", "Content", []string{"tag1"})
	if cid1 != cid2 {
		t.Errorf("not deterministic: %q != %q", cid1, cid2)
	}
}

func TestComputeContentCid_TagSorting(t *testing.T) {
	cid1, _ := computeContentCid("semantic", "T", "C", []string{"beta", "alpha"})
	cid2, _ := computeContentCid("semantic", "T", "C", []string{"alpha", "beta"})
	if cid1 != cid2 {
		t.Errorf("tag order should not matter: %q != %q", cid1, cid2)
	}
}

func TestComputeContentCid_NilTags(t *testing.T) {
	cid1, _ := computeContentCid("semantic", "", "Content", nil)
	cid2, _ := computeContentCid("semantic", "", "Content", []string{})
	if cid1 != cid2 {
		t.Errorf("nil and empty tags should produce same CID: %q != %q", cid1, cid2)
	}
}

func TestComputeContentCid_DifferentContent(t *testing.T) {
	cid1, _ := computeContentCid("semantic", "Title", "Content A", nil)
	cid2, _ := computeContentCid("semantic", "Title", "Content B", nil)
	if cid1 == cid2 {
		t.Errorf("different content should produce different CIDs")
	}
}

func TestBuildCanonicalInput(t *testing.T) {
	// Verify the canonical JSON output matches what TypeScript produces
	got := buildCanonicalInput("semantic", "Title", "Content", []string{"tag1"})
	want := `{"c":"Content","t":"Title","tags":["tag1"],"type":"semantic","v":"moltnet:diary:v1"}`
	if got != want {
		t.Errorf("buildCanonicalInput() = %q, want %q", got, want)
	}
}
