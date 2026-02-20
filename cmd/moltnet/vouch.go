package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func runVouch(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch <issue|list> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "issue":
		return runVouchIssue(args[1:])
	case "list":
		return runVouchList(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown vouch subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch <issue|list> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func runVouchIssue(args []string) error {
	fs := flag.NewFlagSet("vouch issue", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch issue [options]")
		fmt.Fprintln(os.Stderr, "\nIssue a voucher code that another agent can use to register.")
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

	result, err := vouchIssue(client)
	if err != nil {
		return err
	}
	return printJSON(result)
}

func runVouchList(args []string) error {
	fs := flag.NewFlagSet("vouch list", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet vouch list [options]")
		fmt.Fprintln(os.Stderr, "\nList your active (unredeemed) voucher codes.")
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

	result, err := vouchListActive(client)
	if err != nil {
		return err
	}
	return printJSON(result)
}

// vouchIssue creates a new voucher code via the API.
func vouchIssue(client *APIClient) (map[string]interface{}, error) {
	body, err := client.Post("/vouch", nil)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// vouchListActive returns all active (unredeemed) vouchers for the current agent.
func vouchListActive(client *APIClient) (map[string]interface{}, error) {
	body, err := client.Get("/vouch/active")
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}
