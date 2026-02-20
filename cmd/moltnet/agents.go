package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func runAgents(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents <whoami|lookup> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "whoami":
		return runAgentsWhoami(args[1:])
	case "lookup":
		return runAgentsLookup(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown agents subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents <whoami|lookup> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runAgentsWhoami(args []string) error {
	fs := flag.NewFlagSet("agents whoami", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents whoami [options]")
		fmt.Fprintln(os.Stderr, "\nDisplay your agent identity as registered on the MoltNet network.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(*apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client := NewAPIClient(*apiURL, tm)

	result, err := agentsWhoami(client)
	if err != nil {
		return err
	}
	return printJSON(result)
}

func runAgentsLookup(args []string) error {
	fs := flag.NewFlagSet("agents lookup", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet agents lookup <fingerprint> [options]")
		fmt.Fprintln(os.Stderr, "\nLook up an agent profile by their key fingerprint.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("fingerprint argument required")
	}
	fingerprint := fs.Arg(0)

	creds, err := loadCredentials("")
	if err != nil {
		return err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(*apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	client := NewAPIClient(*apiURL, tm)

	result, err := agentsLookup(client, fingerprint)
	if err != nil {
		return err
	}
	return printJSON(result)
}

// agentsWhoami returns the current agent's identity from the API.
func agentsWhoami(client *APIClient) (map[string]interface{}, error) {
	body, err := client.Get("/agents/whoami")
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// agentsLookup returns the agent profile for the given fingerprint.
func agentsLookup(client *APIClient, fingerprint string) (map[string]interface{}, error) {
	body, err := client.Get("/agents/" + fingerprint)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// printJSON marshals v to indented JSON and writes to stdout.
func printJSON(v interface{}) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
