package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"sort"

	gocid "github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
)

// computeContentCid produces a CIDv1 content identifier for a diary entry.
// Matches the TypeScript computeContentCid() in libs/crypto-service/src/content-cid.ts.
//
// Format: CIDv1, sha2-256, raw codec (0x55), base32lower multibase.
func computeContentCid(entryType, title, content string, tags []string) (string, error) {
	canonical := buildCanonicalInput(entryType, title, content, tags)
	hash := sha256.Sum256([]byte(canonical))

	mh, err := multihash.Encode(hash[:], multihash.SHA2_256)
	if err != nil {
		return "", err
	}
	c := gocid.NewCidV1(0x55, mh) // 0x55 = raw codec
	return c.StringOfBase('b')     // base32lower
}

// buildCanonicalInput produces the JSON canonical form matching the TypeScript implementation.
// Keys are sorted alphabetically: c, t, tags, type, v — which is what json.Marshal produces
// for struct fields with json tags in that order.
func buildCanonicalInput(entryType, title, content string, tags []string) string {
	if tags == nil {
		tags = []string{}
	} else {
		sorted := make([]string, len(tags))
		copy(sorted, tags)
		sort.Strings(sorted)
		tags = sorted
	}

	// Use a struct with fields ordered alphabetically by JSON key name.
	// Go's encoding/json marshals struct fields in declaration order,
	// so we declare them in alphabetical order of their JSON tags.
	type canonicalEntry struct {
		C    string   `json:"c"`
		T    string   `json:"t"`
		Tags []string `json:"tags"`
		Type string   `json:"type"`
		V    string   `json:"v"`
	}

	entry := canonicalEntry{
		C:    content,
		T:    title,
		Tags: tags,
		Type: entryType,
		V:    "moltnet:diary:v1",
	}

	// Use an encoder with SetEscapeHTML(false) to match JSON.stringify behavior.
	// Go's json.Marshal escapes <, >, & to \u003c etc. by default, but
	// JavaScript's JSON.stringify does not. Both must produce identical output.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(entry)
	// Encode appends a trailing newline — strip it
	out := buf.Bytes()
	return string(out[:len(out)-1])
}
