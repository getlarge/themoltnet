//go:build e2e

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// These tests exercise the compiled moltnet CLI binary against the live
// rest-api (running via the e2e compose stack). They complement the
// library-level tests in e2e_test.go by covering the cobra command tree,
// flag parsing, and stdout/stderr framing that real users rely on.
//
// Tests are written to share a single bootstrapped agent + diary from
// TestMain. Each test creates its own isolated data (fresh entries, fresh
// sub-diaries) to avoid cross-contamination.

// cliHarness bundles the compiled binary path and credentials file path
// once per test, so call sites stay terse.
type cliHarness struct {
	bin   string
	creds string
}

func newCLIHarness(t *testing.T) *cliHarness {
	t.Helper()
	bin, err := ensureE2ECLIBinary()
	if err != nil {
		t.Fatalf("build e2e cli binary: %v", err)
	}
	creds, err := writeE2ECredsFile(e2eCreds)
	if err != nil {
		t.Fatalf("write e2e creds file: %v", err)
	}
	return &cliHarness{bin: bin, creds: creds}
}

func (h *cliHarness) run(t *testing.T, args ...string) (string, string) {
	t.Helper()
	stdout, stderr, err := runE2ECLI(h.bin, h.creds, args...)
	if err != nil {
		t.Fatalf(
			"CLI %v failed: %v\nstdout:\n%s\nstderr:\n%s",
			args, err, stdout, stderr,
		)
	}
	return stdout, stderr
}

// decodeJSON unmarshals the trimmed stdout into the target. The moltnet CLI
// prints human-readable progress messages to stderr and a single JSON value
// (object or list) to stdout, so a direct Unmarshal is sufficient.
func decodeJSON(t *testing.T, stdout string, into any) {
	t.Helper()
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		t.Fatalf("expected JSON on stdout, got empty string")
	}
	if err := json.Unmarshal([]byte(trimmed), into); err != nil {
		t.Fatalf("decode JSON: %v\nstdout:\n%s", err, stdout)
	}
}

func TestE2E_CLI_EntryCreateSigned(t *testing.T) {
	h := newCLIHarness(t)

	content := fmt.Sprintf(
		"E2E CLI signed entry %s — exercises entry create-signed round-trip",
		uuid.NewString(),
	)
	uniqueTag := "e2e-cli-signed-" + uuid.NewString()[:8]

	stdout, _ := h.run(t,
		"entry", "create-signed",
		"--diary-id", e2eDiaryID.String(),
		"--content", content,
		"--title", "E2E CLI signed entry",
		"--type", "semantic",
		"--tags", "e2e-cli,"+uniqueTag,
	)

	var entry moltnetapi.DiaryEntry
	decodeJSON(t, stdout, &entry)
	if entry.ID == uuid.Nil {
		t.Fatalf("expected non-nil entry ID, got: %s", stdout)
	}

	// Verify the entry is actually signed by re-fetching via the CLI verify
	// command and asserting valid=true.
	verifyOut, _ := h.run(t, "entry", "verify", entry.ID.String())
	var verify moltnetapi.EntryVerifyResult
	decodeJSON(t, verifyOut, &verify)
	if !verify.Valid {
		t.Errorf("expected valid=true, got %+v", verify)
	}
	if !verify.Signed {
		t.Errorf("expected signed=true, got %+v", verify)
	}
	if !verify.SignatureValid {
		t.Errorf("expected signatureValid=true, got %+v", verify)
	}
}

