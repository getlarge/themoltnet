package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/ogen-go/ogen/validate"
)

// maxBodySnippet caps raw body text included in error messages so that large
// HTML error pages (e.g. from a reverse proxy) don't flood the terminal.
const maxBodySnippet = 500

// formatAPIError extracts ProblemDetails from an ogen union error response and
// formats it as a human-readable error message including status, title, and detail.
//
// All ogen-generated error types (e.g. CreateDiaryEntryBadRequest) are defined
// as `type XxxError ProblemDetails`, sharing the same struct layout. We marshal
// to JSON and unmarshal back to ProblemDetails to extract the fields regardless
// of the concrete type alias.
func formatAPIError(res any) error {
	data, err := json.Marshal(res)
	if err != nil {
		return fmt.Errorf("unexpected response type: %T", res)
	}

	var pd moltnetapi.ProblemDetails
	if err := json.Unmarshal(data, &pd); err != nil || pd.Title == "" || pd.Status == 0 {
		return fmt.Errorf("unexpected response type: %T", res)
	}

	return formatProblemDetails(pd.Status, pd.Title, pd.Detail.Value, pd.Detail.Set)
}

// formatTransportError turns a transport-level error returned by an ogen client
// method into a human-readable message. When the server responded with a
// status code that is not declared in the OpenAPI spec, ogen surfaces a
// *validate.UnexpectedStatusCodeError whose default message is only
// "unexpected status code: N" — the response body is retained on the Payload
// field but never printed. This function reads that body and tries to surface
// whatever the server actually said:
//
//  1. If the body parses as a ProblemDetails document ({ status, title, detail }
//     or the shorthand { statusCode, error, message } emitted by the REST API's
//     default validation handler), format it like a declared API error.
//  2. Otherwise, attach the raw body (truncated to 500 chars) to the error
//     so the operator sees the server's text.
//
// For any other error (network failure, decode failure on a declared status,
// etc.) the error is returned unchanged.
func formatTransportError(err error) error {
	if err == nil {
		return nil
	}
	var usc *validate.UnexpectedStatusCodeError
	if !errors.As(err, &usc) || usc.Payload == nil {
		return err
	}
	defer usc.Payload.Body.Close()

	// Read at most maxBodySnippet+1 bytes: enough to distinguish "fits" from
	// "needs truncation" while bounding memory against a hostile reverse proxy
	// that streams a multi-megabyte HTML error page. The extra byte is how we
	// detect truncation — if we got it, the body was longer than the cap.
	body, readErr := io.ReadAll(io.LimitReader(usc.Payload.Body, maxBodySnippet+1))
	if readErr != nil || len(body) == 0 {
		return err
	}
	truncated := len(body) > maxBodySnippet
	if truncated {
		body = body[:maxBodySnippet]
	}

	// Structured-body parsers only run when the whole body was captured: a
	// truncated JSON document won't parse, and pretending it did risks
	// surfacing garbled values. Truncation falls through to the raw-body path.
	if !truncated {
		if pd, ok := parseProblemDetailsBody(body); ok {
			return formatProblemDetails(pd.Status, pd.Title, pd.Detail.Value, pd.Detail.Set)
		}
		if msg, ok := parseRestApiErrorBody(body); ok {
			return formatProblemDetails(usc.StatusCode, msg.title, msg.detail, msg.detail != "")
		}
	}

	snippet := strings.TrimSpace(string(body))
	if truncated {
		snippet += "…"
	}
	return fmt.Errorf("API error (HTTP %d): %s", usc.StatusCode, snippet)
}

// formatProblemDetails returns the standard CLI-facing error string built from
// RFC 7807-style fields. Both formatAPIError and formatTransportError funnel
// through this so every surfaced error has the same shape.
func formatProblemDetails(status int, title, detail string, hasDetail bool) error {
	msg := title
	if hasDetail && detail != "" {
		if msg == "" {
			msg = detail
		} else {
			msg += ": " + detail
		}
	}
	if msg == "" {
		msg = fmt.Sprintf("HTTP %d", status)
	}
	return fmt.Errorf("API error (HTTP %d): %s", status, msg)
}

// parseProblemDetailsBody attempts to decode body as an RFC 7807
// ProblemDetails document. Returns false if the body doesn't have the
// minimum shape (a title + status).
func parseProblemDetailsBody(body []byte) (moltnetapi.ProblemDetails, bool) {
	var pd moltnetapi.ProblemDetails
	if err := json.Unmarshal(body, &pd); err != nil {
		return moltnetapi.ProblemDetails{}, false
	}
	if pd.Title == "" || pd.Status == 0 {
		return moltnetapi.ProblemDetails{}, false
	}
	return pd, true
}

// restApiErrorBody captures the shorthand error shape the REST API emits for
// responses that aren't explicitly mapped to ProblemDetails — notably the
// default validation errors, e.g.
//
//	{ "statusCode": 400, "error": "Bad Request", "message": "querystring/limit must be <= 100" }
//
// These are exactly the responses ogen can't decode because the status code
// isn't declared in the OpenAPI spec, so they land in UnexpectedStatusCodeError.
type restApiErrorBody struct {
	title  string
	detail string
}

func parseRestApiErrorBody(body []byte) (restApiErrorBody, bool) {
	var raw struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return restApiErrorBody{}, false
	}
	if raw.Error == "" && raw.Message == "" {
		return restApiErrorBody{}, false
	}
	return restApiErrorBody{title: raw.Error, detail: raw.Message}, true
}
