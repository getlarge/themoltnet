package main

import (
	"context"
	"net/url"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/go/moltnet-api-client"
	"github.com/google/uuid"
)

// stubErrorHandler returns ProblemDetails error responses for every operation.
type stubErrorHandler struct {
	moltnetapi.UnimplementedHandler
}

func problemNotFound(detail string) moltnetapi.ProblemDetails {
	return moltnetapi.ProblemDetails{
		Title:  "Not found",
		Status: 404,
		Code:   "NOT_FOUND",
		Detail: moltnetapi.OptString{Value: detail, Set: detail != ""},
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}
}

func problemBadRequest(detail string) moltnetapi.ProblemDetails {
	return moltnetapi.ProblemDetails{
		Title:  "Validation failed",
		Status: 400,
		Code:   "VALIDATION_FAILED",
		Detail: moltnetapi.OptString{Value: detail, Set: detail != ""},
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}
}

func (h *stubErrorHandler) GetDiaryEntryById(_ context.Context, params moltnetapi.GetDiaryEntryByIdParams) (moltnetapi.GetDiaryEntryByIdRes, error) {
	pd := problemNotFound("entry " + params.EntryId.String() + " does not exist")
	return (*moltnetapi.GetDiaryEntryByIdNotFound)(&pd), nil
}

func (h *stubErrorHandler) CreateDiaryEntry(_ context.Context, _ *moltnetapi.CreateDiaryEntryReq, _ moltnetapi.CreateDiaryEntryParams) (moltnetapi.CreateDiaryEntryRes, error) {
	pd := problemBadRequest("content must not be empty")
	return (*moltnetapi.CreateDiaryEntryBadRequest)(&pd), nil
}

func (h *stubErrorHandler) GetWhoami(_ context.Context) (moltnetapi.GetWhoamiRes, error) {
	pd := moltnetapi.ProblemDetails{
		Title:  "Unauthorized",
		Status: 401,
		Code:   "UNAUTHORIZED",
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}
	return (*moltnetapi.GetWhoamiUnauthorized)(&pd), nil
}

func TestGetEntryReturnsNotFoundDetails(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubErrorHandler{})
	entryID := uuid.MustParse("00000000-0000-0000-0000-000000000042")

	// Act
	res, err := client.GetDiaryEntryById(context.Background(), moltnetapi.GetDiaryEntryByIdParams{EntryId: entryID})

	// Assert — transport error should be nil; the error is in the response union
	if err != nil {
		t.Fatalf("expected nil transport error, got: %v", err)
	}
	if _, ok := res.(*moltnetapi.DiaryEntry); ok {
		t.Fatal("expected error response, got success")
	}

	apiErr := formatAPIError(res)
	if !strings.Contains(apiErr.Error(), "404") {
		t.Errorf("expected status 404 in error, got: %s", apiErr)
	}
	if !strings.Contains(apiErr.Error(), "Not found") {
		t.Errorf("expected title in error, got: %s", apiErr)
	}
	if !strings.Contains(apiErr.Error(), "does not exist") {
		t.Errorf("expected detail in error, got: %s", apiErr)
	}
}

func TestCreateEntryReturnsBadRequestDetails(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubErrorHandler{})
	diaryID := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	// Act
	res, err := client.CreateDiaryEntry(context.Background(), &moltnetapi.CreateDiaryEntryReq{
		Content: "some content",
	}, moltnetapi.CreateDiaryEntryParams{DiaryId: diaryID})

	// Assert
	if err != nil {
		t.Fatalf("expected nil transport error, got: %v", err)
	}

	apiErr := formatAPIError(res)
	if !strings.Contains(apiErr.Error(), "400") {
		t.Errorf("expected status 400 in error, got: %s", apiErr)
	}
	if !strings.Contains(apiErr.Error(), "content must not be empty") {
		t.Errorf("expected detail in error, got: %s", apiErr)
	}
}

func TestWhoamiReturnsUnauthorizedDetails(t *testing.T) {
	// Arrange
	_, _, client := newTestServer(t, &stubErrorHandler{})

	// Act
	res, err := client.GetWhoami(context.Background())

	// Assert
	if err != nil {
		t.Fatalf("expected nil transport error, got: %v", err)
	}

	apiErr := formatAPIError(res)
	if !strings.Contains(apiErr.Error(), "401") {
		t.Errorf("expected status 401 in error, got: %s", apiErr)
	}
	if !strings.Contains(apiErr.Error(), "Unauthorized") {
		t.Errorf("expected title in error, got: %s", apiErr)
	}
}
