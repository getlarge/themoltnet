package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return id
}

func TestSlugForRenderedPack(t *testing.T) {
	id := mustUUID(t, "12345678-1234-5678-1234-567812345678")
	got := slugForRenderedPack(id)
	want := "rendered-pack-12345678"
	if got != want {
		t.Errorf("slugForRenderedPack = %q, want %q", got, want)
	}
}

func TestRenderSkillMarkdown(t *testing.T) {
	bundledAt, _ := time.Parse(time.RFC3339, "2026-05-05T20:00:00Z")
	b := skillBundle{
		slug:            "rendered-pack-12345678",
		description:     "Test description",
		body:            "Body line 1\nBody line 2",
		renderedPackID:  mustUUID(t, "12345678-1234-5678-1234-567812345678"),
		renderedPackCid: "bafyreiabc123",
		sourcePackID:    mustUUID(t, "abcdef00-0000-0000-0000-000000000000"),
		bundledAt:       bundledAt,
	}
	got := renderSkillMarkdown(b)

	checks := []string{
		"---\n",
		"name: rendered-pack-12345678\n",
		"description: Test description\n",
		"moltnet:\n",
		"  rendered_pack_id: 12345678-1234-5678-1234-567812345678\n",
		"  rendered_pack_cid: bafyreiabc123\n",
		"  source_pack_id: abcdef00-0000-0000-0000-000000000000\n",
		"  bundled_at: 2026-05-05T20:00:00Z\n",
		"\nBody line 1\nBody line 2\n",
	}
	for _, want := range checks {
		if !strings.Contains(got, want) {
			t.Errorf("rendered markdown missing %q\nfull output:\n%s", want, got)
		}
	}
	// Trailing newline always present.
	if !strings.HasSuffix(got, "\n") {
		t.Errorf("rendered markdown should end with newline")
	}
}

func TestRenderSkillMarkdown_BodyAlreadyEndsWithNewline(t *testing.T) {
	b := skillBundle{
		slug:            "x",
		description:     "d",
		body:            "Already terminated\n",
		renderedPackID:  mustUUID(t, "11111111-1111-1111-1111-111111111111"),
		renderedPackCid: "cid",
		sourcePackID:    mustUUID(t, "22222222-2222-2222-2222-222222222222"),
		bundledAt:       time.Now(),
	}
	got := renderSkillMarkdown(b)
	if strings.HasSuffix(got, "\n\n\n") {
		t.Errorf("triple newline at EOF: %q", got[len(got)-5:])
	}
}

func TestExtractRenderedPackIDFromSkill(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantID  string
		wantErr bool
	}{
		{
			name: "valid frontmatter with moltnet block",
			input: "---\n" +
				"name: foo\n" +
				"description: bar\n" +
				"moltnet:\n" +
				"  rendered_pack_id: 12345678-1234-5678-1234-567812345678\n" +
				"  bundled_at: 2026-05-05T20:00:00Z\n" +
				"---\n\nbody",
			wantID: "12345678-1234-5678-1234-567812345678",
		},
		{
			name:   "no frontmatter at all",
			input:  "just a markdown doc\n",
			wantID: "",
		},
		{
			name: "frontmatter without moltnet block",
			input: "---\n" +
				"name: foo\n" +
				"description: bar\n" +
				"---\n\nbody",
			wantID: "",
		},
		{
			name: "unterminated frontmatter",
			input: "---\n" +
				"name: foo\n" +
				"  rendered_pack_id: 12345678-1234-5678-1234-567812345678\n",
			wantID: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := extractRenderedPackIDFromSkill(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
			}
			if tc.wantID == "" {
				if got != uuid.Nil {
					t.Errorf("expected uuid.Nil, got %s", got)
				}
				return
			}
			if got.String() != tc.wantID {
				t.Errorf("id = %s, want %s", got, tc.wantID)
			}
		})
	}
}

func TestWriteSkillBundle_FreshWrite(t *testing.T) {
	dir := t.TempDir()
	b := skillBundle{
		slug:            "rendered-pack-aabbccdd",
		description:     "first write",
		body:            "Hello world.",
		renderedPackID:  mustUUID(t, "aabbccdd-0000-0000-0000-000000000000"),
		renderedPackCid: "cid1",
		sourcePackID:    mustUUID(t, "11111111-1111-1111-1111-111111111111"),
		bundledAt:       time.Now(),
	}
	path, err := writeSkillBundle(dir, b)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	want := filepath.Join(dir, "rendered-pack-aabbccdd", "SKILL.md")
	if path != want {
		t.Errorf("path = %s, want %s", path, want)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(got), "Hello world.") {
		t.Errorf("body missing from written file")
	}
}