func TestE2E_CLI_EntryList_ByTag(t *testing.T) {
	h := newCLIHarness(t)

	uniqueTag := "e2e-cli-list-" + uuid.NewString()[:8]
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Create two entries directly via the client (faster, and keeps the CLI
	// focus on the list command itself).
	for i := 0; i < 2; i++ {
		_, err := e2eClient.CreateDiaryEntry(
			ctx,
			&moltnetapi.CreateDiaryEntryReq{
				Content: fmt.Sprintf("E2E CLI list entry %d %s", i, uuid.NewString()),
				Title:   moltnetapi.NewOptString(fmt.Sprintf("E2E CLI list %d", i)),
				Tags:    []string{uniqueTag, "e2e-cli"},
			},
			moltnetapi.CreateDiaryEntryParams{DiaryId: e2eDiaryID},
		)
		if err != nil {
			t.Fatalf("create seed entry %d: %v", i, err)
		}
	}

	stdout, _ := h.run(t,
		"entry", "list",
		"--diary-id", e2eDiaryID.String(),
		"--tags", uniqueTag,
		"--limit", "50",
	)

	var list moltnetapi.DiaryList
	decodeJSON(t, stdout, &list)
	if len(list.Items) < 2 {
		t.Fatalf("expected >=2 entries with tag %s, got %d", uniqueTag, len(list.Items))
	}
	for _, item := range list.Items {
		hasTag := false
		for _, tag := range item.Tags {
			if tag == uniqueTag {
				hasTag = true
				break
			}
		}
		if !hasTag {
			t.Errorf("entry %s missing filter tag %s (tags=%v)", item.ID, uniqueTag, item.Tags)
		}
	}
}

func TestE2E_CLI_EntrySearch(t *testing.T) {
	h := newCLIHarness(t)

	// Use a rare unique phrase so we're not racing other entries in the
	// shared diary. The search command is hybrid (keyword + vector); an
	// unusual literal phrase should trigger a keyword hit regardless of
	// embedding readiness.
	marker := "xyzzy-plugh-" + uuid.NewString()[:8]
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, err := e2eClient.CreateDiaryEntry(
		ctx,
		&moltnetapi.CreateDiaryEntryReq{
			Content: fmt.Sprintf("E2E CLI search marker %s — should surface via keyword search", marker),
			Title:   moltnetapi.NewOptString("E2E CLI search"),
			Tags:    []string{"e2e-cli"},
		},
		moltnetapi.CreateDiaryEntryParams{DiaryId: e2eDiaryID},
	)
	if err != nil {
		t.Fatalf("seed search entry: %v", err)
	}

	stdout, _ := h.run(t, "entry", "search", "--query", marker)

	// Search response shape: { results: [...], total: N }. We only need to
	// know at least one result's content contains our unique marker.
	var result moltnetapi.DiarySearchResult
	decodeJSON(t, stdout, &result)
	found := false
	for _, item := range result.Results {
		if strings.Contains(item.Content, marker) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("search for %q returned no matching items; stdout:\n%s", marker, stdout)
	}
}

func TestE2E_CLI_DiaryCreate(t *testing.T) {
	h := newCLIHarness(t)

	name := "e2e-cli-diary-" + uuid.NewString()[:8]
	stdout, _ := h.run(t,
		"diary", "create",
		"--name", name,
		"--visibility", "moltnet",
		"--team-id", e2ePersonalTeamID.String(),
	)

	var diary moltnetapi.DiaryCatalog
	decodeJSON(t, stdout, &diary)
	if diary.ID == uuid.Nil {
		t.Fatalf("expected non-nil diary ID, got: %s", stdout)
	}
	if diary.Name != name {
		t.Errorf("name mismatch: got %q, want %q", diary.Name, name)
	}

	// Confirm the diary exists by fetching it back via the client.
	got, err := e2eClient.GetDiary(
		context.Background(),
		moltnetapi.GetDiaryParams{ID: diary.ID},
	)
	if err != nil {
		t.Fatalf("get diary: %v", err)
	}
	if _, ok := got.(*moltnetapi.DiaryCatalog); !ok {
		t.Fatalf("unexpected get diary response: %T", got)
	}
}

func TestE2E_CLI_Pack_CreateAndRender(t *testing.T) {
	h := newCLIHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Seed two entries directly; the pack create test is about the pack
	// command path, not entry creation.
	mkEntry := func(i int) uuid.UUID {
		res, err := e2eClient.CreateDiaryEntry(
			ctx,
			&moltnetapi.CreateDiaryEntryReq{
				Content: fmt.Sprintf("E2E CLI pack entry %d — %s", i, uuid.NewString()),
				Title:   moltnetapi.NewOptString(fmt.Sprintf("E2E CLI pack %d", i)),
			},
			moltnetapi.CreateDiaryEntryParams{DiaryId: e2eDiaryID},
		)
		if err != nil {
			t.Fatalf("create pack seed entry %d: %v", i, err)
		}
		entry, ok := res.(*moltnetapi.DiaryEntry)
		if !ok {
			t.Fatalf("unexpected entry create response: %T", res)
		}
		return entry.ID
	}
	e1 := mkEntry(1)
	e2 := mkEntry(2)

	entriesJSON := fmt.Sprintf(
		`[{"entryId":"%s","rank":1},{"entryId":"%s","rank":2}]`,
		e1, e2,
	)

	createOut, _ := h.run(t,
		"pack", "create",
		"--diary-id", e2eDiaryID.String(),
		"--entries", entriesJSON,
	)

	// `pack create` returns the CustomPackResult shape (packCid + pack
	// payload). We only need the packCid to look up the persisted pack.
	var created moltnetapi.CustomPackResult
	decodeJSON(t, createOut, &created)
	if created.PackCid == "" {
		t.Fatalf("expected non-empty pack CID, got: %s", createOut)
	}

	// The CustomPackResult doesn't carry a pack UUID; resolve it via list.
	listRes, err := e2eClient.ListDiaryPacks(
		ctx,
		moltnetapi.ListDiaryPacksParams{ID: e2eDiaryID},
	)
	if err != nil {
		t.Fatalf("list diary packs: %v", err)
	}
	packList, ok := listRes.(*moltnetapi.ContextPackResponseList)
	if !ok {
		t.Fatalf("unexpected list packs response: %T", listRes)
	}
	var packID uuid.UUID
	for _, p := range packList.Items {
		if p.PackCid == created.PackCid {
			packID = p.ID
			break
		}
	}
	if packID == uuid.Nil {
		t.Fatalf("created pack (cid=%s) not found in list", created.PackCid)
	}

	// Render in preview mode — returns markdown without persisting a
	// rendered pack row. Keeps this test independent of rendered-packs list.
	renderOut, _ := h.run(t,
		"pack", "render",
		"--preview",
		packID.String(),
	)
	if len(strings.TrimSpace(renderOut)) == 0 {
		t.Fatalf("expected non-empty rendered markdown, got empty stdout")
	}
	if !strings.Contains(renderOut, "E2E CLI pack") {
		t.Errorf("rendered markdown missing seed entry title; got:\n%s", renderOut)
	}
}

func TestE2E_CLI_RenderedPacks_List(t *testing.T) {
	h := newCLIHarness(t)

	// Reuse the existing fixture helper: creates 2 entries, 1 custom pack,
	// and 1 rendered pack (agent-refined, persisted).
	renderedID, err := createAgentRenderedPackForVerification(
		t,
		"# E2E CLI list rendered packs\n\nFixture markdown.",
	)
	if err != nil {
		t.Fatalf("create rendered pack fixture: %v", err)
	}

	stdout, _ := h.run(t,
		"rendered-packs", "list",
		"--diary-id", e2eDiaryID.String(),
		"--limit", "50",
	)

	var list moltnetapi.RenderedPackList
	decodeJSON(t, stdout, &list)

	found := false
	for _, item := range list.Items {
		if item.ID == renderedID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("rendered pack %s not in list (items=%d)\nstdout:\n%s",
			renderedID, len(list.Items), stdout)
	}
}
