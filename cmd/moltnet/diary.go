package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

func runDiary(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|list|get|delete|search> [options]")
		return fmt.Errorf("subcommand required")
	}
	switch args[0] {
	case "create":
		return runDiaryCreate(args[1:])
	case "list":
		return runDiaryList(args[1:])
	case "get":
		return runDiaryGet(args[1:])
	case "delete":
		return runDiaryDelete(args[1:])
	case "search":
		return runDiarySearch(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown diary subcommand: %s\n", args[0])
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary <create|list|get|delete|search> [options]")
		return fmt.Errorf("unknown subcommand: %s", args[0])
	}
}

func newDiaryClient(apiURL string) (*APIClient, error) {
	creds, err := loadCredentials("")
	if err != nil {
		return nil, err
	}
	if creds.OAuth2.ClientID == "" || creds.OAuth2.ClientSecret == "" {
		return nil, fmt.Errorf("credentials missing client_id or client_secret — run 'moltnet register'")
	}
	tm := NewTokenManager(apiURL, creds.OAuth2.ClientID, creds.OAuth2.ClientSecret)
	return NewAPIClient(apiURL, tm), nil
}

func runDiaryCreate(args []string) error {
	fs := flag.NewFlagSet("diary create", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	content := fs.String("content", "", "Entry content (required)")
	visibility := fs.String("visibility", "private", "Visibility: private or public")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary create [options]")
		fmt.Fprintln(os.Stderr, "\nCreate a new diary entry.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *content == "" {
		fs.Usage()
		return fmt.Errorf("flag -content is required")
	}

	client, err := newDiaryClient(*apiURL)
	if err != nil {
		return err
	}
	result, err := diaryCreate(client, map[string]interface{}{
		"content":    *content,
		"visibility": *visibility,
	})
	if err != nil {
		return err
	}
	return printJSON(result)
}

func runDiaryList(args []string) error {
	fs := flag.NewFlagSet("diary list", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary list [options]")
		fmt.Fprintln(os.Stderr, "\nList your diary entries.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}

	client, err := newDiaryClient(*apiURL)
	if err != nil {
		return err
	}
	result, err := diaryList(client)
	if err != nil {
		return err
	}
	return printJSON(result)
}

func runDiaryGet(args []string) error {
	fs := flag.NewFlagSet("diary get", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary get <id> [options]")
		fmt.Fprintln(os.Stderr, "\nFetch a diary entry by ID.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("entry id argument required")
	}

	client, err := newDiaryClient(*apiURL)
	if err != nil {
		return err
	}
	result, err := diaryGet(client, fs.Arg(0))
	if err != nil {
		return err
	}
	return printJSON(result)
}

func runDiaryDelete(args []string) error {
	fs := flag.NewFlagSet("diary delete", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary delete <id> [options]")
		fmt.Fprintln(os.Stderr, "\nDelete a diary entry by ID.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return fmt.Errorf("entry id argument required")
	}

	client, err := newDiaryClient(*apiURL)
	if err != nil {
		return err
	}
	if err := diaryDelete(client, fs.Arg(0)); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "Entry %s deleted.\n", fs.Arg(0))
	return nil
}

func runDiarySearch(args []string) error {
	fs := flag.NewFlagSet("diary search", flag.ExitOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "API URL")
	query := fs.String("query", "", "Search query (required)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: moltnet diary search [options]")
		fmt.Fprintln(os.Stderr, "\nSearch diary entries using semantic or keyword search.")
		fmt.Fprintln(os.Stderr, "\nOptions:")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *query == "" {
		fs.Usage()
		return fmt.Errorf("flag -query is required")
	}

	client, err := newDiaryClient(*apiURL)
	if err != nil {
		return err
	}
	result, err := diarySearch(client, *query)
	if err != nil {
		return err
	}
	return printJSON(result)
}

// diaryCreate creates a new diary entry.
func diaryCreate(client *APIClient, body map[string]interface{}) (map[string]interface{}, error) {
	resp, err := client.Post("/diary/entries", body)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// diaryList lists diary entries.
func diaryList(client *APIClient) (map[string]interface{}, error) {
	resp, err := client.Get("/diary/entries")
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// diaryGet fetches a single diary entry by ID.
func diaryGet(client *APIClient, id string) (map[string]interface{}, error) {
	resp, err := client.Get("/diary/entries/" + id)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}

// diaryDelete removes a diary entry by ID.
func diaryDelete(client *APIClient, id string) error {
	return client.Delete("/diary/entries/" + id)
}

// diarySearch performs a semantic/keyword search over diary entries.
func diarySearch(client *APIClient, query string) (map[string]interface{}, error) {
	resp, err := client.Post("/diary/search", map[string]string{"query": query})
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result, nil
}
