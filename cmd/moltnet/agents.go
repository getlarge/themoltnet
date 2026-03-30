package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
)

// runAgentsWhoamiCmd is the flag-free business logic for agents whoami.
func runAgentsWhoamiCmd(apiURL, credPath string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		return fmt.Errorf("agents whoami: %w", err)
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(whoami)
}

// runAgentsLookupCmd is the flag-free business logic for agents lookup.
func runAgentsLookupCmd(apiURL, credPath, fingerprint string) error {
	client, err := newClientFromCreds(apiURL, credPath)
	if err != nil {
		return err
	}
	res, err := client.GetAgentProfile(context.Background(), moltnetapi.GetAgentProfileParams{
		Fingerprint: fingerprint,
	})
	if err != nil {
		return fmt.Errorf("agents lookup: %w", err)
	}
	profile, ok := res.(*moltnetapi.AgentProfile)
	if !ok {
		return formatAPIError(res)
	}
	return printJSON(profile)
}

// printJSON marshals v to indented JSON and writes to stdout.
func printJSON(v interface{}) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
