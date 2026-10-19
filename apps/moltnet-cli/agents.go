package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

// runAgentsWhoamiCmd is the flag-free business logic for agents whoami.
func runAgentsWhoamiCmd(apiURL, credPath string) error {
	return runAgentsWhoamiWithExpiry(apiURL, credPath, os.Stdout, os.Stderr, -1)
}

func runAgentsWhoamiWithExpiry(apiURL, credPath string, out, errOut io.Writer, warnDays int) error {
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		return fmt.Errorf("agents whoami: %w", formatTransportError(err))
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		return formatAPIError(res)
	}
	if warnDays >= 0 {
		warnAgentKeyExpiry(errOut, whoami, warnDays, time.Now())
	}
	return printJSONTo(out, whoami)
}

// runAgentsLookupCmd is the flag-free business logic for agents lookup.
func runAgentsLookupCmd(apiURL, credPath, fingerprint string) error {
	client, err := newAuthenticatedClient(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetAgentProfile(context.Background(), moltnetapi.GetAgentProfileParams{
		Fingerprint: fingerprint,
	})
	if err != nil {
		return fmt.Errorf("agents lookup: %w", formatTransportError(err))
	}
	profile, ok := res.(*moltnetapi.AgentProfile)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(profile)
}

// printJSON marshals v to indented JSON and writes to stdout.
func printJSON(v interface{}) error {
	return printJSONTo(os.Stdout, v)
}

// printJSONTo marshals v to indented JSON and writes to w. Used by
// commands whose tests inject a buffer instead of stdout.
func printJSONTo(w io.Writer, v interface{}) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// Missing or null expiry denotes an unavailable or non-expiring credential.
func warnAgentKeyExpiry(out io.Writer, whoami *moltnetapi.Whoami, days int, now time.Time) {
	binding, ok := whoami.CredentialBinding.Get()
	if !ok {
		return
	}
	var expiry moltnetapi.OptNilDateTime
	switch binding.Type {
	case moltnetapi.ProvenanceGraphIdentityNodeWhoamiCredentialBinding:
		expiry = binding.ProvenanceGraphIdentityNode.ExpiresAt
	case moltnetapi.ProvenanceGraphTeamNodeWhoamiCredentialBinding:
		expiry = binding.ProvenanceGraphTeamNode.ExpiresAt
	}
	at, ok := expiry.Get()
	if ok && at.Sub(now).Hours()/24 <= float64(days) {
		fmt.Fprintf(out, "Warning: MoltNet agent key expires at %s; replace the session key before expiry.\n", at.UTC().Format(time.RFC3339))
	}
}
