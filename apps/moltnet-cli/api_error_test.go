package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/ogen-go/ogen/validate"
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

// newUnexpectedStatusCodeError builds a realistic *validate.UnexpectedStatusCodeError
// with a retained response body. This is exactly the error ogen surfaces when the
// REST API returns a status code that wasn't declared in the OpenAPI spec — the
// body is on Payload but never printed by the default Error() string.
func newUnexpectedStatusCodeError(status int, contentType, body string) error {
	resp := &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{contentType}},
		Body:       io.NopCloser(bytes.NewBufferString(body)),
	}
	return validate.UnexpectedStatusCodeWithResponse(resp)
}

func TestFormatTransportError_NilPassthrough(t *testing.T) {
	if got := formatTransportError(nil); got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

func TestFormatTransportError_NonTransportErrorPassthrough(t *testing.T) {
	// Arrange — a plain error unrelated to the transport layer
	orig := errors.New("something else broke")

	// Act
	got := formatTransportError(orig)

	// Assert — wrapper must not swallow or rewrite unrelated errors
	if got != orig {
		t.Errorf("expected original error, got %v", got)
	}
}

func TestFormatTransportError_RestApiValidationBody(t *testing.T) {
	// Arrange — the exact shape the REST API emits for undeclared 400s:
	// Fastify's default validation handler shape
	body := `{"statusCode":400,"error":"Bad Request","message":"querystring/limit must be <= 100"}`
	err := newUnexpectedStatusCodeError(400, "application/json", body)

	// Act
	got := formatTransportError(err)

	// Assert
	want := "API error (HTTP 400): Bad Request: querystring/limit must be <= 100"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFormatTransportError_ProblemDetailsBody(t *testing.T) {
	// Arrange — RFC 7807 ProblemDetails body on an undeclared status
	body := `{"type":"about:blank","title":"Teapot","status":418,"detail":"I'm a teapot","code":"TEAPOT"}`
	err := newUnexpectedStatusCodeError(418, "application/problem+json", body)

	// Act
	got := formatTransportError(err)

	// Assert
	want := "API error (HTTP 418): Teapot: I'm a teapot"
	if got.Error() != want {
		t.Errorf("got %q, want %q", got.Error(), want)
	}
}

func TestFormatTransportError_RawBodyFallback(t *testing.T) {
	// Arrange — non-JSON body (e.g. an HTML error page from a reverse proxy)
	body := "<html><body><h1>502 Bad Gateway</h1></body></html>"
	err := newUnexpectedStatusCodeError(502, "text/html", body)

	// Act
	got := formatTransportError(err)

	// Assert
	gotStr := got.Error()
	if !strings.Contains(gotStr, "API error (HTTP 502)") {
		t.Errorf("expected status in error, got %q", gotStr)
	}
	if !strings.Contains(gotStr, "502 Bad Gateway") {
		t.Errorf("expected raw body in error, got %q", gotStr)
	}
}

func TestFormatTransportError_TruncatesLargeBody(t *testing.T) {
	// Arrange — a body larger than the 500-char cap
	body := strings.Repeat("x", 1000)
	err := newUnexpectedStatusCodeError(500, "text/plain", body)

	// Act
	got := formatTransportError(err)

	// Assert — message must not balloon to the full 1000 chars
	gotStr := got.Error()
	if !strings.Contains(gotStr, "…") {
		t.Errorf("expected truncation marker, got %q", gotStr)
	}
	if len(gotStr) > 600 {
		t.Errorf("expected truncated output (~500 chars), got %d chars", len(gotStr))
	}
}

func TestFormatTransportError_EmptyBodyPassthrough(t *testing.T) {
	// Arrange — empty body; no useful information to surface
	err := newUnexpectedStatusCodeError(500, "text/plain", "")

	// Act
	got := formatTransportError(err)

	// Assert — original error is returned (still contains "unexpected status code: 500")
	if !strings.Contains(got.Error(), "unexpected status code: 500") {
		t.Errorf("expected original error passthrough, got %q", got.Error())
	}
}

func TestFormatTransportError_WrappedError(t *testing.T) {
	// Arrange — transport error wrapped by a caller (e.g. fmt.Errorf("entry list: %w", err))
	inner := newUnexpectedStatusCodeError(400, "application/json",
		`{"statusCode":400,"error":"Bad Request","message":"querystring/limit must be <= 100"}`)
	wrapped := fmt.Errorf("entry list: %w", inner)

	// Act — unwrapping should still find the UnexpectedStatusCodeError
	got := formatTransportError(wrapped)

	// Assert
	gotStr := got.Error()
	if !strings.Contains(gotStr, "API error (HTTP 400)") {
		t.Errorf("expected formatted API error, got %q", gotStr)
	}
	if !strings.Contains(gotStr, "querystring/limit must be <= 100") {
		t.Errorf("expected validation detail, got %q", gotStr)
	}
}
