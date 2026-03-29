package main

import (
	"net/url"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

func TestFormatAPIError_WithTitleOnly(t *testing.T) {
	// Arrange — a BadRequest error response with title but no detail
	errRes := &moltnetapi.CreateDiaryEntryBadRequest{
		Title:  "Validation failed",
		Status: 400,
		Code:   "VALIDATION_FAILED",
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}

	// Act
	err := formatAPIError(errRes)

	// Assert
	want := "API error (HTTP 400): Validation failed"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestFormatAPIError_WithTitleAndDetail(t *testing.T) {
	// Arrange — a NotFound error response with title and detail
	errRes := &moltnetapi.GetDiaryEntryByIdNotFound{
		Title:  "Not found",
		Status: 404,
		Detail: moltnetapi.OptString{Value: "Entry 00000000-0000-0000-0000-000000000042 does not exist", Set: true},
		Code:   "NOT_FOUND",
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}

	// Act
	err := formatAPIError(errRes)

	// Assert
	want := "API error (HTTP 404): Not found: Entry 00000000-0000-0000-0000-000000000042 does not exist"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestFormatAPIError_Unauthorized(t *testing.T) {
	// Arrange
	errRes := &moltnetapi.GetWhoamiUnauthorized{
		Title:  "Unauthorized",
		Status: 401,
		Code:   "UNAUTHORIZED",
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}

	// Act
	err := formatAPIError(errRes)

	// Assert
	want := "API error (HTTP 401): Unauthorized"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestFormatAPIError_InternalServerError(t *testing.T) {
	// Arrange
	errRes := &moltnetapi.CreateDiaryInternalServerError{
		Title:  "Internal server error",
		Status: 500,
		Detail: moltnetapi.OptString{Value: "database connection failed", Set: true},
		Code:   "INTERNAL_SERVER_ERROR",
		Type:   url.URL{Scheme: "about", Opaque: "blank"},
	}

	// Act
	err := formatAPIError(errRes)

	// Assert
	want := "API error (HTTP 500): Internal server error: database connection failed"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestFormatAPIError_NonProblemDetails(t *testing.T) {
	// Arrange — a non-ProblemDetails value (a success type)
	res := &moltnetapi.DiaryCatalog{Name: "test"}

	// Act
	err := formatAPIError(res)

	// Assert — should fall back to type name
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	got := err.Error()
	if got != "unexpected response type: *moltnetapi.DiaryCatalog" {
		t.Errorf("got %q, want fallback with type name", got)
	}
}
