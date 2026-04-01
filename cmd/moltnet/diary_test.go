package main

import (
	"context"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
)

// stubDiaryHandler implements only the diary/entry operations used by the CLI.
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

func (h *stubDiaryHandler) UpdateDiaryEntryById(_ context.Context, req moltnetapi.OptUpdateDiaryEntryByIdReq, params moltnetapi.UpdateDiaryEntryByIdParams) (moltnetapi.UpdateDiaryEntryByIdRes, error) {
	e := newTestEntry("updated content")
	e.ID = params.EntryId
	if req.Set && req.Value.Content.Set {
		e.Content = req.Value.Content.Value
	}
	return e, nil
}

func newTestDiary(name string) *moltnetapi.DiaryCatalog {
	return &moltnetapi.DiaryCatalog{
		ID:         testDiaryID,
		CreatedBy:  uuid.MustParse("00000000-0000-0000-0000-000000000099"),
		TeamId:     uuid.MustParse("00000000-0000-0000-0000-000000000088"),
		Name:       name,
		Visibility: moltnetapi.DiaryCatalogVisibilityMoltnet,
		Signed:     false,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
}

func (h *stubDiaryHandler) ListDiaries(_ context.Context) (moltnetapi.ListDiariesRes, error) {
	return &moltnetapi.DiaryCatalogList{
		Items: []moltnetapi.DiaryCatalog{*newTestDiary("diary-1"), *newTestDiary("diary-2")},
	}, nil
}

func (h *stubDiaryHandler) CreateDiary(_ context.Context, req *moltnetapi.CreateDiaryReq) (moltnetapi.CreateDiaryRes, error) {
	return newTestDiary(req.Name), nil
}

func (h *stubDiaryHandler) GetDiary(_ context.Context, params moltnetapi.GetDiaryParams) (moltnetapi.GetDiaryRes, error) {
	d := newTestDiary("fetched diary")
	d.ID = params.ID
	return d, nil
}

func (h *stubDiaryHandler) ListDiaryTags(_ context.Context, _ moltnetapi.ListDiaryTagsParams) (moltnetapi.ListDiaryTagsRes, error) {
	return &moltnetapi.DiaryTagsResponse{
		Tags: []moltnetapi.DiaryTagsResponseTagsItem{
			{Tag: "scope:cli", Count: 5},
			{Tag: "tool:claude", Count: 3},
		},
		Total: 2,
	}, nil
}

// --- Diary-level API client tests ---

func TestDiaryListDiaries(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.ListDiaries(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("ListDiaries() error: %v", err)
	}
	list, ok := res.(*moltnetapi.DiaryCatalogList)
	if !ok {
		t.Fatalf("expected *DiaryCatalogList, got %T", res)
	}
	if len(list.Items) != 2 {
		t.Errorf("expected 2 diaries, got %d", len(list.Items))
	}
}

func TestDiaryCreateDiary(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.CreateDiary(context.Background(), &moltnetapi.CreateDiaryReq{
		Name: "test diary",
	})

	// Assert
	if err != nil {
		t.Fatalf("CreateDiary() error: %v", err)
	}
	diary, ok := res.(*moltnetapi.DiaryCatalog)
	if !ok {
		t.Fatalf("expected *DiaryCatalog, got %T", res)
	}
	if diary.Name != "test diary" {
		t.Errorf("expected name=test diary, got %q", diary.Name)
	}
}

func TestDiaryGetDiary(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.GetDiary(context.Background(), moltnetapi.GetDiaryParams{ID: testDiaryID})

	// Assert
	if err != nil {
		t.Fatalf("GetDiary() error: %v", err)
	}
	diary, ok := res.(*moltnetapi.DiaryCatalog)
	if !ok {
		t.Fatalf("expected *DiaryCatalog, got %T", res)
	}
	if diary.ID != testDiaryID {
		t.Errorf("expected id=%s, got %s", testDiaryID, diary.ID)
	}
}

func TestDiaryListTags(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.ListDiaryTags(context.Background(), moltnetapi.ListDiaryTagsParams{DiaryId: testDiaryID})

	// Assert
	if err != nil {
		t.Fatalf("ListDiaryTags() error: %v", err)
	}
	tagsRes, ok := res.(*moltnetapi.DiaryTagsResponse)
	if !ok {
		t.Fatalf("expected *DiaryTagsResponse, got %T", res)
	}
	if len(tagsRes.Tags) != 2 {
		t.Errorf("expected 2 tags, got %d", len(tagsRes.Tags))
	}
	if tagsRes.Total != 2 {
		t.Errorf("expected total=2, got %d", tagsRes.Total)
	}
}

// --- Entry-level API client tests ---

func TestEntryCreate(t *testing.T) {
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

func TestEntryList(t *testing.T) {
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

func TestEntryGet(t *testing.T) {
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

func TestEntryDelete(t *testing.T) {
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

func TestEntrySearch(t *testing.T) {
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

func TestEntryUpdate(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.UpdateDiaryEntryById(context.Background(),
		moltnetapi.OptUpdateDiaryEntryByIdReq{
			Value: moltnetapi.UpdateDiaryEntryByIdReq{
				Content: moltnetapi.OptString{Value: "new content", Set: true},
			},
			Set: true,
		},
		moltnetapi.UpdateDiaryEntryByIdParams{EntryId: testEntryID})

	// Assert
	if err != nil {
		t.Fatalf("UpdateDiaryEntryById() error: %v", err)
	}
	entry, ok := res.(*moltnetapi.DiaryEntry)
	if !ok {
		t.Fatalf("expected *DiaryEntry, got %T", res)
	}
	if entry.Content != "new content" {
		t.Errorf("expected content=new content, got %q", entry.Content)
	}
}
