package main

import (
	"encoding/json"
	"fmt"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

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

	msg := pd.Title
	if pd.Detail.Set && pd.Detail.Value != "" {
		msg += ": " + pd.Detail.Value
	}
	return fmt.Errorf("API error (HTTP %d): %s", pd.Status, msg)
}
