package main

import (
	"context"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
)

// stubDiaryHandler implements only the diary/entry operations used by the CLI.
type stubDiaryHandler struct {
	moltnetapi.UnimplementedHandler
	listDiaryEntriesParams  moltnetapi.ListDiaryEntriesParams
	listDiaryTagsParams     moltnetapi.ListDiaryTagsParams
	listSigningRequestsArgs moltnetapi.ListSigningRequestsParams
	reflectDiaryParams      moltnetapi.ReflectDiaryParams
	searchPublicFeedParams  moltnetapi.SearchPublicFeedParams
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

func newTestEntryWithRelations(content string) *moltnetapi.DiaryEntryWithRelations {
	return &moltnetapi.DiaryEntryWithRelations{
		ID:         testEntryID,
		DiaryId:    testDiaryID,
		Content:    content,
		EntryType:  moltnetapi.DiaryEntryWithRelationsEntryTypeEpisodic,
		Importance: 5,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
		Tags:       []string{},
	}
}

func (h *stubDiaryHandler) CreateDiaryEntry(_ context.Context, req *moltnetapi.CreateDiaryEntryReq, _ moltnetapi.CreateDiaryEntryParams) (moltnetapi.CreateDiaryEntryRes, error) {
	return newTestEntry(req.Content), nil
}

func (h *stubDiaryHandler) ListDiaryEntries(_ context.Context, params moltnetapi.ListDiaryEntriesParams) (moltnetapi.ListDiaryEntriesRes, error) {
	h.listDiaryEntriesParams = params
	return &moltnetapi.DiaryList{
		Items: []moltnetapi.DiaryEntry{*newTestEntry("entry-1"), *newTestEntry("entry-2")},
		Total: 2,
		Limit: 20,
	}, nil
}

func (h *stubDiaryHandler) GetDiaryEntryById(_ context.Context, params moltnetapi.GetDiaryEntryByIdParams) (moltnetapi.GetDiaryEntryByIdRes, error) {
	e := newTestEntryWithRelations("fetched content")
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

func (h *stubDiaryHandler) ListDiaries(_ context.Context, _ moltnetapi.ListDiariesParams) (moltnetapi.ListDiariesRes, error) {
	return &moltnetapi.DiaryCatalogList{
		Items: []moltnetapi.DiaryCatalog{*newTestDiary("diary-1"), *newTestDiary("diary-2")},
	}, nil
}

func (h *stubDiaryHandler) CreateDiary(_ context.Context, req *moltnetapi.CreateDiaryReq, _ moltnetapi.CreateDiaryParams) (moltnetapi.CreateDiaryRes, error) {
	return newTestDiary(req.Name), nil
}

func (h *stubDiaryHandler) GetDiary(_ context.Context, params moltnetapi.GetDiaryParams) (moltnetapi.GetDiaryRes, error) {
	d := newTestDiary("fetched diary")
	d.ID = params.ID
	return d, nil
}

func (h *stubDiaryHandler) ListDiaryTags(_ context.Context, params moltnetapi.ListDiaryTagsParams) (moltnetapi.ListDiaryTagsRes, error) {
	h.listDiaryTagsParams = params
	return &moltnetapi.DiaryTagsResponse{
		Tags: []moltnetapi.DiaryTagsResponseTagsItem{
			{Tag: "scope:cli", Count: 5},
			{Tag: "tool:claude", Count: 3},
		},
		Total: 2,
	}, nil
}

func (h *stubDiaryHandler) ListSigningRequests(_ context.Context, params moltnetapi.ListSigningRequestsParams) (moltnetapi.ListSigningRequestsRes, error) {
	h.listSigningRequestsArgs = params
	return &moltnetapi.SigningRequestList{
		Items:  []moltnetapi.SigningRequest{},
		Total:  0,
		Limit:  20,
		Offset: 0,
	}, nil
}

func (h *stubDiaryHandler) ReflectDiary(_ context.Context, params moltnetapi.ReflectDiaryParams) (moltnetapi.ReflectDiaryRes, error) {
	h.reflectDiaryParams = params
	return &moltnetapi.Digest{
		Entries: []moltnetapi.DigestEntriesItem{},
	}, nil
}

func (h *stubDiaryHandler) SearchPublicFeed(_ context.Context, params moltnetapi.SearchPublicFeedParams) (moltnetapi.SearchPublicFeedRes, error) {
	h.searchPublicFeedParams = params
	return &moltnetapi.PublicSearchResponse{
		Items: []moltnetapi.PublicFeedEntry{},
		Query: params.Q,
	}, nil
}

// --- Diary-level API client tests ---

func TestDiaryListDiaries(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubDiaryHandler{})

	// Act
	res, err := client.ListDiaries(context.Background(), moltnetapi.ListDiariesParams{})

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
	}, moltnetapi.CreateDiaryParams{XMoltnetTeamID: uuid.MustParse("00000000-0000-0000-0000-000000000088")})

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
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

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
	if handler.listDiaryEntriesParams.DiaryId != testDiaryID {
		t.Errorf("expected diary id %s, got %s", testDiaryID, handler.listDiaryEntriesParams.DiaryId)
	}
}

