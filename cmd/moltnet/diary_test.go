package main

import (
	"context"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// stubDiaryHandler implements only the diary operations used by the CLI.
type stubDiaryHandler struct {
	moltnetapi.UnimplementedHandler
}

var testDiaryID = uuid.MustParse("00000000-0000-0000-0000-000000000001")
var testEntryID = uuid.MustParse("00000000-0000-0000-0000-000000000042")

func newTestEntry(content string) *moltnetapi.DiaryEntry {
	return &moltnetapi.DiaryEntry{
		ID:         testEntryID,
		DiaryId:    testDiaryID,
		Content:    content,
		EntryType:  moltnetapi.DiaryEntryEntryTypeEpisodic,
		Importance: 5,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		Tags:       []string{},
	}
}

func (h *stubDiaryHandler) CreateDiaryEntry(_ context.Context, req *moltnetapi.CreateDiaryEntryReq, _ moltnetapi.CreateDiaryEntryParams) (moltnetapi.CreateDiaryEntryRes, error) {
	return newTestEntry(req.Content), nil
}

func (h *stubDiaryHandler) ListDiaryEntries(_ context.Context, _ moltnetapi.ListDiaryEntriesParams) (moltnetapi.ListDiaryEntriesRes, error) {
	return &moltnetapi.DiaryList{
		Items: []moltnetapi.DiaryEntry{*newTestEntry("entry-1"), *newTestEntry("entry-2")},
		Total: 2,
		Limit: 20,
	}, nil
}

func (h *stubDiaryHandler) GetDiaryEntryById(_ context.Context, params moltnetapi.GetDiaryEntryByIdParams) (moltnetapi.GetDiaryEntryByIdRes, error) {
	e := newTestEntry("fetched content")
	e.ID = params.EntryId
	return e, nil
}

func (h *stubDiaryHandler) DeleteDiaryEntryById(_ context.Context, _ moltnetapi.DeleteDiaryEntryByIdParams) (moltnetapi.DeleteDiaryEntryByIdRes, error) {
	return &moltnetapi.Success{}, nil
}

func (h *stubDiaryHandler) SearchDiary(_ context.Context, req moltnetapi.OptSearchDiaryReq) (moltnetapi.SearchDiaryRes, error) {
	return &moltnetapi.DiarySearchResult{
		Results: []moltnetapi.DiaryEntry{*newTestEntry("search result")},
		Total:   1,
	}, nil
}

func TestDiaryCreate(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.CreateDiaryEntry(context.Background(), &moltnetapi.CreateDiaryEntryReq{
		Content: "hello world",
	}, moltnetapi.CreateDiaryEntryParams{DiaryId: testDiaryID})

	// Assert
	if err != nil {
		t.Fatalf("CreateDiaryEntry() error: %v", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		t.Fatalf("expected *DiaryEntry, got %T", res)
	}
	if entry.Content != "hello world" {
		t.Errorf("expected content=hello world, got %q", entry.Content)
	}
}

func TestDiaryList(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.ListDiaryEntries(context.Background(), moltnetapi.ListDiaryEntriesParams{DiaryId: testDiaryID})

	// Assert
	if err != nil {
		t.Fatalf("ListDiaryEntries() error: %v", err)
	}
	list, ok := res.(*moltnetapi.DiaryList)
	if !ok {
		t.Fatalf("expected *DiaryList, got %T", res)
	}
	if len(list.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(list.Items))
	}
}

func TestDiaryGet(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.GetDiaryEntryById(context.Background(), moltnetapi.GetDiaryEntryByIdParams{EntryId: testEntryID})

	// Assert
	if err != nil {
		t.Fatalf("GetDiaryEntryById() error: %v", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		t.Fatalf("expected *DiaryEntry, got %T", res)
	}
	if entry.ID != testEntryID {
		t.Errorf("expected id=%s, got %s", testEntryID, entry.ID)
	}
}

func TestDiaryDelete(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.DeleteDiaryEntryById(context.Background(), moltnetapi.DeleteDiaryEntryByIdParams{EntryId: testEntryID})

	// Assert
	if err != nil {
		t.Fatalf("DeleteDiaryEntryById() error: %v", err)
	}
	if _, ok := res.(*moltnetapi.Success); !ok {
		t.Fatalf("expected *Success, got %T", res)
	}
}

func TestDiarySearch(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.SearchDiary(context.Background(), moltnetapi.OptSearchDiaryReq{
		Value: moltnetapi.SearchDiaryReq{
			Query: moltnetapi.OptString{Value: "test query", Set: true},
		},
		Set: true,
	})

	// Assert
	if err != nil {
		t.Fatalf("SearchDiary() error: %v", err)
	}
	results, ok := res.(*moltnetapi.DiarySearchResult)
	if !ok {
		t.Fatalf("expected *DiarySearchResult, got %T", res)
	}
	if len(results.Results) != 1 {
		t.Errorf("expected 1 result, got %d", len(results.Results))
	}
}