func TestWriteSkillBundle_IdempotentSameID(t *testing.T) {
	dir := t.TempDir()
	id := mustUUID(t, "aabbccdd-0000-0000-0000-000000000000")
	b1 := skillBundle{
		slug:            "rendered-pack-aabbccdd",
		description:     "first",
		body:            "Body v1",
		renderedPackID:  id,
		renderedPackCid: "cid1",
		sourcePackID:    mustUUID(t, "11111111-1111-1111-1111-111111111111"),
		bundledAt:       time.Now(),
	}
	if _, err := writeSkillBundle(dir, b1); err != nil {
		t.Fatalf("first write: %v", err)
	}

	b2 := b1
	b2.description = "second"
	b2.body = "Body v2"
	b2.renderedPackCid = "cid2"
	b2.bundledAt = b1.bundledAt.Add(time.Hour)
	path, err := writeSkillBundle(dir, b2)
	if err != nil {
		t.Fatalf("second write: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(got), "Body v2") {
		t.Errorf("re-write didn't replace body")
	}
	if strings.Contains(string(got), "Body v1") {
		t.Errorf("old body still present after re-write")
	}
	if !strings.Contains(string(got), "rendered_pack_cid: cid2") {
		t.Errorf("cid not updated")
	}
}

func TestDescriptionForBundle_UsesServerValue(t *testing.T) {
	pack := &moltnetapi.RenderedPackWithContent{
		ID:           mustUUID(t, "11111111-1111-1111-1111-111111111111"),
		RenderMethod: "agent:pack-to-docs-v1",
		Description:  moltnetapi.NewNilString("Use when working on auth flows"),
	}
	got, isPlaceholder := descriptionForBundle(pack)
	if got != "Use when working on auth flows" {
		t.Errorf("description = %q, want server value", got)
	}
	if isPlaceholder {
		t.Errorf("isPlaceholder = true, want false")
	}
}

func TestDescriptionForBundle_FallsBackOnNullDescription(t *testing.T) {
	var nullDesc moltnetapi.NilString
	nullDesc.SetToNull()
	pack := &moltnetapi.RenderedPackWithContent{
		ID:           mustUUID(t, "22222222-2222-2222-2222-222222222222"),
		RenderMethod: "agent:pack-to-docs-v1",
		Description:  nullDesc,
	}
	got, isPlaceholder := descriptionForBundle(pack)
	if !isPlaceholder {
		t.Errorf("isPlaceholder = false, want true")
	}
	if !strings.Contains(got, "no description set") {
		t.Errorf("description should explain absence; got %q", got)
	}
	if !strings.Contains(got, "moltnet rendered-pack update") {
		t.Errorf("description should hint the update command; got %q", got)
	}
}

func TestDescriptionForBundle_FallsBackOnWhitespaceOnly(t *testing.T) {
	pack := &moltnetapi.RenderedPackWithContent{
		ID:           mustUUID(t, "33333333-3333-3333-3333-333333333333"),
		RenderMethod: "agent:pack-to-docs-v1",
		Description:  moltnetapi.NewNilString("   "),
	}
	_, isPlaceholder := descriptionForBundle(pack)
	if !isPlaceholder {
		t.Errorf("whitespace-only description should be treated as absent")
	}
}

func TestWriteSkillBundle_SlugCollisionDifferentID(t *testing.T) {
	dir := t.TempDir()
	b1 := skillBundle{
		slug:            "rendered-pack-shared",
		description:     "first",
		body:            "Body 1",
		renderedPackID:  mustUUID(t, "aaaaaaaa-0000-0000-0000-000000000000"),
		renderedPackCid: "cid1",
		sourcePackID:    mustUUID(t, "11111111-1111-1111-1111-111111111111"),
		bundledAt:       time.Now(),
	}
	if _, err := writeSkillBundle(dir, b1); err != nil {
		t.Fatalf("first write: %v", err)
	}

	b2 := b1
	b2.renderedPackID = mustUUID(t, "bbbbbbbb-0000-0000-0000-000000000000")
	b2.renderedPackCid = "cid2"
	_, err := writeSkillBundle(dir, b2)
	if err == nil {
		t.Fatal("expected slug collision error, got nil")
	}
	if !strings.Contains(err.Error(), "slug collision") {
		t.Errorf("error = %v, want substring 'slug collision'", err)
	}
}