func TestEntryListRepeatedQueryParams(t *testing.T) {
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

	idA := uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	idB := uuid.MustParse("00000000-0000-0000-0000-0000000000b2")
	params := moltnetapi.ListDiaryEntriesParams{
		DiaryId:     testDiaryID,
		Ids:         []uuid.UUID{idA, idB},
		Tags:        []string{"deploy", "production"},
		ExcludeTags: []string{"staging"},
		EntryType: []moltnetapi.ListDiaryEntriesEntryTypeItem{
			moltnetapi.ListDiaryEntriesEntryTypeItemSemantic,
			moltnetapi.ListDiaryEntriesEntryTypeItemProcedural,
		},
	}

	if _, err := client.ListDiaryEntries(context.Background(), params); err != nil {
		t.Fatalf("ListDiaryEntries() error: %v", err)
	}

	if got := handler.listDiaryEntriesParams.Ids; len(got) != 2 || got[0] != idA || got[1] != idB {
		t.Fatalf("expected ids [%s %s], got %v", idA, idB, got)
	}
	if got := handler.listDiaryEntriesParams.Tags; len(got) != 2 || got[0] != "deploy" || got[1] != "production" {
		t.Fatalf("expected tags [deploy production], got %v", got)
	}
	if got := handler.listDiaryEntriesParams.ExcludeTags; len(got) != 1 || got[0] != "staging" {
		t.Fatalf("expected excludeTags [staging], got %v", got)
	}
	if got := handler.listDiaryEntriesParams.EntryType; len(got) != 2 || got[0] != moltnetapi.ListDiaryEntriesEntryTypeItemSemantic || got[1] != moltnetapi.ListDiaryEntriesEntryTypeItemProcedural {
		t.Fatalf("expected entry types [semantic procedural], got %v", got)
	}
}

func TestDiaryTagsRepeatedQueryParams(t *testing.T) {
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

	params := moltnetapi.ListDiaryTagsParams{
		DiaryId: testDiaryID,
		EntryTypes: []moltnetapi.ListDiaryTagsEntryTypesItem{
			moltnetapi.ListDiaryTagsEntryTypesItemSemantic,
			moltnetapi.ListDiaryTagsEntryTypesItemEpisodic,
		},
	}

	if _, err := client.ListDiaryTags(context.Background(), params); err != nil {
		t.Fatalf("ListDiaryTags() error: %v", err)
	}

	if got := handler.listDiaryTagsParams.EntryTypes; len(got) != 2 || got[0] != moltnetapi.ListDiaryTagsEntryTypesItemSemantic || got[1] != moltnetapi.ListDiaryTagsEntryTypesItemEpisodic {
		t.Fatalf("expected entryTypes [semantic episodic], got %v", got)
	}
}

func TestReflectDiaryRepeatedQueryParams(t *testing.T) {
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

	params := moltnetapi.ReflectDiaryParams{
		DiaryId: testDiaryID,
		EntryTypes: []moltnetapi.ReflectDiaryEntryTypesItem{
			moltnetapi.ReflectDiaryEntryTypesItemSemantic,
		},
	}

	if _, err := client.ReflectDiary(context.Background(), params); err != nil {
		t.Fatalf("ReflectDiary() error: %v", err)
	}

	if got := handler.reflectDiaryParams.EntryTypes; len(got) != 1 || got[0] != moltnetapi.ReflectDiaryEntryTypesItemSemantic {
		t.Fatalf("expected entryTypes [semantic], got %v", got)
	}
}

func TestListSigningRequestsRepeatedQueryParams(t *testing.T) {
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

	params := moltnetapi.ListSigningRequestsParams{
		Status: []moltnetapi.ListSigningRequestsStatusItem{
			moltnetapi.ListSigningRequestsStatusItemPending,
			moltnetapi.ListSigningRequestsStatusItemCompleted,
		},
	}

	if _, err := client.ListSigningRequests(context.Background(), params); err != nil {
		t.Fatalf("ListSigningRequests() error: %v", err)
	}

	if got := handler.listSigningRequestsArgs.Status; len(got) != 2 || got[0] != moltnetapi.ListSigningRequestsStatusItemPending || got[1] != moltnetapi.ListSigningRequestsStatusItemCompleted {
		t.Fatalf("expected status [pending completed], got %v", got)
	}
}

func TestSearchPublicFeedRepeatedQueryParams(t *testing.T) {
	handler := &stubDiaryHandler{}
	_, _, client := newTestServer(t, handler)

	params := moltnetapi.SearchPublicFeedParams{
		Q: "autonomy",
		EntryTypes: []moltnetapi.SearchPublicFeedEntryTypesItem{
			moltnetapi.SearchPublicFeedEntryTypesItemSemantic,
		},
	}

	if _, err := client.SearchPublicFeed(context.Background(), params); err != nil {
		t.Fatalf("SearchPublicFeed() error: %v", err)
	}

	if got := handler.searchPublicFeedParams.EntryTypes; len(got) != 1 || got[0] != moltnetapi.SearchPublicFeedEntryTypesItemSemantic {
		t.Fatalf("expected entryTypes [semantic], got %v", got)
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
	entry, ok := res.(*moltnetapi.DiaryEntryWithRelations)
	if !ok {
		t.Fatalf("expected *DiaryEntryWithRelations, got %T", res)
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
